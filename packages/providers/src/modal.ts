/**
 * Modal adapter for the vendor-neutral sandbox contract (Rox Cloud, BYOK).
 *
 * Modal has no public HTTP control API: a sandbox is created from Python with
 * the tenant's own token. Rox therefore hosts a thin bridge inside the
 * tenant's Modal workspace and this adapter speaks the bridge's fixed
 * `/v1/sandboxes` contract. `config.apiUrl` is the bridge base and
 * `config.apiKey` is the tenant token, `token_id:token_secret`, sent as a
 * bearer and nowhere else.
 *
 * Nothing in this file writes to the console, and no request or response body
 * ever reaches an error message: sandbox bodies carry tenant env vars.
 *
 * Field translation is the whole job here: the contract speaks
 * `memoryGb/ttlSec/metadata`, the bridge speaks `memory_mb/timeout_sec/tags`.
 * The bridge contract has no snapshot restore, no disk size and no idle
 * timeout, so a spec that asks for one is refused up front instead of being
 * quietly narrowed.
 */

import {
  type SandboxExecOptions,
  type SandboxExecResult,
  type SandboxProvider,
  type SandboxSpec,
  type SandboxState,
  type SandboxStatus,
  capabilityUnavailable,
} from '../../cloud-runner/src/sandbox.ts';
import { CloudRunnerError } from '../../cloud-runner/src/types.ts';
import type { ProviderConfig } from './types.ts';

export const MODAL_PROVIDER_ID = 'modal';

/**
 * Seconds the bridge gives a sandbox when the spec asks for no TTL.
 * Matches the bridge's own 5-minute default, so the reported deadline and the
 * machine's real deadline agree.
 */
export const MODAL_DEFAULT_TIMEOUT_SEC = 300;

/** Modal workspace plan. The free tier has no GPU capacity. */
export type ModalPlan = 'free' | 'paid';

/**
 * `ProviderConfig` plus the workspace plan.
 *
 * The plan rides with the tenant token from the key vault: it is a property of
 * the Modal account, not of a request, and `types.ts` stays plan-free because
 * only Modal prices GPU by plan. Omitting it means "paid" — the bridge then
 * enforces whatever the workspace actually allows.
 */
export interface ModalProviderConfig extends ProviderConfig {
  plan?: ModalPlan;
}

/**
 * Bridge states → contract states.
 *
 * An unknown future state falls back to `starting` so a caller never treats a
 * half-built sandbox as usable.
 */
const MODAL_STATE_MAP: Readonly<Record<string, SandboxState>> = {
  starting: 'starting',
  running: 'running',
  stopped: 'stopped',
  failed: 'failed',
  expired: 'expired',
};

/** Timestamps below this are seconds (Python `time.time()`), above it — ms. */
const EPOCH_MS_FLOOR = 1e12;

/** What the adapter remembers per contract id; the bridge has no lookup by contract id. */
interface SandboxRecord {
  sandboxId: string;
  createdAt: number;
  expiresAt: number;
  state: SandboxState;
  startedAt?: number;
  failureReason?: string;
}

function notFoundError(id: string): CloudRunnerError {
  return new CloudRunnerError(`песочница не найдена: ${id}`, 'not_found');
}

function httpError(operation: string, status: number): CloudRunnerError {
  return new CloudRunnerError(`Мост Modal не выполнил ${operation}: HTTP ${status}`, 'provider_error');
}

/**
 * Bridge timestamps as epoch milliseconds.
 *
 * The bridge may send seconds, milliseconds or an ISO string; all three are
 * accepted so a change of encoding on the Python side does not shift deadlines
 * by three orders of magnitude.
 */
function toEpochMs(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.round(value < EPOCH_MS_FLOOR ? value * 1000 : value);
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? undefined : parsed;
  }
  return undefined;
}

/** POSIX single-quote wrapping for a value interpolated into a shell line. */
function shellQuote(value: string): string {
  return `'${value.split("'").join("'\\''")}'`;
}

/**
 * The bridge runs `bash -lc <command>` with no per-exec cwd, so a requested
 * cwd becomes an explicit `cd` in the same shell line. A missing directory then
 * surfaces as a normal non-zero exit code.
 */
function withCwd(command: string, cwd?: string): string {
  if (cwd === undefined) return command;
  return `cd -- ${shellQuote(cwd)} && ${command}`;
}

/**
 * Contract spec → bridge create body.
 *
 * Optional contract fields are omitted rather than sent as `undefined`, so the
 * bridge keeps its own defaults. `gpu.spot` has no bridge field — Modal bills
 * on-demand capacity — so the hint is not sent and nothing else changes.
 */
