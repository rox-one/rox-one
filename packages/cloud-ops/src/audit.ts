/**
 * Append-only audit trail for staff actions on Rox Cloud.
 *
 * Every staff move that can touch a customer — stopping or extending a
 * sandbox, granting credit, starting an impersonation session, setting or
 * approving a kill switch — is recorded with who did it and why. Entries are
 * hash-chained: each `hash` covers the entry itself plus the previous hash,
 * so `verifyChain()` sees an edited, removed or reordered entry.
 *
 * The trail never holds secret material: `append` walks `details` to any depth
 * and rejects a field named `secret`, `token`, `password` or `key`.
 */

import { createHash, randomUUID } from 'node:crypto';
import { OpsError } from './types.ts';
import type { AuditAction, AuditEntry, AuditInput } from './types.ts';

/** `prevHash` of the first entry; 64 zeros, the conventional genesis link. */
export const GENESIS_HASH = '0'.repeat(64);

/** Detail fields that must never reach the trail, matched case-insensitively. */
const FORBIDDEN_DETAIL_KEYS: Record<string, true> = {
  secret: true,
  token: true,
  password: true,
  key: true,
};

export interface AuditLogOptions {
  /** Injectable clock so entry timestamps stay testable. */
  now?: () => Date;
}

/** Which stored entries `list` returns. */
export interface AuditFilter {
  action?: AuditAction;
  actorId?: string;
  targetId?: string;
  /** Inclusive ISO-8601 lower bound on `at`. */
  from?: string;
  /** Inclusive ISO-8601 upper bound on `at`. */
  to?: string;
  /** Keep only the newest N matches; omitted means all of them. */
  limit?: number;
}

/** Result of walking the chain; `brokenAt` is the index of the first bad entry. */
export type AuditChainCheck = { ok: true; count: number } | { ok: false; brokenAt: number };

export interface AuditLog {
  /**
   * Entries in append order. Read-only view kept for diagnostics and tests;
   * writing through it breaks the chain.
   */
  readonly entries: readonly AuditEntry[];
  /** Record one staff action. Throws `OpsError` on an empty reason or a secret field. */
  append(input: AuditInput): AuditEntry;
  /** Matching entries in append order. */
  list(filter?: AuditFilter): AuditEntry[];
  /** Recompute every hash and every link. */
  verifyChain(): AuditChainCheck;
  /**
   * Replace the trail with entries read back from disk and verify every hash
   * and link. A chain that does not verify throws `OpsError` and leaves the
   * entries already in memory untouched, so a damaged file can never become
   * the trail the next append extends.
   */
  restore(entries: readonly AuditEntry[]): AuditChainCheck;
}

/**
 * Canonical JSON: object keys sorted, `undefined` dropped, arrays kept in
 * order. Two entries with the same content always hash the same.
 */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null';
  }
  if (value instanceof Date) {
    return JSON.stringify(value.toISOString());
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item === undefined ? null : item)).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  const parts: string[] = [];
  for (const key of Object.keys(record).sort()) {
    const item = record[key];
    if (item === undefined) continue;
    parts.push(`${JSON.stringify(key)}:${canonicalJson(item)}`);
  }
  return `{${parts.join(',')}}`;
}

/** Deep copy of plain objects and arrays; other values are kept by reference. */
function cloneValue<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => cloneValue(item)) as unknown as T;
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = cloneValue(item);
    }
    return out as T;
  }
  return value;
}

/** Path of the first forbidden field in `details`, or null when clean. */
function findForbiddenKey(value: unknown, path: string): string | null {
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      const hit = findForbiddenKey(value[i], `${path}[${i}]`);
      if (hit) return hit;
    }
    return null;
  }
  if (value !== null && typeof value === 'object') {
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (FORBIDDEN_DETAIL_KEYS[key.trim().toLowerCase()]) {
        return `${path}.${key}`;
      }
      const hit = findForbiddenKey(item, `${path}.${key}`);
      if (hit) return hit;
    }
  }
  return null;
}

type HashedEntry = Omit<AuditEntry, 'hash'>;

function hashEntry(entry: HashedEntry): string {
  return createHash('sha256').update(canonicalJson(entry)).digest('hex');
}

