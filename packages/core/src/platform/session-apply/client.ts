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
  SessionApplyFlagOffError,
  SessionApplyHttpError,
  isSessionApplySuccessStatus,
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

function dropBody(response: Response): void {
  try {
    void response.body?.cancel();
  } catch {
    // Best-effort: do not parse or log the error payload.
  }
}

async function readSuccessBody(response: Response): Promise<unknown> {
  if (response.status === 204) return null;
  return response.json().catch(() => null);
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
    if (!isSessionApplySuccessStatus(response.status)) {
      dropBody(response);
      throw new SessionApplyHttpError(response.status, origin);
    }
    const body: unknown = await readSuccessBody(response);
    return { ok: true, origin, status: response.status, body };
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
    if (!isSessionApplySuccessStatus(response.status)) {
      dropBody(response);
      throw new SessionApplyHttpError(response.status, origin);
    }
    const body: unknown = await readSuccessBody(response);
    const pointer = `${origin}${path}#team=${input.teamId ?? ''}`;
    return { ok: true, origin, status: response.status, body, pointer };
  }
}
