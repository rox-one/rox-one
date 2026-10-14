import { useCallback, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { AtSign, Bot, Hash, Network, Newspaper, PlusCircle, Radio, RefreshCw, SlidersHorizontal, Users, type LucideIcon } from 'lucide-react'
import { useScreenSidebar, type ScreenSidebarConfig, type SidebarGroup } from '@/components/shell/screen-sidebar'
import { SOURCE_ICONS } from '@/pages/feed/FeedSidebar'
import { toScreenSidebarGroups } from '../screen-sidebar-adapter'
import type { SidebarTarget } from '../sidebar-section'
import { buildFeedSidebarSections, type FeedSidebarInput } from './feed-sidebar-sections'

function icons(): Record<string, LucideIcon> {
  const m: Record<string, LucideIcon> = {
    'tab:agents': Bot, 'tab:team': Users, 'tab:news': Newspaper, 'tab:subscriptions': Radio,
    sliders: SlidersHorizontal, plus: PlusCircle, 'at-sign': AtSign, network: Network, hash: Hash,
  }
  for (const [k, v] of Object.entries(SOURCE_ICONS)) m[`source:${k}`] = v
  return m
}
const ICONS = icons()

export interface FeedScreenSidebarInput extends FeedSidebarInput {
  /** Active row as a targetKey (`view:news`, `source:<id>`, `label:<tag>`). */
  activeKey: string | null
  onView(view: 'agents' | 'team' | 'news' | 'subscriptions' | 'sources'): void
  onSource(id: string): void
  onTag(tag: string): void
  query: string
  onQuery(value: string): void
  onRefresh(): void
  loading: boolean
  error: string | null
}

/** Publishes the Лента second sidebar (stream section only; Входящие publishes its own). */
export function useFeedScreenSidebar(input: FeedScreenSidebarInput, enabled: boolean): void {
  const { t } = useTranslation()
  const latest = useRef(input)
  latest.current = input
  const { counts, attention, sources, tags, x, team, activeKey, query, loading, error } = input
  const data = { counts, attention, sources, tags, x, team }
  const signature = JSON.stringify(data)
  // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on content signature (page rebuilds arrays each render)
  const sections = useMemo(() => buildFeedSidebarSections(data), [signature])
  const onTarget = useCallback((target: SidebarTarget) => {
    const cb = latest.current
    if (target.kind === 'view') cb.onView(target.viewId as never)
    else if (target.kind === 'source') cb.onSource(target.sourceId)
    else if (target.kind === 'label') cb.onTag(target.label)
  }, [])
  const onQuery = useCallback((v: string) => latest.current.onQuery(v), [])
  const onRefresh = useCallback(() => latest.current.onRefresh(), [])

  const config = useMemo<ScreenSidebarConfig | null>(() => {
    if (!enabled) return null
    const groups: SidebarGroup[] = toScreenSidebarGroups(sections, { t, icons: ICONS, onTarget, activeKey })
    if (loading) groups.splice(1, 0, { id: 'feeds-loading', title: t('screens.feed.groups.feeds'), items: [], state: { kind: 'loading' } })
    if (error) groups.splice(1, 0, { id: 'feeds-error', title: t('screens.feed.groups.feeds'), items: [], state: { kind: 'error', label: error, onRetry: onRefresh } })
    return {
      screenId: 'feed',
      title: t('feed.title'),
      headerActions: [{ id: 'refresh', label: t('feed.refresh'), icon: RefreshCw, onSelect: onRefresh }],
      primaryAction: { id: 'add-source', label: t('screens.feed.addSource'), icon: PlusCircle, onSelect: () => latest.current.onView('sources') },
      search: { placeholder: t('screens.feed.search'), value: query, onChange: onQuery },
      groups,
    }
  }, [enabled, sections, t, onTarget, activeKey, loading, error, onRefresh, query, onQuery])

  useScreenSidebar(config)
}
