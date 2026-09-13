/**
 * Rox SessionApply consumer stub types.
 * Flag `workbench.conation.sessionApply` stays default false.
 * Not Cordis. Not a second orchestrator.
 */

import type { HttpFetch } from '../http-fetch.ts';

export const DEFAULT_OPERATOR_ORIGIN = 'https://conation.dev';
export const DEFAULT_READ_PATH = '/session-apply';
export const DEFAULT_APPLY_PATH = '/session-apply';

export class SessionApplyFlagOffError extends Error {
  readonly code = 'SESSION_APPLY_FLAG_OFF' as const;
  constructor() {
    super('workbench.conation.sessionApply is off');
    this.name = 'SessionApplyFlagOffError';
  }
}

export class SessionApplyHttpError extends Error {
  readonly code = 'SESSION_APPLY_HTTP' as const;
  readonly status: number;
  readonly origin: string;
  constructor(status: number, origin: string) {
    super(`SessionApply HTTP ${status}`);
    this.name = 'SessionApplyHttpError';
    this.status = status;
    this.origin = origin;
  }
}

export const SESSION_APPLY_SUCCESS_STATUSES = [200, 202, 204] as const;

export function isSessionApplySuccessStatus(status: number): boolean {
  return (SESSION_APPLY_SUCCESS_STATUSES as readonly number[]).includes(status);
}

export interface SessionApplyClientOptions {
  /** Operator origin. Default https://conation.dev */
  origin?: string;
  /** Must be true to touch the network. */
  flagEnabled: boolean;
  readPath?: string;
  applyPath?: string;
  fetch?: HttpFetch;
}

export interface SessionApplyReadResult {
  ok: true;
  origin: string;
  status: number;
  body: unknown;
}

export interface SessionApplyApplyInput {
  workspaceRoot: string;
  teamId?: string;
  source?: string;
}

export interface SessionApplyApplyResult {
  ok: true;
  origin: string;
  status: number;
  body: unknown;
  pointer: string;
}