/** Walk a candidate trail and report the first entry that breaks the chain. */
function checkChain(entries: readonly AuditEntry[]): AuditChainCheck {
  let prevHash = GENESIS_HASH;
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]!;
    if (entry.prevHash !== prevHash) return { ok: false, brokenAt: index };
    const { hash: storedHash, ...payload } = entry;
    if (hashEntry(payload) !== storedHash) return { ok: false, brokenAt: index };
    prevHash = entry.hash;
  }
  return { ok: true, count: entries.length };
}

export function createAuditLog(options: AuditLogOptions = {}): AuditLog {
  const now = options.now ?? (() => new Date());
  const stored: AuditEntry[] = [];

  function append(input: AuditInput): AuditEntry {
    const actorId = input.actorId?.trim() ?? '';
    if (!actorId) {
      throw new OpsError('invalid_input', 'У записи должен быть сотрудник, совершивший действие');
    }
    const reason = input.reason?.trim() ?? '';
    if (!reason) {
      throw new OpsError('invalid_input', 'У записи должна быть причина действия');
    }
    const targetType = input.targetType?.trim() ?? '';
    if (!targetType) {
      throw new OpsError('invalid_input', 'У записи должен быть тип объекта');
    }
    const targetId = input.targetId?.trim() ?? '';
    if (!targetId) {
      throw new OpsError('invalid_input', 'У записи должен быть объект действия');
    }
    if (input.details) {
      const hit = findForbiddenKey(input.details, 'details');
      if (hit) {
        throw new OpsError('secret_in_audit', `В details нельзя хранить секреты: поле ${hit}`);
      }
    }

    const ticket = input.ticket?.trim();
    const details = input.details ? cloneValue(input.details) : undefined;
    const prevHash = stored.length ? stored[stored.length - 1]!.hash : GENESIS_HASH;
    const payload: HashedEntry = {
      id: randomUUID(),
      at: now().toISOString(),
      actorId,
      action: input.action,
      targetType,
      targetId,
      reason,
      ...(ticket ? { ticket } : {}),
      ...(details ? { details } : {}),
      prevHash,
    };
    const entry: AuditEntry = { ...payload, hash: hashEntry(payload) };
    stored.push(entry);
    return { ...entry, ...(entry.details ? { details: cloneValue(entry.details) } : {}) };
  }

  function list(filter: AuditFilter = {}): AuditEntry[] {
    const fromMs = filter.from === undefined ? null : Date.parse(filter.from);
    if (fromMs !== null && Number.isNaN(fromMs)) {
      throw new OpsError('invalid_input', 'Не удалось разобрать нижнюю границу времени');
    }
    const toMs = filter.to === undefined ? null : Date.parse(filter.to);
    if (toMs !== null && Number.isNaN(toMs)) {
      throw new OpsError('invalid_input', 'Не удалось разобрать верхнюю границу времени');
    }
    let limit = Number.POSITIVE_INFINITY;
    if (filter.limit !== undefined) {
      if (!Number.isFinite(filter.limit)) {
        throw new OpsError('invalid_input', 'Ограничение выборки должно быть числом');
      }
      limit = Math.floor(filter.limit);
      if (limit <= 0) return [];
    }

    const matched = stored.filter((entry) => {
      if (filter.action && entry.action !== filter.action) return false;
      if (filter.actorId && entry.actorId !== filter.actorId) return false;
      if (filter.targetId && entry.targetId !== filter.targetId) return false;
      const at = Date.parse(entry.at);
      if (fromMs !== null && at < fromMs) return false;
      if (toMs !== null && at > toMs) return false;
      return true;
    });
    const newest = Number.isFinite(limit) ? matched.slice(-limit) : matched;
    return newest.map((entry) => ({
      ...entry,
      ...(entry.details ? { details: cloneValue(entry.details) } : {}),
    }));
  }

  function verifyChain(): AuditChainCheck {
    return checkChain(stored);
  }

  function restore(entries: readonly AuditEntry[]): AuditChainCheck {
    const candidate = entries.map((entry) => cloneValue(entry));
    const check = checkChain(candidate);
    if (!check.ok) {
      throw new OpsError(
        'invalid_state',
        `Цепочка аудита не сходится: запись №${check.brokenAt} повреждена или переставлена`,
      );
    }
    stored.length = 0;
    for (const entry of candidate) stored.push(entry);
    return check;
  }

  return {
    get entries(): readonly AuditEntry[] {
      return stored.slice();
    },
    append,
    list,
    verifyChain,
    restore,
  };
}
