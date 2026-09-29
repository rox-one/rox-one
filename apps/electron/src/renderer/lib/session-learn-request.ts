/**
 * «Научиться из этой сессии» lives in the session menu (not as a chip above
 * the composer). The menu records a request here; the session's memory lane
 * (mounted inside the open chat) consumes it and runs the extraction.
 */

export const LEARN_FROM_SESSION_EVENT = 'rox:learn-from-session'

const pending = new Set<string>()

/** Request a memory extraction for `sessionId` (consumed by its open lane). */
export function requestLearnFromSession(sessionId: string): void {
  pending.add(sessionId)
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(LEARN_FROM_SESSION_EVENT, { detail: { sessionId } }))
  }
}

/** Consume a pending request; true when one existed for this session. */
export function consumeLearnFromSessionRequest(sessionId: string): boolean {
  return pending.delete(sessionId)
}
