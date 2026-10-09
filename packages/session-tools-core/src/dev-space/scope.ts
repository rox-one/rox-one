/**
 * Shared helpers for the dev-space session tools: resolve the workspace scope
 * from the session context, validate the artifact-id boundary, map typed errors,
 * and require the registered runtime with a typed unavailable error.
 *
 * Mirrors `knowledge/format.ts` + `skills/scope.ts`: no runtime registered in
 * this process (e.g. the Codex session-mcp-server subprocess) is a typed
 * DEVSPACE_UNAVAILABLE, never a hang and never a raw throw.
 */

import type { SessionToolContext } from '../context.ts';
import type { ToolResult } from '../types.ts';
import { errorResponse } from '../response.ts';
import { getDevSpaceToolRuntime, type DevSpaceToolRuntime } from './runtime.ts';

/**
 * Typed dev-space failure. Codes cross verbatim into the tool result the way
 * KnowledgeError codes do (`[ERROR] <CODE>: …`).
 */
export type DevSpaceErrorCode =
  | 'INVALID_ARGUMENT'
  | 'NOT_FOUND'
  | 'PROVIDER_ERROR'
  | 'CAPABILITY_DISABLED';

export class DevSpaceError extends Error {
  readonly code: DevSpaceErrorCode;
  constructor(code: DevSpaceErrorCode, message: string) {
    super(message);
    this.name = 'DevSpaceError';
    this.code = code;
  }
}

/** Artifact-id grammar: opaque key from devspace_search; never a path. */
const DEVSPACE_ARTIFACT_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;

/** True for a well-formed artifact id (guards the read/propose boundary). */
export function isDevSpaceArtifactId(value: unknown): value is string {
  return typeof value === 'string' && DEVSPACE_ARTIFACT_ID.test(value) && !value.includes('..');
}

/** The workspace scope a dev-space tool resolves artifacts against. */
export function devSpaceRuntimeScope(ctx: SessionToolContext): { workspaceRoot: string } {
  return { workspaceRoot: typeof ctx.workspacePath === 'string' ? ctx.workspacePath : '' };
}

/** Ellipsis-truncate to maxChars, appending a marker only when truncation happened. */
export function truncateText(text: string, maxChars: number): string {
  return text.length <= maxChars ? text : `${text.slice(0, maxChars)}…`;
}

/** Map any thrown value onto a typed tool error; DevSpaceError codes pass through verbatim. */
export function devSpaceErrorResponse(error: unknown): ToolResult {
  if (error instanceof DevSpaceError) return errorResponse(`${error.code}: ${error.message}`);
  const message = error instanceof Error ? error.message : String(error);
  return errorResponse(`PROVIDER_ERROR: ${message}`);
}

/** Error text when the Dev Space layer is not running in this process. */
export function devSpaceUnavailableResponse(): ToolResult {
  return errorResponse(
    'DEVSPACE_UNAVAILABLE: Dev Space tools are unavailable in this process — no dev-space ' +
      'runtime is registered. These tools run where the Dev Space artifact store lives ' +
      '(desktop app / main server); they are not available in this session backend.',
  );
}

/** Fetch the registered runtime or return the typed unavailable error. */
export function requireDevSpaceRuntime():
  | { ok: true; runtime: DevSpaceToolRuntime }
  | { ok: false; response: ToolResult } {
  const runtime = getDevSpaceToolRuntime();
  if (!runtime) return { ok: false, response: devSpaceUnavailableResponse() };
  return { ok: true, runtime };
}