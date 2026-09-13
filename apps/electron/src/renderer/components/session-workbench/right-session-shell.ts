/**
 * Reusable right-side contextual session shell (ROX-P1 / #338 UI).
 * Binds the focused surface through bindSurfaceContext; does not build a server ACL envelope.
 */
import {
  bindSurfaceContext,
  sameContextSnapshot,
  type Rox2Context,
  type SurfaceContextInput,
} from '@craft-agent/core/rox2'

export const RIGHT_SESSION_FOCUS_TARGET = 'session' as const
export const RIGHT_SESSION_SHELL_TEST_ID = 'right-session-shell'
export const RIGHT_SESSION_PROMPT_TEST_ID = 'right-session-prompt'

export type RightSessionSurfaceInput = Omit<SurfaceContextInput, 'sessionId'>

export function revisionByEntityId(
  entityId: string,
  revision: string | number | null | undefined,
): Record<string, string> | undefined {
  if (revision == null || revision === '') return undefined
  if (typeof revision === 'number' && (!Number.isFinite(revision) || revision <= 0)) return undefined
  return { [entityId]: String(revision) }
}

export function bindRightSessionContext(input: SurfaceContextInput): Rox2Context {
  return bindSurfaceContext(input)
}

/** Repeated click of the same surface snapshot reuses the open right session. */
export function describeRightSessionOpen(
  current: Rox2Context | null,
  next: RightSessionSurfaceInput,
): 'reuse' | 'open' {
  if (!current?.sessionId) return 'open'
  const candidate = bindSurfaceContext({
    ...next,
    sessionId: current.sessionId,
  })
  return sameContextSnapshot(current, candidate) ? 'reuse' : 'open'
}
