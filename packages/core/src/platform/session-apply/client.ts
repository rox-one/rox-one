/**
 * SessionApply HTTP consumer stub.
 * Fail closed when workbench.conation.sessionApply is off — no network.
 * Never logs or forwards secrets. Origin is configurable; no HMAC/DAYTONA keys here.
 */

import type { HttpFetch } from '../http-fetch.ts';
import {
  DEFAULT_APPLY_PATH,
  DEFAULT_OPERATOR_ORIGIN,
  DEFAULT_READ_PATH,
  SESSION_APPLY_TRANSPORT_OK,
  sessionApplyCompletion,
  SessionApplyFlagOffError,
  SessionApplyHttpError,
  type SessionApplyApplyInput,
  type SessionApplyApplyResult,
  type SessionApplyClientOptions,
  type SessionApplyReadResult,
} from './types.ts';

function originOf(options: SessionApplyClientOptions): string {
  const raw = (options.origin ?? DEFAULT_OPERATOR_ORIGIN).trim().replace(/\/+$/, '');
  return raw.length > 0 ? raw : DEFAULT_OPERATOR_ORIGIN;
}

function requireFlag(options: SessionApplyClientOptions): void {
  if (!options.flagEnabled) throw new SessionApplyFlagOffError();
}

function fetcher(options: SessionApplyClientOptions): HttpFetch {
  const fn = options.fetch ?? (globalThis.fetch as HttpFetch);
  if (typeof fn !== 'function') {
    throw new Error('fetch is unavailable');
  }
  return fn;
}

async function discardUnreadBody(response: Response): Promise<void> {
  try {
    const body = response.body;
    if (body && typeof body.cancel === 'function') {
      await body.cancel();
    }
  } catch {
    // Cleanup failure must not mask the HTTP error.
  }
}

async function readTransportBody(response: Response): Promise<unknown> {
  if (response.status === 204) return null;
  return response.json().catch(() => null);
}

async function requireTransportOk(
  response: Response,
  meta: { origin: string; method: 'GET' | 'POST'; path: string },
): Promise<unknown> {
  if (SESSION_APPLY_TRANSPORT_OK.has(response.status)) {
    return readTransportBody(response);
  }
  await discardUnreadBody(response);
  throw new SessionApplyHttpError({
    status: response.status,
    origin: meta.origin,
    method: meta.method,
    path: meta.path,
  });
}

export class SessionApplyClient {
  constructor(private readonly options: SessionApplyClientOptions) {}

  async read(): Promise<SessionApplyReadResult> {
    requireFlag(this.options);
    const origin = originOf(this.options);
    const path = this.options.readPath ?? DEFAULT_READ_PATH;
    const response = await fetcher(this.options)(`${origin}${path}`, {
      method: 'GET',
      headers: { accept: 'application/json' },
    });
    const body = await requireTransportOk(response, { origin, method: 'GET', path });
    return {
      ok: true,
      origin,
      status: response.status,
      body,
      ...sessionApplyCompletion(response.status),
    };
  }

  async apply(input: SessionApplyApplyInput): Promise<SessionApplyApplyResult> {
    requireFlag(this.options);
    const origin = originOf(this.options);
    const path = this.options.applyPath ?? DEFAULT_APPLY_PATH;
    const response = await fetcher(this.options)(`${origin}${path}`, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({
        workspaceRoot: input.workspaceRoot,
        teamId: input.teamId,
        source: input.source,
      }),
    });
    const body = await requireTransportOk(response, { origin, method: 'POST', path });
    const pointer = `${origin}${path}#team=${input.teamId ?? ''}`;
    return {
      ok: true,
      origin,
      status: response.status,
      body,
      pointer,
      ...sessionApplyCompletion(response.status),
    };
  }
}
