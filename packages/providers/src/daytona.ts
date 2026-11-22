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
  type ProviderImage,
  type SandboxExecOptions,
  type SandboxExecResult,
  type SandboxFileEntry,
  type SandboxOs,
  type SandboxPreview,
  type SandboxProvider,
  type SandboxSpec,
  type SandboxSshAccess,
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
 * Which system a snapshot boots.
 *
 * Daytona reports snapshots as a bag of `windows*` flags rather than one field,
 * so any Windows marker wins and everything else reads as Linux. macOS is not
 * inferred: a wrong guess would promise a desktop the adapter cannot give.
 */
function snapshotOs(item: Record<string, unknown>): SandboxOs {
  if (typeof item.osType === 'string') {
    const declared = item.osType.trim().toLowerCase();
    if (declared === 'windows' || declared === 'linux' || declared === 'macos') return declared;
  }
  for (const [key, value] of Object.entries(item)) {
    if (key.toLowerCase().startsWith('windows') && value !== undefined && value !== null && value !== false) {
      return 'windows';
    }
  }
  return 'linux';
}

/** A non-negative whole number from a vendor field, or the fallback. */
function wholeNumber(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return Math.round(value);
  return fallback;
}

/**
 * Readable name for a picker: system, cores, memory, and the card if any.
 * A snapshot's own name stays in `ProviderImage.name`; this is the label.
 */
export function snapshotLabel(
  os: SandboxOs,
  cpu: number,
  memoryGb: number,
  gpu?: { type: string; count: number },
): string {
  const system = os === 'windows' ? 'Windows' : os === 'macos' ? 'macOS' : 'Linux';
  const parts = [system, `${cpu} CPU`, `${memoryGb} ГБ`];
  if (gpu !== undefined) {
    const model = gpu.type.trim().toUpperCase();
    parts.push(gpu.count > 1 ? `${gpu.count}×${model}` : model);
  }
  return parts.join(' · ');
}

/** One vendor snapshot → the contract's image shape; `undefined` when unusable. */
function toProviderImage(item: unknown): ProviderImage | undefined {
  if (item === null || typeof item !== 'object' || Array.isArray(item)) return undefined;
  const raw = item as Record<string, unknown>;
  const name = typeof raw.name === 'string' && raw.name.length > 0 ? raw.name : undefined;
  const id = typeof raw.id === 'string' && raw.id.length > 0 ? raw.id : name;
  if (id === undefined || name === undefined) return undefined;

  const os = snapshotOs(raw);
  const cpu = wholeNumber(raw.cpu, DEFAULT_CPU);
  const memoryGb = wholeNumber(raw.mem ?? raw.memory ?? raw.memoryGb, DEFAULT_MEMORY_GB);
  const diskGb = wholeNumber(raw.disk ?? raw.diskGb, DEFAULT_DISK_GB);

  const image: ProviderImage = { id, name, os, cpu, memoryGb, diskGb };
  const gpuType = typeof raw.gpuType === 'string' ? raw.gpuType.trim() : '';
  if (gpuType.length > 0) {
    const count = wholeNumber(raw.gpuCount ?? raw.gpu, 1);
    image.gpu = { type: gpuType, count: count > 0 ? count : 1 };
  }
  if (typeof raw.state === 'string') image.state = raw.state;
  image.label = snapshotLabel(os, cpu, memoryGb, image.gpu);
  return image;
}

/** Snapshots Daytona reports as `active`; anything else cannot be booted today. */
function isActiveImage(item: unknown): boolean {
  if (item === null || typeof item !== 'object') return false;
  const state = (item as Record<string, unknown>).state;
  return typeof state === 'string' && state.trim().toLowerCase() === 'active';
}

/** The default Daytona snapshot's resources; larger asks need a named snapshot. */
const DEFAULT_CPU = 1;
const DEFAULT_MEMORY_GB = 1;
const DEFAULT_DISK_GB = 3;

/**
 * Contract spec → Daytona create body.
 *
 * Daytona's current API builds every sandbox from a snapshot (the default one
 * when none is named) and rejects cpu/memory/disk/gpu together with it:
 * resources are inherited from the snapshot. So the body carries no resources;
 * a request above the default snapshot's 1 CPU / 1 GiB / 3 GiB is refused
 * before any HTTP call instead of being silently downgraded.
 */
