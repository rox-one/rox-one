import type { SidebarSection, SidebarSectionItem } from '../sidebar-section'
import { nonEmptySections } from '../sidebar-section'

export type FeedTabId = 'agents' | 'team' | 'news' | 'subscriptions'
export const FEED_TABS: readonly FeedTabId[] = ['agents', 'team', 'news', 'subscriptions']

export interface FeedSidebarSource {
  id: string
  label: string
  kind: string
  count: number
  /** Paused or failing — shown as a muted status badge. */
  unhealthy: boolean
}

export interface FeedSidebarInput {
  counts: Readonly<Record<FeedTabId, number>>
  /** Agent items needing attention (failed runs etc.). */
  attention: number
  sources: readonly FeedSidebarSource[]
  tags: readonly { tag: string; count: number }[]
  x: { connected: boolean; username?: string | null }
  team: { connected: boolean; name: string }
}

/**
 * Лента second sidebar: Виды (fixed tabs with counts) → Ленты (news sources +
 * manage/add) → Подписки (X and team connections, open their settings) → Теги.
 */
export function buildFeedSidebarSections(input: FeedSidebarInput): SidebarSection[] {
  const views: SidebarSectionItem[] = FEED_TABS.map((tab) => ({
    id: `view:${tab}`,
    labelKey: `feed.tab.${tab}`,
    icon: `tab:${tab}`,
    count: input.counts[tab] || undefined,
    ...(tab === 'agents' && input.attention > 0 ? { badge: 'attention' as const } : {}),
    target: { kind: 'view', viewId: tab },
  }))
  const feeds: SidebarSectionItem[] = [
    ...input.sources.map((s) => ({
      id: `source:${s.id}`,
      label: s.label,
      icon: `source:${s.kind}`,
      count: s.count || undefined,
      ...(s.unhealthy ? { badge: 'status' as const } : {}),
      target: { kind: 'source' as const, sourceId: s.id },
    })),
    {
      id: 'manage-sources',
      labelKey: input.sources.length ? 'feed.nav.manageSources' : 'feed.nav.addFirstSource',
      icon: input.sources.length ? 'sliders' : 'plus',
      target: { kind: 'view', viewId: 'sources' },
    },
  ]
  const subscriptions: SidebarSectionItem[] = [
    // Not connected → the sources screen hosts the X connect flow.
    { id: 'conn:x', label: 'X', icon: 'at-sign', ...(input.x.connected ? { secondary: `@${input.x.username ?? ''}` } : { secondaryKey: 'screens.feed.notConnected' }), target: { kind: 'view', viewId: input.x.connected ? 'subscriptions' : 'sources' } },
    { id: 'conn:team', labelKey: 'feed.tab.team', icon: 'network', secondary: input.team.name, target: { kind: 'view', viewId: 'team' } },
  ]
  const tags: SidebarSectionItem[] = input.tags.map(({ tag, count }) => ({ id: `tag:${tag}`, label: `#${tag}`, icon: 'hash', count, target: { kind: 'label', label: tag } }))
  return nonEmptySections([
    { id: 'views', titleKey: 'screens.feed.groups.views', items: views, collapsible: false },
    { id: 'feeds', titleKey: 'screens.feed.groups.feeds', items: feeds, limit: 8, collapsible: true },
    { id: 'subscriptions', titleKey: 'screens.feed.groups.subscriptions', items: subscriptions, collapsible: true },
    { id: 'tags', titleKey: 'screens.feed.groups.tags', items: tags, limit: 8, collapsible: true },
  ])
}
