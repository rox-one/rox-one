/**
 * App-level unread sources for the rail and pill badges (top-50 #8).
 * Sessions: sessions marked unread. Inbox: blocking requests (same number the
 * pill already showed). Other screens publish their own count with
 * useScreenUnread from their screen module.
 */
import * as React from 'react'
import { useAtomValue } from 'jotai'
import { selectAtom } from 'jotai/utils'
import { sessionMetaMapAtom } from '@/atoms/sessions'
import { useScreenUnread } from './shell-prefs'

export function countUnreadSessions(map: ReadonlyMap<string, { hasUnread?: boolean; isArchived?: boolean }>): number {
  let count = 0
  for (const meta of map.values()) if (meta.hasUnread && !meta.isArchived) count++
  return count
}

const unreadSessionsCountAtom = selectAtom(sessionMetaMapAtom, (map) => countUnreadSessions(map as ReadonlyMap<string, { hasUnread?: boolean; isArchived?: boolean }>))

export const ShellUnreadSources = React.memo(function ShellUnreadSources() {
  const sessions = useAtomValue(unreadSessionsCountAtom)
  useScreenUnread('sessions', sessions)
  return null
})
