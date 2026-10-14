/**
 * «Недавнее» + «Закреплённое» — the contextual sidebar for screens without
 * navigation of their own (Главная, Память, Навыки, Буфер, …). Loaded lazily
 * by `ShellSidebarNav`; subscribes to a narrowed session selector so token
 * streaming in an open chat does not re-render it (only title / order /
 * flag / archive changes do).
 */
import * as React from 'react'
import { useAtomValue } from 'jotai'
import { selectAtom } from 'jotai/utils'
import { useTranslation } from 'react-i18next'
import { MessageSquare, Star } from 'lucide-react'
import { navigate, routes } from '@/lib/navigate'
import { sessionMetaMapAtom } from '@/atoms/sessions'
import { getSessionTitle } from '@/utils/session'
import { isInternalAgentSession } from '@rox/shared/sessions/internal-prompts'
import { useNavigationState } from '@/contexts/NavigationContext'
import { LeftSidebar, type LinkItem } from './LeftSidebar'
import { selectRecentPinned } from './sidebar-registry'

interface Row { id: string; title: string; flagged: boolean }
interface Snapshot { recent: Row[]; pinned: Row[] }

function sameRows(a: Row[], b: Row[]): boolean {
  return a.length === b.length && a.every((row, i) => row.id === b[i]!.id && row.title === b[i]!.title && row.flagged === b[i]!.flagged)
}

export interface RecentPinnedSidebarProps {
  /** Local + remote workspace ids the sessions may carry; empty = all. */
  workspaceIds: readonly string[]
  isCollapsed: boolean
  onExpand?: (link: LinkItem) => void
}

export default function RecentPinnedSidebar({ workspaceIds, isCollapsed, onExpand }: RecentPinnedSidebarProps) {
  const { t } = useTranslation()
  const navState = useNavigationState()
  const scopeKey = workspaceIds.join('\u0000')
  const snapshotAtom = React.useMemo(() => {
    const scope = scopeKey ? new Set(scopeKey.split('\u0000')) : null
    return selectAtom(sessionMetaMapAtom, (map): Snapshot => {
      const metas = Array.from(map.values()).filter(meta => !isInternalAgentSession(meta))
      const { recent, pinned } = selectRecentPinned(metas, scope)
      const toRow = (meta: (typeof metas)[number]): Row => ({ id: meta.id, title: getSessionTitle(meta), flagged: Boolean(meta.isFlagged) })
      return { recent: recent.map(toRow), pinned: pinned.map(toRow) }
    }, (a, b) => sameRows(a.recent, b.recent) && sameRows(a.pinned, b.pinned))
  }, [scopeKey])
  const { recent, pinned } = useAtomValue(snapshotAtom)
  const openId = navState.navigator === 'sessions' ? navState.details?.sessionId ?? null : null

  const toLink = React.useCallback((row: Row, icon: LinkItem['icon']): LinkItem => ({
    id: `recent:${row.id}`,
    title: row.title,
    icon,
    variant: row.id === openId ? 'default' : 'ghost',
    onClick: () => navigate(routes.view.allSessions(row.id)),
  }), [openId])
  const pinnedLinks = React.useMemo(() => pinned.map(row => toLink(row, Star)), [pinned, toLink])
  const recentLinks = React.useMemo(() => recent.map(row => toLink(row, MessageSquare)), [recent, toLink])

  if (isCollapsed) {
    const links = [...pinnedLinks, ...recentLinks]
    return links.length > 0 ? <LeftSidebar isCollapsed onExpand={onExpand} links={links} /> : null
  }
  return (
    <div className="flex flex-col gap-2" data-sidebar-recent-pinned="">
      <section aria-label={t('sidebar.pinned')}>
        <div className="px-3 pb-0.5 pt-1 text-caption font-semibold uppercase caps-label text-text-muted">{t('sidebar.pinned')}</div>
        {pinnedLinks.length > 0
          ? <LeftSidebar isCollapsed={false} onExpand={onExpand} links={pinnedLinks} />
          : <p className="px-3 py-1 text-xs text-muted-foreground">{t('sidebar.pinnedEmpty')}</p>}
      </section>
      <section aria-label={t('sidebar.recent')}>
        <div className="px-3 pb-0.5 pt-1 text-caption font-semibold uppercase caps-label text-text-muted">{t('sidebar.recent')}</div>
        {recentLinks.length > 0
          ? <LeftSidebar isCollapsed={false} onExpand={onExpand} links={recentLinks} />
          : <p className="px-3 py-1 text-xs text-muted-foreground">{t('sidebar.recentEmpty')}</p>}
      </section>
    </div>
  )
}
