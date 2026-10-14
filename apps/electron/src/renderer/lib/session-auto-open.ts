/**
 * Sessions page split view: when the list opens with nothing selected, reopen
 * the session the user last had open in this workspace (or the most recent
 * active one) in the detail panel. An explicit panel close is remembered until
 * the user opens a session again.
 */

export interface AutoOpenSessionLike {
  id: string
  isArchived?: boolean
  lastMessageAt?: number
  createdAt?: number
}

export interface SessionAutoOpenState {
  lastSelectedId: string | null
  closed: boolean
}

const STORAGE_PREFIX = 'rox.sessions.autoOpen.'
const EMPTY_STATE: SessionAutoOpenState = { lastSelectedId: null, closed: false }

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

export function readSessionAutoOpenState(workspaceId: string): SessionAutoOpenState {
  const raw = storage()?.getItem(STORAGE_PREFIX + workspaceId)
  if (!raw) return EMPTY_STATE
  try {
    const parsed = JSON.parse(raw) as Partial<SessionAutoOpenState>
    return {
      lastSelectedId: typeof parsed.lastSelectedId === 'string' ? parsed.lastSelectedId : null,
      closed: parsed.closed === true,
    }
  } catch {
    return EMPTY_STATE
  }
}

export function writeSessionAutoOpenState(workspaceId: string, patch: Partial<SessionAutoOpenState>): SessionAutoOpenState {
  const next = { ...readSessionAutoOpenState(workspaceId), ...patch }
  try {
    storage()?.setItem(STORAGE_PREFIX + workspaceId, JSON.stringify(next))
  } catch {
    // Quota / privacy mode: auto-open just falls back to the most recent session.
  }
  return next
}

function activity(meta: AutoOpenSessionLike): number {
  return meta.lastMessageAt ?? meta.createdAt ?? 0
}

/** Last selected session if it is still listed and not archived, else the most recently active one. */
export function pickAutoOpenSessionId(
  metas: readonly AutoOpenSessionLike[],
  lastSelectedId: string | null,
): string | null {
  if (lastSelectedId) {
    const last = metas.find((meta) => meta.id === lastSelectedId)
    if (last && !last.isArchived) return last.id
  }
  let best: AutoOpenSessionLike | null = null
  for (const meta of metas) {
    if (meta.isArchived) continue
    if (!best || activity(meta) > activity(best)) best = meta
  }
  return best?.id ?? null
}

export interface AutoOpenGate {
  /** Sessions navigator, list view, nothing selected, single-panel desktop layout. */
  catalogOwnsWorkspace: boolean
  isSessionsReady: boolean
  closedByUser: boolean
  /** Search is active: the user is filtering, do not swap the layout under them. */
  searchActive: boolean
}

export function shouldAutoOpenSession(gate: AutoOpenGate): boolean {
  return gate.catalogOwnsWorkspace && gate.isSessionsReady && !gate.closedByUser && !gate.searchActive
}

/** A close only counts for the selection change it causes, not a later one. */
const EXPLICIT_CLOSE_TTL_MS = 1500
let explicitCloseAt: number | null = null

/** Called by the panel stack when the user closes a panel that shows a session. */
export function markExplicitSessionPanelClose(now: number = Date.now()): void {
  explicitCloseAt = now
}

/** Reads and clears the explicit-close marker (one close → one decision). */
export function consumeExplicitSessionPanelClose(now: number = Date.now()): boolean {
  const at = explicitCloseAt
  explicitCloseAt = null
  return at != null && now - at <= EXPLICIT_CLOSE_TTL_MS
}

/**
 * The detail panel went from a session to nothing while staying on the
 * sessions list because the user closed it (not because they clicked
 * «Сессии» again or the session was deleted, which are not preferences).
 */
export function isExplicitPanelClose(input: {
  previousSessionId: string | null
  nextSessionId: string | null
  stillOnSessionsList: boolean
  previousSessionStillExists: boolean
  closedByUser: boolean
}): boolean {
  return input.closedByUser && !!input.previousSessionId && !input.nextSessionId && input.stillOnSessionsList && input.previousSessionStillExists
}
