/**
 * Running session total (prompt incl. cache + output, summed over every model
 * request). Only sessions observed from their first turn get a total: a legacy
 * session (usage recorded before tracking existed) or any turn whose backend
 * could not report per-request totals marks the session incomplete for good,
 * so the UI hides the metric instead of showing a partial number.
 */
export interface SessionTokensState {
  outputTokens: number
  sessionTokens?: number
  sessionTokensIncomplete?: boolean
}

export function accumulateSessionTokens(
  prev: SessionTokensState,
  requestTotals: { promptTokens: number; outputTokens: number } | undefined,
): { sessionTokens?: number; sessionTokensIncomplete?: boolean } {
  if (prev.sessionTokensIncomplete) return { sessionTokensIncomplete: true }
  const tracking = prev.sessionTokens !== undefined || (prev.outputTokens ?? 0) === 0
  if (!tracking || !requestTotals) return { sessionTokensIncomplete: true }
  const add = Math.max(0, requestTotals.promptTokens || 0) + Math.max(0, requestTotals.outputTokens || 0)
  return { sessionTokens: (prev.sessionTokens ?? 0) + add }
}

/**
 * True once the turn has visibly reached the model (streamed text/thinking,
 * a tool call, or reported usage). Turns that end before any such event
 * (empty-message rejection, auth/billing/rate-limit fallbacks, no-activity
 * runtime turns) made no counted request and must not hide the total.
 */
export function isModelActivityEvent(event: { type: string; usage?: unknown }): boolean {
  switch (event.type) {
    case 'text_delta':
    case 'text_complete':
    case 'thinking_delta':
    case 'thinking_complete':
    case 'tool_start':
    case 'tool_result':
    case 'usage_update':
      return true
    case 'complete':
      return event.usage !== undefined && event.usage !== null
    default:
      return false
  }
}

/**
 * A turn ended (abort, crash, early exit) after model activity but without a
 * usage-bearing complete event: its model requests were never counted, so the
 * total is no longer real. Returns a new object marked incomplete for good
 * (the input is never mutated).
 */
export function markTurnTokensUncounted<T extends SessionTokensState>(
  usage: T | undefined,
  init: () => T,
): T {
  const { sessionTokens: _dropped, ...rest } = usage ?? init()
  return { ...rest, sessionTokensIncomplete: true } as T
}
