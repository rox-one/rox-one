/**
 * Home Front Page model — recent sessions from existing SessionMeta.
 * Domain state stays in session storage; this only sorts a projection.
 */

import { isInternalAgentSession } from '@rox/shared/sessions/internal-prompts'

export const HOME_RECENT_LIMIT = 8

export interface HomeSessionLike {
  id: string
  hidden?: boolean
  isArchived?: boolean
  lastMessageAt?: number
  createdAt?: number
  workspaceId?: string
  name?: string
  preview?: string
}

/** Match AppShell workspace lists, including remote workspace ids. */
export function isHomeSessionInWorkspace(
  session: Pick<HomeSessionLike, 'workspaceId'>,
  workspaceId: string | null | undefined,
  remoteWorkspaceId?: string | null,
): boolean {
  if (!workspaceId) return true
  return (
    session.workspaceId === workspaceId ||
    (remoteWorkspaceId != null && session.workspaceId === remoteWorkspaceId)
  )
}

export function pickRecentHomeSessions<T extends HomeSessionLike>(
  sessions: readonly T[],
  limit = HOME_RECENT_LIMIT,
): T[] {
  return sessions
    .filter((session) => !session.hidden && !session.isArchived)
    // Rox-internal one-shot runs (memory distiller…) are not conversations.
    .filter((session) => !isInternalAgentSession(session))
    .slice()
    .sort((a, b) => {
      const aAt = a.lastMessageAt ?? a.createdAt ?? 0
      const bAt = b.lastMessageAt ?? b.createdAt ?? 0
      return bAt - aAt
    })
    .slice(0, limit)
}
