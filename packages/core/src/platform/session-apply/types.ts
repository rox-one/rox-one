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

/** Transport-level HTTP failure. Never carries response body or secrets. */
export class SessionApplyHttpError extends Error {
  readonly code = 'SESSION_APPLY_HTTP' as const;
  readonly status: number;
  readonly origin: string;
  readonly method: 'GET' | 'POST';
  readonly path: string;

  constructor(input: { status: number; origin: string; method: 'GET' | 'POST'; path: string }) {
    super(`SessionApply HTTP ${input.status}`);
    this.name = 'SessionApplyHttpError';
    this.status = input.status;
    this.origin = input.origin;
    this.method = input.method;
    this.path = input.path;
  }
}

/** 200/204 completed; 202 is transport accepted, not business completed. */
export const SESSION_APPLY_TRANSPORT_OK = new Set([200, 202, 204]);

/**
 * Semantics for a transport-accepted SessionApply response.
 * HTTP errors throw SessionApplyHttpError instead of returning this.
 */
export interface SessionApplyCompletion {
  /** Always true on a returned result: status was 200, 202, or 204. */
  transportAccepted: true;
  /** False for HTTP 202 Accepted. True for 200/204. */
  businessCompleted: boolean;
}

export function sessionApplyCompletion(status: number): SessionApplyCompletion {
  return {
    transportAccepted: true,
    businessCompleted: status !== 202,
  };
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

export interface SessionApplyReadResult extends SessionApplyCompletion {
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

export interface SessionApplyApplyResult extends SessionApplyCompletion {
  ok: true;
  origin: string;
  status: number;
  body: unknown;
  pointer: string;
}
