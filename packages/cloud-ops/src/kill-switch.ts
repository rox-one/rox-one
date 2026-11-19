/**
 * Two-person kill switch for Rox Cloud.
 *
 * A kill request names a scope — a provider, a region, a product, or any
 * combination — and blocks new work that matches it. With the default
 * `requireApproval`, a request waits in `pending` until a second staff member
 * approves it, so no single person can stop a customer's fleet (or lift a
 * block) alone. A request with an empty scope blocks everything.
 *
 * Matching is pure: a request blocks a resource when every field the request
 * names equals the resource's field, and a request with no fields blocks any
 * resource.
 */

import { randomUUID } from 'node:crypto';
import { OpsError } from './types.ts';
import type { KillProvider, KillRequest, KillScope } from './types.ts';

const PROVIDERS: readonly KillProvider[] = ['daytona', 'modal', 'e2b'];

/** What a staff member asks the switch to do. */
export interface KillRequestInput {
  scope: KillScope;
  /** true asks to block matching work; false records that the switch stays open. */
  enabled: boolean;
  reason: string;
}

export interface CreateKillSwitchOptions {
  /** Injectable clock so timestamps stay testable. */
  now?: () => Date;
  /** When true (the default) a request needs a second person to become active. */
  requireApproval?: boolean;
}

export interface KillSwitch {
  /** Requests in creation order, as a read-only view for diagnostics. */
  readonly requests: readonly KillRequest[];
  readonly requireApproval: boolean;
  /** Ask to flip the switch; `pending` when approval is required. */
  request(input: KillRequestInput, by: string): KillRequest;
  /** Second-person approval of a pending request. */
  approve(id: string, approver: string): KillRequest;
  /** Lift a pending or active request; the audit trail keeps who and why. */
  disable(id: string, by: string, reason: string): KillRequest;
  /** First active request covering the resource, or null when nothing blocks it. */
  isBlocked(resource: KillScope): KillRequest | null;
  /** Every request in creation order. */
  list(): KillRequest[];
  /**
   * Replace the requests with ones read back from disk. Ids, states and scopes
   * are validated so a damaged file cannot make a later read crash; a bad
   * record throws `OpsError` and leaves the current requests untouched.
   */
  restore(requests: readonly KillRequest[]): void;
}

/** Validate a scope and drop nothing: absent field means wildcard. */
function normalizeScope(scope: KillScope | undefined): KillScope {
  const out: KillScope = {};
  if (scope?.provider !== undefined) {
    if (!PROVIDERS.includes(scope.provider)) {
      throw new OpsError('invalid_input', `Неизвестный поставщик: ${scope.provider}`);
    }
    out.provider = scope.provider;
  }
  if (scope?.region !== undefined) {
    const region = scope.region.trim();
    if (!region) {
      throw new OpsError('invalid_input', 'Пустое поле области действия: region');
    }
    out.region = region;
  }
  if (scope?.product !== undefined) {
    const product = scope.product.trim();
    if (!product) {
      throw new OpsError('invalid_input', 'Пустое поле области действия: product');
    }
    out.product = product;
  }
  return out;
}

