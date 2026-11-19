/**
 * Daytona adapter for the vendor-neutral sandbox contract (Rox Cloud, BYOK).
 *
 * One tenant key per provider instance; the key lives only in the
 * `Authorization` header of a request made with the injected `fetch`.
 * Nothing in this file writes to the console, and request and response
 * bodies (which carry tenant env vars and labels) never reach an error
 * message.
 *
 * Field translation is the whole job here: the contract speaks
 * `memoryGb/diskGb/ttlSec/metadata`, Daytona speaks
 * `memory/disk/ttlMinutes/labels`. Daytona has no `image` field — an image
 * is a snapshot or a dockerfile build — so an image without a snapshot is
 * refused up front instead of being silently dropped.
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

export const DAYTONA_PROVIDER_ID = 'daytona';
export const DAYTONA_DEFAULT_API_URL = 'https://app.daytona.io/api';
export const DAYTONA_DEFAULT_TOOLBOX_URL = 'https://proxy.app.daytona.io/toolbox';
/** Minutes of inactivity before Daytona stops (not deletes) the sandbox. */
export const DAYTONA_AUTO_STOP_MINUTES = 15;
/** 0 = never auto-delete: the contract TTL plus `destroy` own the lifetime. */
export const DAYTONA_AUTO_DELETE_MINUTES = 0;

/**
 * Daytona states → contract states.
 *
 * Transitions are mapped conservatively: an unknown future state falls back
 * to `starting` so a caller never treats a half-built sandbox as usable.
 */
const DAYTONA_STATE_MAP: Readonly<Record<string, SandboxState>> = {
  pending_build: 'queued',
  building_snapshot: 'starting',
  pulling_snapshot: 'starting',
  creating: 'starting',
  restoring: 'starting',
  starting: 'starting',
  resuming: 'starting',
  started: 'running',
  resizing: 'running',
  snapshotting: 'running',
  forking: 'running',
  pausing: 'stopping',
  archiving: 'stopping',
  stopping: 'stopping',
  destroying: 'stopping',
  paused: 'paused',
  stopped: 'stopped',
  archived: 'stopped',
  error: 'failed',
  build_failed: 'failed',
};

/** States in which the sandbox has already reported a failure. */
const DAYTONA_FAILED_STATE: Readonly<Record<string, true>> = {
  error: true,
  build_failed: true,
};

/** What the adapter remembers per contract id; there is no vendor lookup by contract id. */
interface SandboxRecord {
  sandboxId: string;
  createdAt: number;
  expiresAt?: number;
  state: SandboxState;
  startedAt?: number;
  failureReason?: string;
}

function notFoundError(id: string): CloudRunnerError {
  return new CloudRunnerError(`песочница не найдена: ${id}`, 'not_found');
}

function httpError(operation: string, status: number): CloudRunnerError {
  return new CloudRunnerError(`Daytona не выполнил ${operation}: HTTP ${status}`, 'provider_error');
}

/**
 * Contract spec → Daytona create body.
 *
 * Optional contract fields are omitted rather than sent as `undefined`, so
 * the vendor keeps its own defaults.
 */
function createBody(spec: SandboxSpec): Record<string, unknown> {
  const body: Record<string, unknown> = {
    cpu: Math.max(1, Math.ceil(spec.cpu)),
    memory: Math.max(1, Math.ceil(spec.memoryGb)),
    autoStopInterval: DAYTONA_AUTO_STOP_MINUTES,
    autoDeleteInterval: DAYTONA_AUTO_DELETE_MINUTES,
  };
  if (spec.snapshot !== undefined) body.snapshot = spec.snapshot;
  if (spec.diskGb !== undefined) body.disk = Math.max(1, Math.ceil(spec.diskGb));
  if (spec.gpu !== undefined) {
    body.gpu = Math.max(1, Math.ceil(spec.gpu.count));
    body.gpuType = [spec.gpu.type];
    if (spec.gpu.spot !== undefined) body.spot = spec.gpu.spot;
  }
  if (spec.env !== undefined) body.env = spec.env;
  if (spec.metadata !== undefined) body.labels = spec.metadata;
  // ttlSec 0 means "unbounded" in the contract, so no TTL is sent for it.
  if (spec.ttlSec !== undefined && spec.ttlSec > 0) {
    body.ttlMinutes = Math.max(1, Math.ceil(spec.ttlSec / 60));
  }
  return body;
}

