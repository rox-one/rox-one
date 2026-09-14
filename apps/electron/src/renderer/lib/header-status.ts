/** Small, bounded state for the single status slot in the app header. */
export interface HeaderStatusAction {
  labelKey: string
  onClick: () => void
}

export interface HeaderStatus {
  id: string
  workspaceId: string
  tone: 'success' | 'info' | 'error'
  messageKey: string
  values?: Record<string, string | number>
  createdAt: number
  action?: HeaderStatusAction
  persistent?: boolean
}

export interface HeaderStatusState {
  current: HeaderStatus | null
  seen: Record<string, number>
}

export const HEADER_STATUS_DURATION_MS = 5_000
const STATUS_DEDUPE_MS = 120_000

/** A hidden workspace's unresolved status must not suppress the active context. */
export function headerStatusForWorkspace(status: HeaderStatus | null, workspaceId: string | null | undefined): HeaderStatus | null {
  return status?.workspaceId === workspaceId ? status : null
}

/** Errors and requests with an action never expire behind the user's back. */
export function headerStatusDuration(status: HeaderStatus): number | null {
  return status.tone === 'error' || status.action || status.persistent
    ? null
    : HEADER_STATUS_DURATION_MS
}

function statusPriority(status: HeaderStatus): number {
  if (status.tone === 'error') return 3
  if (status.action) return 2
  if (status.persistent) return 1
  return 0
}

export function pushHeaderStatus(state: HeaderStatusState, status: HeaderStatus): HeaderStatusState {
  const previouslySeen = state.seen[status.id]
  if (previouslySeen !== undefined && status.createdAt - previouslySeen < STATUS_DEDUPE_MS) return state
  // Preserve unresolved work against routine signals, while allowing an error
  // to take priority. A hidden status from another workspace cannot block this one.
  if (state.current && state.current.workspaceId === status.workspaceId
    && state.current.id !== status.id && statusPriority(state.current) > 0
    && statusPriority(state.current) >= statusPriority(status)) return state

  const recent = Object.entries(state.seen)
    .filter(([, at]) => status.createdAt - at < STATUS_DEDUPE_MS)
    .slice(-99)
  return {
    current: status,
    seen: { ...Object.fromEntries(recent), [status.id]: status.createdAt },
  }
}

/** A delayed timer for an older message must not dismiss its replacement. */
export function dismissHeaderStatus(state: HeaderStatusState, id: string): HeaderStatusState {
  return state.current?.id === id ? { ...state, current: null } : state
}