export function createKillSwitch(options: CreateKillSwitchOptions = {}): KillSwitch {
  const now = options.now ?? (() => new Date());
  const requireApproval = options.requireApproval ?? true;
  const stored: KillRequest[] = [];

  function request(input: KillRequestInput, by: string): KillRequest {
    const requester = by?.trim() ?? '';
    if (!requester) {
      throw new OpsError('invalid_input', 'Нужен сотрудник, запрашивающий блокировку');
    }
    const reason = input.reason?.trim() ?? '';
    if (!reason) {
      throw new OpsError('invalid_input', 'Нужна причина блокировки');
    }
    const scope = normalizeScope(input.scope);
    const state = input.enabled ? (requireApproval ? 'pending' : 'active') : 'disabled';
    const created: KillRequest = {
      id: randomUUID(),
      scope,
      enabled: input.enabled,
      reason,
      by: requester,
      at: now().toISOString(),
      state,
    };
    stored.push(created);
    return { ...created, scope: { ...scope } };
  }

  function approve(id: string, approver: string): KillRequest {
    const target = stored.find((item) => item.id === id);
    if (!target) {
      throw new OpsError('not_found', 'Запрос блокировки не найден');
    }
    if (target.state !== 'pending') {
      throw new OpsError('invalid_state', 'Подтвердить можно только ожидающий запрос');
    }
    const second = approver?.trim() ?? '';
    if (!second) {
      throw new OpsError('invalid_input', 'Нужен сотрудник, подтверждающий блокировку');
    }
    if (second === target.by) {
      throw new OpsError('second_person_required', 'Подтверждать блокировку должен другой сотрудник');
    }
    target.approvedBy = second;
    target.state = target.enabled ? 'active' : 'disabled';
    return { ...target, scope: { ...target.scope } };
  }

  function disable(id: string, by: string, reason: string): KillRequest {
    const target = stored.find((item) => item.id === id);
    if (!target) {
      throw new OpsError('not_found', 'Запрос блокировки не найден');
    }
    if (target.state === 'disabled') {
      throw new OpsError('invalid_state', 'Запрос блокировки уже снят');
    }
    const actor = by?.trim() ?? '';
    if (!actor) {
      throw new OpsError('invalid_input', 'Нужен сотрудник, снимающий блокировку');
    }
    if (!reason?.trim()) {
      throw new OpsError('invalid_input', 'Нужна причина снятия блокировки');
    }
    // Who lifted it and why lives in the audit trail; this record only keeps state.
    target.state = 'disabled';
    return { ...target, scope: { ...target.scope } };
  }

  function isBlocked(resource: KillScope): KillRequest | null {
    for (const item of stored) {
      if (item.state !== 'active' || !item.enabled) continue;
      const scope = item.scope;
      const covers =
        (scope.provider === undefined || scope.provider === resource.provider) &&
        (scope.region === undefined || scope.region === resource.region) &&
        (scope.product === undefined || scope.product === resource.product);
      if (covers) return { ...item, scope: { ...scope } };
    }
    return null;
  }

  function list(): KillRequest[] {
    return stored.map((item) => ({ ...item, scope: { ...item.scope } }));
  }

  /** One read-back record, checked hard enough that later reads cannot crash. */
  function checkedRequest(value: KillRequest): KillRequest {
    const id = typeof value?.id === 'string' ? value.id.trim() : '';
    if (!id) {
      throw new OpsError('invalid_input', 'У запроса блокировки нет идентификатора');
    }
    if (value.state !== 'pending' && value.state !== 'active' && value.state !== 'disabled') {
      throw new OpsError('invalid_input', `Неизвестное состояние запроса блокировки: ${String(value.state)}`);
    }
    if (typeof value.enabled !== 'boolean') {
      throw new OpsError('invalid_input', `У запроса блокировки ${id} не указано, включает он блокировку или снимает`);
    }
    const by = typeof value.by === 'string' ? value.by.trim() : '';
    if (!by) {
      throw new OpsError('invalid_input', `У запроса блокировки ${id} нет автора`);
    }
    const reason = typeof value.reason === 'string' ? value.reason.trim() : '';
    if (!reason) {
      throw new OpsError('invalid_input', `У запроса блокировки ${id} нет причины`);
    }
    if (typeof value.at !== 'string' || Number.isNaN(Date.parse(value.at))) {
      throw new OpsError('invalid_input', `У запроса блокировки ${id} нет разборчивого времени`);
    }
    const approvedBy = value.approvedBy === undefined ? undefined : String(value.approvedBy).trim();
    return {
      id,
      scope: normalizeScope(value.scope),
      enabled: value.enabled,
      reason,
      by,
      at: value.at,
      state: value.state,
      ...(approvedBy ? { approvedBy } : {}),
    };
  }

  function restore(requests: readonly KillRequest[]): void {
    if (!Array.isArray(requests)) {
      throw new OpsError('invalid_input', 'Список запросов блокировки должен быть массивом');
    }
    const seen = new Set<string>();
    const candidate = requests.map((value) => {
      const record = checkedRequest(value);
      if (seen.has(record.id)) {
        throw new OpsError('invalid_input', `Запрос блокировки ${record.id} встречается дважды`);
      }
      seen.add(record.id);
      return record;
    });
    stored.length = 0;
    for (const record of candidate) stored.push(record);
  }

  return {
    get requests(): readonly KillRequest[] {
      return stored.slice();
    },
    requireApproval,
    request,
    approve,
    disable,
    isBlocked,
    list,
    restore,
  };
}