function createBody(spec: SandboxSpec): Record<string, unknown> {
  if (spec.snapshot === undefined) {
    if (
      Math.ceil(spec.cpu) > DEFAULT_CPU ||
      Math.ceil(spec.memoryGb) > DEFAULT_MEMORY_GB ||
      (spec.diskGb !== undefined && Math.ceil(spec.diskGb) > DEFAULT_DISK_GB)
    ) {
      throw capabilityUnavailable(
        DAYTONA_PROVIDER_ID,
        'resources above the default snapshot (pass a snapshot with the needed size)',
      );
    }
    if (spec.gpu !== undefined) {
      throw capabilityUnavailable(
        DAYTONA_PROVIDER_ID,
        'gpu without a snapshot (pass a snapshot that carries the GPU)',
      );
    }
  }
  const body: Record<string, unknown> = {
    autoStopInterval: DAYTONA_AUTO_STOP_MINUTES,
    autoDeleteInterval: DAYTONA_AUTO_DELETE_MINUTES,
  };
  if (spec.snapshot !== undefined) body.snapshot = spec.snapshot;
  // Daytona calls the region `target`; omitted means it picks one itself.
  if (spec.region !== undefined) body.target = spec.region;
  if (spec.env !== undefined) body.env = spec.env;
  if (spec.metadata !== undefined) body.labels = spec.metadata;
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

  const delay = (ms: number): Promise<void> => {
    const { promise, resolve } = Promise.withResolvers<void>();
    setTimeout(resolve, ms);
    return promise;
  };

  /**
   * `stop` and `destroy` are safe to repeat, so a vendor 5xx or a dropped
   * connection earns exactly one immediate retry. A 4xx is a decision, not a
   * hiccup, and is never retried. The second failure propagates as is.
   */
  const sendRepeatable = async (url: string, init: RequestInit): Promise<Response> => {
    let first: Response;
    try {
      first = await send(url, init);
    } catch {
      return send(url, init);
    }
    return first.status >= 500 ? send(url, init) : first;
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
      providerRef: record.sandboxId,
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

    /**
     * Snapshots this credential can boot. Only `active` ones: Daytona cannot
     * start anything else, and offering a broken image wastes a customer's
     * minute before the create call fails.
     *
     * The response is read leniently — a bare array, `{items}` or `{data}` —
     * because the vendor has shipped both shapes. Every failure is a
     * `provider_error` that names the endpoint and never the key.
     */
    async listImages(): Promise<ProviderImage[]> {
      const res = await send(`${apiUrl}/snapshots`, { method: 'GET', headers: authHeaders() });
      if (!res.ok) throw httpError('listImages', res.status);
      const payload = await readJson(res);
      const rows: unknown[] = Array.isArray(payload)
        ? (payload as unknown as unknown[])
        : Array.isArray(payload.items)
          ? (payload.items as unknown[])
          : Array.isArray(payload.data)
            ? (payload.data as unknown[])
            : [];
      const images: ProviderImage[] = [];
      for (const item of rows) {
        if (!isActiveImage(item)) continue;
        const image = toProviderImage(item);
        if (image !== undefined) images.push(image);
      }
      return images;
    },

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

    /**
     * Re-attach a sandbox this process did not create. Daytona has no lookup
     * by the contract id, so the caller supplies the vendor id from storage
     * (`SandboxStatus.providerRef`); after this, `get`, `exec`, `stop` and the
     * file routes address the same machine as before the restart.
     */
    adopt(
      id: string,
      providerRef: string,
      state: SandboxState,
      createdAt: number,
      expiresAt?: number,
    ): void {
      if (providerRef.length === 0) {
        throw new CloudRunnerError('daytona: пустой идентификатор песочницы', 'invalid_spec');
      }
      const record: SandboxRecord = { sandboxId: providerRef, createdAt, state };
      if (expiresAt !== undefined) record.expiresAt = expiresAt;
      records.set(id, record);
    },

    /**
     * Snapshot the sandbox filesystem (memory stays out, so the image boots
     * clean) with `POST /sandbox/{vendorId}/snapshot`. Daytona builds
     * asynchronously: the returned state is the vendor's word or `building`
     * when the response is silent, and the same name later shows up in
     * `listImages` as an active image.
     */
    async createSnapshot(id: string, name: string): Promise<{ name: string; state?: string }> {
      const record = requireRecord(id);
      const trimmed = name.trim();
      if (trimmed.length === 0 || trimmed.length > 128 || /[\u0000-\u001f\u007f]/.test(trimmed)) {
        throw new CloudRunnerError('Недопустимое имя снимка', 'invalid_spec');
      }
      const res = await send(sandboxUrl(record, '/snapshot'), {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ name: trimmed, includeMemory: false }),
      });
      if (res.status === 404) throw notFoundError(id);
      if (!res.ok) throw httpError('createSnapshot', res.status);
      const payload = await readJson(res);
      const returnedName = typeof payload.name === 'string' && payload.name.length > 0
        ? payload.name
        : trimmed;
      const returnedState = typeof payload.state === 'string' && payload.state.trim().length > 0
        ? payload.state
        : 'building';
      return { name: returnedName, state: returnedState };
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

    /**
     * Directory entries from the sandbox toolbox. The browser never runs
     * `ls` through a shell, so a file name with a quote or a semicolon stays a
     * name and cannot become a command.
     */
    async listFiles(id: string, path: string): Promise<SandboxFileEntry[]> {
      const record = requireRecord(id);
      if (!path.startsWith('/') || path.split('/').includes('..') || /[\n\r\0]/.test(path)) {
        throw new CloudRunnerError('Недопустимый путь к каталогу', 'invalid_spec');
      }
      const res = await send(
        toolboxUrlFor(record, `/files?path=${encodeURIComponent(path)}`),
        { method: 'GET', headers: authHeaders() },
      );
      if (res.status === 404) throw notFoundError(id);
      if (!res.ok) throw httpError('listFiles', res.status);
      const payload = await readJson(res);
      const rows = Array.isArray(payload) ? payload : [];
      const entries: SandboxFileEntry[] = [];
      for (const item of rows) {
        if (item === null || typeof item !== 'object') continue;
        const raw = item as Record<string, unknown>;
        const name = typeof raw.name === 'string' ? raw.name : '';
        const entryPath = typeof raw.path === 'string' ? raw.path : '';
        if (name.length === 0 || entryPath.length === 0) continue;
        const modified = typeof raw.modifiedAt === 'string' ? Date.parse(raw.modifiedAt) : NaN;
        entries.push({
          name,
          path: entryPath,
          isDir: raw.isDir === true,
          size: wholeNumber(raw.size, 0),
          ...(Number.isFinite(modified) ? { modifiedAt: modified } : {}),
        });
      }
      return entries;
    },

    /**
     * A signed link to one port. Signed means the link itself carries the
     * credential, so it opens in a plain browser tab and can be shared until
     * it expires. The URL is a secret and never appears in an error.
     */
    async previewUrl(id: string, port: number, ttlSec: number): Promise<SandboxPreview> {
      const record = requireRecord(id);
      const ttl = Math.min(Math.max(Math.trunc(ttlSec), 60), 604_800);
      const res = await send(
        sandboxUrl(record, `/ports/${Math.trunc(port)}/signed-preview-url?expiresInSeconds=${ttl}`),
        { method: 'GET', headers: authHeaders() },
      );
      if (res.status === 404) throw notFoundError(id);
      if (!res.ok) throw httpError('previewUrl', res.status);
      const payload = await readJson(res);
      const url = typeof payload.url === 'string' ? payload.url : '';
      if (!/^https:\/\//.test(url)) {
        throw new CloudRunnerError('Daytona не выдал ссылку на порт', 'provider_error');
      }
      return { url, expiresAt: now() + ttl * 1000 };
    },

    /**
     * A one-shot SSH command. Daytona returns the whole `ssh …` line with the
     * credential in the user name; it is handed back untouched and never
     * logged. The gateway accepts it for the requested number of minutes.
     */
    async sshAccess(id: string, ttlSec: number): Promise<SandboxSshAccess> {
      const record = requireRecord(id);
      const minutes = Math.min(Math.max(Math.floor(ttlSec / 60), 1), 1_440);
      const res = await send(sandboxUrl(record, `/ssh-access?expiresInMinutes=${minutes}`), {
        method: 'POST',
        headers: authHeaders(),
      });
      if (res.status === 404) throw notFoundError(id);
      if (!res.ok) throw httpError('sshAccess', res.status);
      const payload = await readJson(res);
      const command = typeof payload.sshCommand === 'string' ? payload.sshCommand.trim() : '';
      if (!/^ssh [^\n\r]+$/.test(command)) {
        throw new CloudRunnerError('Daytona не выдал команду SSH', 'provider_error');
      }
      const parsed = typeof payload.expiresAt === 'string' ? Date.parse(payload.expiresAt) : NaN;
      return {
        command,
        expiresAt: Number.isFinite(parsed) ? parsed : now() + minutes * 60_000,
      };
    },

    async stop(id: string): Promise<void> {
      const record = requireRecord(id);
      const res = await sendRepeatable(sandboxUrl(record, '/stop'), {
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
      let res = await sendRepeatable(sandboxUrl(record), {
        method: 'DELETE',
        headers: authHeaders(),
      });
      // A stopped Daytona sandbox deletes itself; a DELETE that lands in that
      // window answers 409. Waiting briefly and asking again turns the race
      // into the desired end state instead of a fake provider outage.
      for (const waitMs of [300, 700]) {
        if (res.status !== 409) break;
        await delay(waitMs);
        res = await sendRepeatable(sandboxUrl(record), {
          method: 'DELETE',
          headers: authHeaders(),
        });
      }
      records.delete(id);
      // Deleting an already-gone sandbox is the desired end state.
      if (res.status === 404 || res.ok) return;
      if (res.status === 409) {
        throw new CloudRunnerError(
          'Daytona ещё удаляет песочницу; повторите запрос через несколько секунд',
          'provider_error',
        );
      }
      throw httpError('destroy', res.status);
    },
  };
}
