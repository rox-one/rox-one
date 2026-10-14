/**
 * Contextual sidebar registry (#1932 follow-up, Mark: «сайдбар под текущий
 * экран, экраны переключаются пилюлями»).
 *
 * The sidebar no longer lists every surface. It shows the CURRENT screen:
 * its title, its primary action and its own navigation. Each surface declares
 * where that navigation comes from:
 *
 * - `sessions` — the session filters (statuses, Избранное, Архив, Метки; the
 *   chat-folders branch plugs its tree in at `data-sidebar-folders-slot`);
 * - `context` — the sub-items of the surface's rich AppShell row (Проекты,
 *   Страницы, Источники, Автоматизации);
 * - `portal` — the page portals its own navigator into the shell slot
 *   (`ShellSidebarPortal`: mode screens such as Лента / Входящие / Задачи /
 *   Встречи, Заметки, Память, Обучение, Настройки, Соединения);
 * - `fallback` — no navigation of its own: «Недавнее» + «Закреплённое»
 *   (lazy `RecentPinnedSidebar`). A `portal` surface whose page renders no
 *   navigator (yet) also falls back, decided at runtime by the shell.
 *
 * Switching screens happens in the titlebar pill and its «Все экраны» menu.
 */
import type { LucideIcon } from 'lucide-react'
import type { NavigationState } from '../../../shared/types'
import { EXTRA_SCREENS } from '../../pages/extra-screens/registry'
import { PRIMARY_NAV, type PrimaryNavEntry } from './primary-nav'

export type SidebarContentKind = 'sessions' | 'context' | 'portal' | 'fallback'

/** Explicit kinds; anything not listed is `fallback`. */
export const SIDEBAR_CONTENT_KIND: Readonly<Record<string, SidebarContentKind>> = {
  sessions: 'sessions',
  projects: 'context',
  pages: 'context',
  sources: 'context',
  automations: 'context',
  inbox: 'portal',
  messenger: 'portal',
  docs: 'portal',
  tasks: 'portal',
  calendar: 'portal',
  meetings: 'portal',
  goals: 'portal',
  feed: 'portal',
  memory: 'portal',
  memoryRepo: 'portal',
  learning: 'portal',
  connections: 'portal',
  settings: 'portal',
}

export function sidebarContentKind(surfaceId: string | null): SidebarContentKind {
  return (surfaceId && SIDEBAR_CONTENT_KIND[surfaceId]) || 'fallback'
}

export interface CurrentSidebarSurface {
  /** Registry id, `screen:<id>` for experimental screens, null when unknown. */
  id: string | null
  titleKey: string | null
  icon: LucideIcon | null
  /** Rich AppShell row id whose `actions` become the header's primary action. */
  linkId: string | null
  kind: SidebarContentKind
}

/**
 * The surface the main panel shows. Registry order decides ties (Memory vs
 * its Repository tab are mutually exclusive by `tab`). The browser is a
 * panel, not a screen, so it never wins here.
 */
export function resolveCurrentSurface(navState: NavigationState, registry: readonly PrimaryNavEntry[] = PRIMARY_NAV): CurrentSidebarSurface {
  if (navState.navigator === 'screen') {
    const extra = EXTRA_SCREENS.find(screen => screen.id === navState.screen)
    if (extra) return { id: `screen:${extra.id}`, titleKey: extra.labelKey, icon: extra.icon, linkId: null, kind: 'fallback' }
  }
  const entry = registry.find(candidate => candidate.action !== 'open-browser' && safeActive(candidate, navState))
  if (!entry) return { id: null, titleKey: null, icon: null, linkId: null, kind: 'fallback' }
  return { id: entry.id, titleKey: entry.labelKey, icon: entry.icon, linkId: entry.linkId, kind: sidebarContentKind(entry.id) }
}

function safeActive(entry: PrimaryNavEntry, navState: NavigationState): boolean {
  try {
    return entry.isActive(navState)
  } catch {
    return false
  }
}

export interface RecentPinnedSession {
  id: string
  workspaceId: string
  name?: string
  lastMessageAt?: number
  createdAt?: number
  isFlagged?: boolean
  isArchived?: boolean
  hidden?: boolean
}

export const RECENT_LIMIT = 8
export const PINNED_LIMIT = 8

/**
 * «Недавнее» = the workspace's latest non-archived sessions; «Закреплённое» =
 * its flagged sessions (the existing Избранное store — no second pin store).
 * A pinned session is not repeated under «Недавнее».
 */
export function selectRecentPinned<T extends RecentPinnedSession>(
  sessions: Iterable<T>,
  workspaceIds: ReadonlySet<string> | null,
  options: { recentLimit?: number; pinnedLimit?: number } = {},
): { recent: T[]; pinned: T[] } {
  // Bounded top-k selection (O(n·k), k ≤ 16) instead of sorting every
  // session: this runs on each session-meta update, including streaming ticks.
  const pinnedLimit = options.pinnedLimit ?? PINNED_LIMIT
  const recentLimit = options.recentLimit ?? RECENT_LIMIT
  const at = (session: T) => session.lastMessageAt ?? session.createdAt ?? 0
  const before = (a: T, b: T) => at(b) - at(a) || a.id.localeCompare(b.id)
  const insertTop = (list: T[], session: T, limit: number) => {
    if (limit <= 0) return
    if (list.length >= limit && before(session, list[list.length - 1]!) >= 0) return
    let i = list.length
    while (i > 0 && before(session, list[i - 1]!) < 0) i--
    list.splice(i, 0, session)
    if (list.length > limit) list.pop()
  }
  const pinned: T[] = []
  // Keep pinnedLimit extra candidates so flagged rows past the pinned cap can still be excluded correctly.
  const recentCandidates: T[] = []
  for (const session of sessions) {
    if (session.hidden || session.isArchived) continue
    if (workspaceIds && !workspaceIds.has(session.workspaceId)) continue
    if (session.isFlagged) insertTop(pinned, session, pinnedLimit)
    insertTop(recentCandidates, session, recentLimit + pinnedLimit)
  }
  const pinnedIds = new Set(pinned.map(session => session.id))
  const recent = recentCandidates.filter(session => !pinnedIds.has(session.id)).slice(0, recentLimit)
  return { recent, pinned }
}
