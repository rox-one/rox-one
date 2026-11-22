/**
 * E2B adapter for the vendor-neutral sandbox contract (Rox Cloud, BYOK).
 *
 * E2B has a public HTTP API, so there is no bridge in between: sandboxes are
 * created on `api.e2b.app` with the tenant's `X-API-Key`, and every command or
 * file operation goes to `sandbox.e2b.app`, routed to one machine by the
 * `E2b-Sandbox-Id` header plus the per-sandbox `X-Access-Token` issued at
 * create time.
 *
 * Nothing in this file writes to the console. The tenant key, the sandbox
 * access token, the command text and the file bytes never reach an error
 * message: messages name an operation and an HTTP status only.
 *
 * Field translation is the job here, and E2B narrows three contract fields:
 * templates are fixed-size except for `cpuCount` (so `memoryGb` has no wire
 * field — the template decides it), there is no disk size and no `image`
 * (a template or a snapshot is the base). The two that would silently change
 * the machine, `diskGb` and `image` without `snapshot`, are refused up front.
 *
 * Exec speaks Connect: one framed request (`flags=0`, four-byte big-endian
 * length, UTF-8 JSON), then a stream of framed `StartResponse` events ending
 * in a `flags=2` frame that may carry an error while HTTP stays 200.
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

export const E2B_PROVIDER_ID = 'e2b';
export const E2B_DEFAULT_API_URL = 'https://api.e2b.app';
export const E2B_DEFAULT_SANDBOX_HOST = 'https://sandbox.e2b.app';
/** Seconds E2B gives a sandbox when the spec asks for no TTL (E2B's own default). */
export const E2B_DEFAULT_TIMEOUT_SEC = 300;
/**
 * Port envd (the in-sandbox agent) listens on. The sandbox host routes by this
 * header; the API documents it as required with this default.
 */
export const E2B_ENVD_PORT = 49983;

/** One-byte flags plus four-byte big-endian length. */
const CONNECT_FRAME_PREFIX = 5;
/** Connect flag bit: this frame finishes the stream. */
const CONNECT_END_STREAM_FLAG = 2;

/**
 * `ProviderConfig` plus the two E2B settings that belong to the tenant account
 * rather than to one request: the template used when a spec carries no
 * snapshot, and the sandbox host a self-hosted E2B deployment uses.
 */
export interface E2BProviderConfig extends ProviderConfig {
  /** Template id used when `SandboxSpec.snapshot` is absent. */
  defaultTemplate?: string;
  /** Sandbox proxy base URL; defaults to the public one. */
  sandboxHost?: string;
}

/** What the adapter remembers per contract id; E2B has no lookup by contract id. */
interface SandboxRecord {
  sandboxId: string;
  /** Per-sandbox envd token; required by every exec and file call. */
  accessToken: string;
  createdAt: number;
  expiresAt?: number;
  state: SandboxState;
  startedAt?: number;
}

function notFoundError(id: string): CloudRunnerError {
  return new CloudRunnerError(`песочница не найдена: ${id}`, 'not_found');
}

function httpError(operation: string, status: number): CloudRunnerError {
  return new CloudRunnerError(`E2B не выполнил ${operation}: HTTP ${status}`, 'provider_error');
}

/** Narrows an unknown JSON value to an object without asserting its fields. */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
}

/**
 * E2B keys must match `^[a-z0-9-]{1,255}$`. A contract id is only required to
 * be unique, so an id outside that alphabet is folded into a valid key and
 * suffixed with a stable hash: two different contract ids never share a key,
 * and repeating a request always sends the same one.
 */