function createBody(spec: SandboxSpec, timeoutSec: number): Record<string, unknown> {
  const body: Record<string, unknown> = {
    cpu: Math.max(1, Math.ceil(spec.cpu)),
    memory_mb: Math.max(1, Math.ceil(spec.memoryGb * 1024)),
    timeout_sec: timeoutSec,
  };
  if (spec.gpu !== undefined) {
    body.gpu = { type: spec.gpu.type, count: Math.max(1, Math.ceil(spec.gpu.count)) };
  }
  if (spec.image !== undefined) body.image = spec.image;
  if (spec.env !== undefined) body.env = spec.env;
  if (spec.metadata !== undefined) body.tags = spec.metadata;
  return body;
}

export function createModalProvider(config: ModalProviderConfig): SandboxProvider {
  if (!config.apiKey) {
    throw new CloudRunnerError('modal: не задан ключ провайдера', 'invalid_spec');
  }
  const apiUrl = (config.apiUrl ?? '').trim().replace(/\/+$/, '');
  if (!apiUrl) {
    throw new CloudRunnerError('modal: не задан адрес моста', 'invalid_spec');
  }

  const plan: ModalPlan = config.plan ?? 'paid';
  const doFetch: typeof fetch = config.fetch ?? globalThis.fetch;
  const now = config.now ?? Date.now;

  /** Contract id → bridge sandbox. Makes `create` idempotent without a POST. */
  const records = new Map<string, SandboxRecord>();

  const authHeaders = (extra?: Record<string, string>): Record<string, string> => ({
    Authorization: `Bearer ${config.apiKey}`,
    ...(extra ?? {}),
  });

  const send = async (url: string, init: RequestInit): Promise<Response> => {
    try {
      return await doFetch(url, init);
    } catch (cause) {
      // The message names the endpoint, never the body or the token.
      throw new CloudRunnerError(`Мост Modal недоступен: ${url}`, 'provider_error', { cause });
    }
  };

  const readJson = async (res: Response): Promise<Record<string, unknown>> => {
    let parsed: unknown;
    try {
      parsed = await res.json();
    } catch (cause) {
      throw new CloudRunnerError('Мост Modal вернул ответ не в формате JSON', 'provider_error', {
        cause,
      });
    }
    return parsed !== null && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  };

  const requireRecord = (id: string): SandboxRecord => {
    const record = records.get(id);
    if (!record) throw notFoundError(id);
    return record;
  };

  const applyState = (record: SandboxRecord, raw: string, at: number): void => {
    const mapped = MODAL_STATE_MAP[raw] ?? 'starting';
    record.state = mapped;
    if (mapped === 'running' && record.startedAt === undefined) record.startedAt = at;
    record.failureReason = mapped === 'failed'
      ? `Песочница Modal в состоянии «${raw}»`
      : undefined;
  };

  const toStatus = (id: string, record: SandboxRecord): SandboxStatus => {
    const status: SandboxStatus = {
      id,
      provider: MODAL_PROVIDER_ID,
      state: record.state,
      createdAt: record.createdAt,
      expiresAt: record.expiresAt,
    };
    if (record.startedAt !== undefined) status.startedAt = record.startedAt;
    if (record.failureReason !== undefined) status.failureReason = record.failureReason;
    return status;
  };

  const sandboxUrl = (record: SandboxRecord, suffix = ''): string =>
    `${apiUrl}/v1/sandboxes/${encodeURIComponent(record.sandboxId)}${suffix}`;

  const filesUrl = (record: SandboxRecord, path: string): string =>
    `${sandboxUrl(record, '/files')}?path=${encodeURIComponent(path)}`;

  return {
    providerId: MODAL_PROVIDER_ID,

    async create(spec: SandboxSpec): Promise<SandboxStatus> {
      const existing = records.get(spec.id);
      if (existing) return toStatus(spec.id, existing);

      if (spec.os !== 'linux') {
        throw capabilityUnavailable(MODAL_PROVIDER_ID, `os ${spec.os} (Modal boots Linux only)`);
      }
      if (spec.snapshot !== undefined) {
        throw capabilityUnavailable(MODAL_PROVIDER_ID, 'snapshot restore (the bridge starts from an image)');
      }
      if (spec.diskGb !== undefined) {
        throw capabilityUnavailable(MODAL_PROVIDER_ID, 'disk size (the bridge uses the image default)');
      }
      if (spec.idleTimeoutSec !== undefined) {
        throw capabilityUnavailable(MODAL_PROVIDER_ID, 'idle timeout (only a hard timeout is supported)');
      }
      if (spec.gpu !== undefined && plan === 'free') {
        throw capabilityUnavailable(MODAL_PROVIDER_ID, 'GPU (not offered on the Modal free plan)');
      }

      // `ttlSec` 0 or absent means the shortest life the bridge offers, not an
      // unbounded one: the bridge has no "never expire" mode.
      const timeoutSec = spec.ttlSec !== undefined && spec.ttlSec > 0
        ? Math.ceil(spec.ttlSec)
        : MODAL_DEFAULT_TIMEOUT_SEC;

      const res = await send(`${apiUrl}/v1/sandboxes`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(createBody(spec, timeoutSec)),
      });
      if (!res.ok) throw httpError('create', res.status);
      const payload = await readJson(res);

      const sandboxId = typeof payload.id === 'string' ? payload.id : '';
      if (!sandboxId) {
        throw new CloudRunnerError('Мост Modal не вернул идентификатор песочницы', 'provider_error');
      }

      const createdAt = toEpochMs(payload.created_at) ?? now();
      const record: SandboxRecord = {
        sandboxId,
        createdAt,
        expiresAt: createdAt + timeoutSec * 1000,
        state: 'starting',
      };
      applyState(record, typeof payload.state === 'string' ? payload.state : 'starting', now());
      records.set(spec.id, record);
      return toStatus(spec.id, record);
    },

    async get(id: string): Promise<SandboxStatus> {
      const record = requireRecord(id);
      const res = await send(sandboxUrl(record), { method: 'GET', headers: authHeaders() });
      if (res.status === 404) {
        records.delete(id);
        throw notFoundError(id);
      }
      if (!res.ok) throw httpError('get', res.status);

      const payload = await readJson(res);
      if (typeof payload.state === 'string') applyState(record, payload.state, now());
      const startedAt = toEpochMs(payload.started_at);
      if (startedAt !== undefined) record.startedAt = startedAt;
      return toStatus(id, record);
    },

    async exec(
      id: string,
      command: string,
      opts?: SandboxExecOptions,
    ): Promise<SandboxExecResult> {
      const record = requireRecord(id);
      if (opts?.env !== undefined) {
        throw capabilityUnavailable(MODAL_PROVIDER_ID, 'per-exec env (env is set at create time)');
      }

      const body: Record<string, unknown> = { command: withCwd(command, opts?.cwd) };
      // The bridge's exec timeout is in seconds; the contract speaks ms.
      if (opts?.timeoutMs !== undefined && opts.timeoutMs > 0) {
        body.timeout_sec = Math.max(1, Math.ceil(opts.timeoutMs / 1000));
      }

      const res = await send(sandboxUrl(record, '/exec'), {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(body),
      });
      if (res.status === 404) throw notFoundError(id);
      if (!res.ok) throw httpError('exec', res.status);

      const payload = await readJson(res);
      return {
        stdout: typeof payload.stdout === 'string' ? payload.stdout : '',
        stderr: typeof payload.stderr === 'string' ? payload.stderr : '',
        exitCode: typeof payload.exit_code === 'number' ? payload.exit_code : 0,
      };
    },

    async readFile(id: string, path: string): Promise<Uint8Array> {
      const record = requireRecord(id);
      const res = await send(filesUrl(record, path), { method: 'GET', headers: authHeaders() });
      if (res.status === 404) throw notFoundError(id);
      if (!res.ok) throw httpError('readFile', res.status);
      return new Uint8Array(await res.arrayBuffer());
    },

    async writeFile(id: string, path: string, data: Uint8Array): Promise<void> {
      const record = requireRecord(id);
      const res = await send(filesUrl(record, path), {
        method: 'PUT',
        headers: authHeaders({ 'Content-Type': 'application/octet-stream' }),
        body: data as RequestInit['body'],
      });
      if (res.status === 404) throw notFoundError(id);
      if (!res.ok) throw httpError('writeFile', res.status);
    },

    async stop(id: string): Promise<void> {
      const record = requireRecord(id);
      const res = await send(sandboxUrl(record, '/stop'), {
        method: 'POST',
        headers: authHeaders(),
      });
      if (res.status === 404) throw notFoundError(id);
      if (!res.ok) throw httpError('stop', res.status);
      record.state = 'stopped';
      record.failureReason = undefined;
    },

    async destroy(id: string): Promise<void> {
      const record = requireRecord(id);
      const res = await send(sandboxUrl(record), { method: 'DELETE', headers: authHeaders() });
      records.delete(id);
      // Deleting an already-gone sandbox is the desired end state.
      if (res.status === 404) return;
      if (!res.ok) throw httpError('destroy', res.status);
    },
  };
}
