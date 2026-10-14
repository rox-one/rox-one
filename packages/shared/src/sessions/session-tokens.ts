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
 * A turn ended (abort, crash, early exit) without a usage-bearing complete
 * event: its model requests were never counted, so the total is no longer
 * real. Mark the session incomplete for good instead of showing an
 * understated number.
 */
export function markTurnTokensUncounted<T extends SessionTokensState>(
  usage: T | undefined,
  init: () => T,
): T {
  const next = usage ?? init()
  delete next.sessionTokens
  next.sessionTokensIncomplete = true
  return next
}