function idempotencyKey(id: string): string {
  if (/^[a-z0-9-]{1,255}$/.test(id)) return id;
  const folded = id.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 240);
  let hash = 0x811c9dc5;
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${folded || 'sbx'}-${hash.toString(36)}`;
}

/** Contract spec → E2B create body. Optional fields are omitted, not `undefined`. */
function createBody(spec: SandboxSpec, templateId: string, timeoutSec: number): Record<string, unknown> {
  const body: Record<string, unknown> = {
    templateID: templateId,
    timeout: timeoutSec,
    cpuCount: Math.max(1, Math.ceil(spec.cpu)),
  };
  if (spec.metadata !== undefined) body.metadata = spec.metadata;
  if (spec.env !== undefined) body.envVars = spec.env;
  return body;
}

/** One Connect request frame: `flags=0`, big-endian length, UTF-8 JSON. */
function connectFrame(message: unknown): Uint8Array {
  const payload = new TextEncoder().encode(JSON.stringify(message));
  const frame = new Uint8Array(CONNECT_FRAME_PREFIX + payload.length);
  const view = new DataView(frame.buffer);
  view.setUint8(0, 0);
  view.setUint32(1, payload.length, false);
  frame.set(payload, CONNECT_FRAME_PREFIX);
  return frame;
}

interface ConnectStream {
  messages: Record<string, unknown>[];
  /** Payload of the `flags=2` frame, when the stream carried one. */
  endStream?: Record<string, unknown>;
}

/** Splits a Connect response body into its frames; truncation is a provider error. */
function parseConnectStream(bytes: Uint8Array): ConnectStream {
  const messages: Record<string, unknown>[] = [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();
  let offset = 0;
  while (offset < view.byteLength) {
    if (view.byteLength - offset < CONNECT_FRAME_PREFIX) {
      throw new CloudRunnerError('E2B вернул обрезанный кадр ответа', 'provider_error');
    }
    const flags = view.getUint8(offset);
    const length = view.getUint32(offset + 1, false);
    offset += CONNECT_FRAME_PREFIX;
    if (length > view.byteLength - offset) {
      throw new CloudRunnerError('E2B вернул обрезанный кадр ответа', 'provider_error');
    }
    const payload = bytes.subarray(offset, offset + length);
    offset += length;
    let parsed: unknown;
    try {
      parsed = JSON.parse(decoder.decode(payload));
    } catch (cause) {
      throw new CloudRunnerError('E2B вернул кадр не в формате JSON', 'provider_error', { cause });
    }
    const message = asRecord(parsed) ?? {};
    if ((flags & CONNECT_END_STREAM_FLAG) !== 0) return { messages, endStream: message };
    messages.push(message);
  }
  return { messages };
}

/** Base64 field of a data event as text; anything else is an empty chunk. */
function decodeBase64Field(value: unknown): string {
  if (typeof value !== 'string' || value === '') return '';
  try {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return new TextDecoder().decode(bytes);
  } catch (cause) {
    throw new CloudRunnerError('E2B вернул вывод команды не в формате base64', 'provider_error', {
      cause,
    });
  }
}

/** ISO timestamp from the API as epoch milliseconds. */
function toEpochMs(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

export function createE2BProvider(config: E2BProviderConfig): SandboxProvider {
  if (!config.apiKey) {
    throw new CloudRunnerError('e2b: не задан ключ провайдера', 'invalid_spec');
  }

  const apiUrl = (config.apiUrl || E2B_DEFAULT_API_URL).replace(/\/+$/, '');
  const sandboxHost = (config.sandboxHost || E2B_DEFAULT_SANDBOX_HOST).replace(/\/+$/, '');
  const doFetch: typeof fetch = config.fetch ?? globalThis.fetch;
  const now = config.now ?? Date.now;

  /** Contract id → E2B sandbox. Makes `create` idempotent without a POST. */
  const records = new Map<string, SandboxRecord>();

  const apiHeaders = (extra?: Record<string, string>): Record<string, string> => ({
    'X-API-Key': config.apiKey,
    ...(extra ?? {}),
  });

  const sandboxHeaders = (record: SandboxRecord, extra?: Record<string, string>): Record<string, string> => ({
    'E2b-Sandbox-Id': record.sandboxId,
    'E2b-Sandbox-Port': String(E2B_ENVD_PORT),
    'X-Access-Token': record.accessToken,
    ...(extra ?? {}),
  });

  const send = async (url: string, init: RequestInit): Promise<Response> => {
    try {
      return await doFetch(url, init);
    } catch (cause) {
      // The message names the endpoint, never the headers or the body.
      throw new CloudRunnerError(`E2B недоступен: ${url}`, 'provider_error', { cause });
    }
  };

  const readJson = async (res: Response): Promise<Record<string, unknown>> => {
    let parsed: unknown;
    try {
      parsed = await res.json();
    } catch (cause) {
      throw new CloudRunnerError('E2B вернул ответ не в формате JSON', 'provider_error', { cause });
    }
    return asRecord(parsed) ?? {};
  };

  const requireRecord = (id: string): SandboxRecord => {
    const record = records.get(id);
    if (!record) throw notFoundError(id);
    return record;
  };

  const sandboxUrl = (record: SandboxRecord, suffix = ''): string =>
    `${apiUrl}/sandboxes/${encodeURIComponent(record.sandboxId)}${suffix}`;

  const filesUrl = (record: SandboxRecord, path: string): string =>
    `${sandboxHost}/files?path=${encodeURIComponent(path)}`;

  const toStatus = (id: string, record: SandboxRecord): SandboxStatus => {
    const status: SandboxStatus = {
      id,
      provider: E2B_PROVIDER_ID,
      state: record.state,
      createdAt: record.createdAt,
    };
    if (record.startedAt !== undefined) status.startedAt = record.startedAt;
    if (record.expiresAt !== undefined) status.expiresAt = record.expiresAt;
    return status;
  };

  return {
    providerId: E2B_PROVIDER_ID,

    async create(spec: SandboxSpec): Promise<SandboxStatus> {
      const existing = records.get(spec.id);
      if (existing) return toStatus(spec.id, existing);

      // Refuse what E2B cannot deliver before spending a request.
      if (spec.os !== 'linux') {
        throw capabilityUnavailable(E2B_PROVIDER_ID, `os ${spec.os} (E2B boots Linux only)`);
      }
      if (spec.gpu !== undefined) {
        throw capabilityUnavailable(E2B_PROVIDER_ID, 'GPU (E2B sandboxes are CPU-only)');
      }
      if (spec.diskGb !== undefined) {
        throw capabilityUnavailable(E2B_PROVIDER_ID, 'disk size (the template fixes the disk)');
      }
      if (spec.image !== undefined && spec.snapshot === undefined) {
        throw capabilityUnavailable(E2B_PROVIDER_ID, 'image (use a template or a snapshot instead)');
      }

      const templateId = spec.snapshot ?? config.defaultTemplate;
      if (templateId === undefined || templateId === '') {
        throw new CloudRunnerError(
          'e2b: не задан шаблон песочницы (spec.snapshot или defaultTemplate)',
          'invalid_spec',
        );
      }

      // E2B rejects `timeout: 0`, and the contract's 0 means "unbounded", which
      // E2B has no mode for: both fall back to the vendor's own 300 s default
      // rather than to a one-second sandbox that expires during boot.
      const timeoutSec = spec.ttlSec !== undefined && spec.ttlSec > 0
        ? Math.max(1, Math.ceil(spec.ttlSec))
        : E2B_DEFAULT_TIMEOUT_SEC;

      const res = await send(`${apiUrl}/v2/sandboxes`, {
        method: 'POST',
        headers: apiHeaders({
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey(spec.id),
        }),
        body: JSON.stringify(createBody(spec, templateId, timeoutSec)),
      });
      if (!res.ok) throw httpError('create', res.status);
      const payload = await readJson(res);

      const sandboxId = typeof payload.sandboxID === 'string' ? payload.sandboxID : '';
      if (!sandboxId) {
        throw new CloudRunnerError('E2B не вернул идентификатор песочницы', 'provider_error');
      }
      // Every exec and file call authenticates with this token, so a sandbox
      // without one could be created but never used.
      const accessToken = typeof payload.envdAccessToken === 'string' ? payload.envdAccessToken : '';
      if (!accessToken) {
        throw new CloudRunnerError('E2B не вернул токен доступа к песочнице', 'provider_error');
      }

      const createdAt = now();
      const record: SandboxRecord = {
        sandboxId,
        accessToken,
        createdAt,
        expiresAt: createdAt + timeoutSec * 1000,
        // E2B boots in well under a second and the create call returns the
        // running sandbox, so the contract needs no "starting" step here.
        state: 'running',
        startedAt: createdAt,
      };
      records.set(spec.id, record);
      return toStatus(spec.id, record);
    },

    async get(id: string): Promise<SandboxStatus> {
      const record = requireRecord(id);
      const res = await send(sandboxUrl(record), { method: 'GET', headers: apiHeaders() });
      if (res.status === 404) {
        records.delete(id);
        throw notFoundError(id);
      }
      if (!res.ok) throw httpError('get', res.status);

      const payload = await readJson(res);
      // E2B knows two states. A paused sandbox is resumable, so it reads as
      // `stopped`; an unknown future state must not look usable.
      if (payload.state === 'running') record.state = 'running';
      else if (payload.state === 'paused') record.state = 'stopped';
      else record.state = 'starting';

      const startedAt = toEpochMs(payload.startedAt);
      if (startedAt !== undefined) record.startedAt = startedAt;
      const endAt = toEpochMs(payload.endAt);
      if (endAt !== undefined) record.expiresAt = endAt;
      return toStatus(id, record);
    },

    async exec(
      id: string,
      command: string,
      opts?: SandboxExecOptions,
    ): Promise<SandboxExecResult> {
      const record = requireRecord(id);
      const processConfig: Record<string, unknown> = { cmd: 'bash', args: ['-lc', command] };
      if (opts?.cwd !== undefined) processConfig.cwd = opts.cwd;
      if (opts?.env !== undefined) processConfig.envs = opts.env;

      const headers = sandboxHeaders(record, {
        'Content-Type': 'application/connect+json',
        'Connect-Protocol-Version': '1',
      });
      if (opts?.timeoutMs !== undefined && opts.timeoutMs > 0) {
        headers['Connect-Timeout-Ms'] = String(Math.max(1, Math.ceil(opts.timeoutMs)));
      }

      const res = await send(`${sandboxHost}/process.Process/Start`, {
        method: 'POST',
        headers,
        body: connectFrame({ process: processConfig, stdin: false }) as RequestInit['body'],
      });
      if (res.status === 404) throw notFoundError(id);
      if (!res.ok) throw httpError('exec', res.status);

      const stream = parseConnectStream(new Uint8Array(await res.arrayBuffer()));
      const endStream = stream.endStream;
      if (endStream === undefined) {
        throw new CloudRunnerError('E2B оборвал поток выполнения без завершающего кадра', 'provider_error');
      }
      // HTTP 200 still carries RPC failures in the end-stream frame. The vendor
      // message may quote the command, so only the operation is reported.
      if (endStream.error !== undefined && endStream.error !== null) {
        throw new CloudRunnerError('E2B прервал выполнение команды', 'provider_error');
      }

      let stdout = '';
      let stderr = '';
      let exitCode: number | undefined;
      for (const message of stream.messages) {
        const event = asRecord(message.event);
        if (event === undefined) continue;
        const data = asRecord(event.data);
        if (data !== undefined) {
          stdout += decodeBase64Field(data.stdout);
          stdout += decodeBase64Field(data.pty);
          stderr += decodeBase64Field(data.stderr);
        }
        const end = asRecord(event.end);
        if (end !== undefined && typeof end.exitCode === 'number') exitCode = end.exitCode;
      }

      // A stream that ended without an exit code (the sandbox died mid-command)
      // is not success: reporting 0 would hide it.
      if (exitCode === undefined) {
        throw new CloudRunnerError('E2B не сообщил код завершения команды', 'provider_error');
      }
      return { stdout, stderr, exitCode };
    },

    async readFile(id: string, path: string): Promise<Uint8Array> {
      const record = requireRecord(id);
      const res = await send(filesUrl(record, path), {
        method: 'GET',
        headers: sandboxHeaders(record),
      });
      // Here a 404 means the file is missing, not the sandbox, so it stays an
      // operation error instead of forgetting the sandbox.
      if (!res.ok) throw httpError('readFile', res.status);
      return new Uint8Array(await res.arrayBuffer());
    },

    async writeFile(id: string, path: string, data: Uint8Array): Promise<void> {
      const record = requireRecord(id);
      const res = await send(filesUrl(record, path), {
        method: 'POST',
        headers: sandboxHeaders(record, { 'Content-Type': 'application/octet-stream' }),
        body: data as RequestInit['body'],
      });
      if (!res.ok) throw httpError('writeFile', res.status);
    },

    async stop(id: string): Promise<void> {
      const record = requireRecord(id);
      const res = await send(sandboxUrl(record, '/pause'), {
        method: 'POST',
        headers: apiHeaders(),
      });
      if (res.status === 404) throw notFoundError(id);
      if (!res.ok) throw httpError('stop', res.status);
      record.state = 'stopped';
    },

    async destroy(id: string): Promise<void> {
      const record = requireRecord(id);
      const res = await send(sandboxUrl(record), { method: 'DELETE', headers: apiHeaders() });
      // Deleting an already-gone sandbox is the desired end state. On any other
      // failure the id is kept, so a retry can still find and delete the sandbox.
      if (res.status === 404) {
        records.delete(id);
        return;
      }
      if (!res.ok) throw httpError('destroy', res.status);
      records.delete(id);
    },
  };
}