export function createDaytonaProvider(config: ProviderConfig): SandboxProvider {
  if (!config.apiKey) {
    throw new CloudRunnerError('daytona: не задан ключ провайдера', 'invalid_spec');
  }

  const apiUrl = (config.apiUrl || DAYTONA_DEFAULT_API_URL).replace(/\/+$/, '');
  const toolboxUrl = (config.toolboxUrl || DAYTONA_DEFAULT_TOOLBOX_URL).replace(/\/+$/, '');
  const doFetch: typeof fetch = config.fetch ?? globalThis.fetch;
  const now = config.now ?? Date.now;

  /** Contract id → Daytona sandbox. Makes `create` idempotent without a POST. */
  const records = new Map<string, SandboxRecord>();

  const authHeaders = (extra?: Record<string, string>): Record<string, string> => ({
    Authorization: `Bearer ${config.apiKey}`,
    ...(extra ?? {}),
  });

  const send = async (url: string, init: RequestInit): Promise<Response> => {
    try {
      return await doFetch(url, init);
    } catch (cause) {
      // The message names the endpoint, never the body or the key.
      throw new CloudRunnerError(`Daytona недоступен: ${url}`, 'provider_error', { cause });
    }
  };

  const readJson = async (res: Response): Promise<Record<string, unknown>> => {
    let parsed: unknown;
    try {
      parsed = await res.json();
    } catch (cause) {
      throw new CloudRunnerError('Daytona вернул ответ не в формате JSON', 'provider_error', { cause });
    }
    return parsed !== null && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  };

  const requireRecord = (id: string): SandboxRecord => {
    const record = records.get(id);
    if (!record) throw notFoundError(id);
    return record;
  };

  const applyState = (record: SandboxRecord, raw: string, at: number): void => {
    let mapped = DAYTONA_STATE_MAP[raw] ?? 'starting';
    // A sandbox the vendor already stopped is `expired` once our TTL passed.
    if (mapped === 'stopped' && record.expiresAt !== undefined && at >= record.expiresAt) {
      mapped = 'expired';
    }
    record.state = mapped;
    if (mapped === 'running' && record.startedAt === undefined) record.startedAt = at;
    record.failureReason = DAYTONA_FAILED_STATE[raw] === true
      ? `Песочница Daytona в состоянии «${raw}»`
      : undefined;
  };

  const toStatus = (id: string, record: SandboxRecord): SandboxStatus => {
    const status: SandboxStatus = {
      id,
      provider: DAYTONA_PROVIDER_ID,
      state: record.state,
      createdAt: record.createdAt,
    };
    if (record.startedAt !== undefined) status.startedAt = record.startedAt;
    if (record.expiresAt !== undefined) status.expiresAt = record.expiresAt;
    if (record.failureReason !== undefined) status.failureReason = record.failureReason;
    return status;
  };

  const sandboxUrl = (record: SandboxRecord, suffix = ''): string =>
    `${apiUrl}/sandbox/${encodeURIComponent(record.sandboxId)}${suffix}`;

  const toolboxUrlFor = (record: SandboxRecord, suffix: string): string =>
    `${toolboxUrl}/${encodeURIComponent(record.sandboxId)}${suffix}`;

  return {
    providerId: DAYTONA_PROVIDER_ID,

    async create(spec: SandboxSpec): Promise<SandboxStatus> {
      const existing = records.get(spec.id);
      if (existing) return toStatus(spec.id, existing);

      if (spec.image !== undefined && spec.snapshot === undefined) {
        throw capabilityUnavailable(DAYTONA_PROVIDER_ID, 'image (use a snapshot instead)');
      }

      const res = await send(`${apiUrl}/sandbox`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(createBody(spec)),
      });
      if (!res.ok) throw httpError('create', res.status);
      const payload = await readJson(res);

      const sandboxId = typeof payload.id === 'string' ? payload.id : '';
      if (!sandboxId) {
        throw new CloudRunnerError('Daytona не вернул идентификатор песочницы', 'provider_error');
      }

      const createdAt = now();
      const record: SandboxRecord = { sandboxId, createdAt, state: 'starting' };
      if (spec.ttlSec !== undefined && spec.ttlSec > 0) {
        record.expiresAt = createdAt + spec.ttlSec * 1000;
      }
      applyState(record, typeof payload.state === 'string' ? payload.state : 'creating', createdAt);
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
      return toStatus(id, record);
    },

    async exec(
      id: string,
      command: string,
      opts?: SandboxExecOptions,
    ): Promise<SandboxExecResult> {
      const record = requireRecord(id);
      const body: Record<string, unknown> = { command };
      // Daytona's execute timeout is in seconds; the contract speaks ms.
      if (opts?.timeoutMs !== undefined && opts.timeoutMs > 0) {
        body.timeout = Math.max(1, Math.ceil(opts.timeoutMs / 1000));
      }
      if (opts?.cwd !== undefined) body.cwd = opts.cwd;
      if (opts?.env !== undefined) body.env = opts.env;

      const res = await send(toolboxUrlFor(record, '/process/execute'), {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(body),
      });
      if (res.status === 404) throw notFoundError(id);
      if (!res.ok) throw httpError('exec', res.status);

      const payload = await readJson(res);
      return {
        stdout: typeof payload.result === 'string' ? payload.result : '',
        stderr: '',
        exitCode: typeof payload.exitCode === 'number' ? payload.exitCode : 0,
      };
    },

    async readFile(id: string, path: string): Promise<Uint8Array> {
      const record = requireRecord(id);
      const url = toolboxUrlFor(record, `/files/download?path=${encodeURIComponent(path)}`);
      const res = await send(url, { method: 'GET', headers: authHeaders() });
      if (res.status === 404) throw notFoundError(id);
      if (!res.ok) throw httpError('readFile', res.status);
      return new Uint8Array(await res.arrayBuffer());
    },

    async writeFile(id: string, path: string, data: Uint8Array): Promise<void> {
      const record = requireRecord(id);
      const url = toolboxUrlFor(record, `/files/upload-v2?path=${encodeURIComponent(path)}`);
      const res = await send(url, {
        method: 'POST',
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
