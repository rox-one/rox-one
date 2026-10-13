/**
 * ShellSidebarNav — the legacy left sidebar's navigation block (WP3, WP5).
 *
 * WP5 (#1580): the order and grouping come from the single primary-nav
 * registry (`primary-nav.ts`) that also drives the workbench ActivityRail:
 * primary entries first, then the «Ещё» disclosure with the rest. AppShell's
 * memoised `baseLinks` supply the rich rows (counts, children, context menus)
 * by link id; registry entries AppShell has no row for (flag-gated surfaces,
 * the browser action) get a plain navigating row.
 *
 * WP3: this memoised child owns the atom subscriptions only the sidebar reads
 * (shell flags, enabled extra screens), so unrelated atom changes re-render
 * neither this block nor its rows.
 */
import * as React from 'react'
import { useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'
import { ChevronRight, ListFilter, MoreHorizontal } from 'lucide-react'
import { cn } from '@/lib/utils'
import { navigate, routes } from '@/lib/navigate'
import { enabledExtraScreenIdsAtom } from '@/atoms/extra-screens'
import { visibleExtraScreens } from '@/pages/extra-screens/registry'
import { enabledShellFlagsAtom } from '@/platform/unified-flags'
import { isSessionsNavigation, useNavigationState } from '@/contexts/NavigationContext'
import { isSeparatorItem, LeftSidebar, type LinkItem, type SidebarItem } from './LeftSidebar'
import { PRIMARY_NAV_LINK_IDS, resolvePrimaryNav, type ResolvedPrimaryNavEntry } from './primary-nav'

/** WP4: experimental screen icon tints from colour tokens (were literal hex). */
const EXPERIMENTAL_ICON_COLOR: Readonly<Record<string, string>> = {
  radar: 'var(--accent)',
  focus: 'var(--success)',
}

export interface ShellSidebarNavProps {
  /** Memoised AppShell sidebar rows (rich rows reused by link id). */
  baseLinks: SidebarItem[]
  isCollapsed: boolean
  /** Collapsed-rail click: `inMore` = the link lives in the «Ещё» group. */
  onExpand: (link: LinkItem, inMore: boolean) => void
  /** Opens the browser surface (registry `action: 'open-browser'`). */
  onOpenBrowser: () => void
  /** Persisted expanded-sections store (AppShell `collapsedItems`). */
  isExpanded: (id: string) => boolean
  toggleExpanded: (id: string) => void
  applicationSectionsOpen: boolean
  onApplicationSectionsOpenChange: (open: boolean) => void
}

export const ShellSidebarNav = React.memo(function ShellSidebarNav({
  baseLinks,
  isCollapsed,
  onExpand,
  onOpenBrowser,
  isExpanded,
  toggleExpanded,
  applicationSectionsOpen,
  onApplicationSectionsOpenChange,
}: ShellSidebarNavProps) {
  const { t } = useTranslation()
  const navState = useNavigationState()
  const shellFlags = useAtomValue(enabledShellFlagsAtom)
  const enabledExtraScreenIds = useAtomValue(enabledExtraScreenIdsAtom)

  const entries = React.useMemo(() => resolvePrimaryNav({ shellFlags }), [shellFlags])

  const { primaryLinks, moreLinks } = React.useMemo(() => {
    const byId = new Map<string, LinkItem>()
    for (const link of baseLinks) if (!isSeparatorItem(link)) byId.set(link.id, link)
    const linkFor = (entry: ResolvedPrimaryNavEntry): LinkItem => byId.get(entry.linkId) ?? {
      id: entry.linkId,
      title: t(entry.labelKey),
      icon: entry.icon,
      variant: entry.isActive(navState) ? 'default' : 'ghost',
      onClick: entry.route ? () => navigate(entry.route!()) : onOpenBrowser,
    }
    const primary = entries.filter(entry => entry.group === 'primary').map(linkFor).map(stripSessionFilters)
    const more: SidebarItem[] = entries.filter(entry => entry.group === 'more').map(linkFor)
    // Rows the registry does not own keep their AppShell order after the registry's «Ещё».
    for (const link of baseLinks) {
      if (!isSeparatorItem(link) && !PRIMARY_NAV_LINK_IDS.has(link.id)) more.push(link)
    }
    return { primaryLinks: primary, moreLinks: more }
  }, [baseLinks, entries, navState, onOpenBrowser, t])

  // Session filters (statuses, favourites, archive, labels) are contextual:
  // they leave the global nav and show as their own section under Sessions.
  const inSessions = isSessionsNavigation(navState)
  // Persisted through the expanded-sections store, like every other section.
  // The store records collapsed ids, so «empty buckets hidden» is the
  // default (expanded) state of SESSION_FILTERS_EMPTY_HIDDEN_ID.
  const filtersOpen = isExpanded(SESSION_FILTERS_ID)
  const showEmpty = !isExpanded(SESSION_FILTERS_EMPTY_HIDDEN_ID)
  const toggleFilters = React.useCallback(() => toggleExpanded(SESSION_FILTERS_ID), [toggleExpanded])
  const toggleShowEmpty = React.useCallback(() => toggleExpanded(SESSION_FILTERS_EMPTY_HIDDEN_ID), [toggleExpanded])
  const sessionFilters = React.useMemo(() => {
    const sessions = baseLinks.find(link => link.id === 'nav:allSessions')
    if (!inSessions || !sessions || isSeparatorItem(sessions) || !sessions.items?.length) return null
    return buildSessionFilters(sessions, { showEmpty, open: filtersOpen, onToggle: toggleFilters }, t)
  }, [baseLinks, inSessions, showEmpty, filtersOpen, toggleFilters, t])

  const onExpandPrimary = React.useCallback((link: LinkItem) => onExpand(link, false), [onExpand])
  const onExpandMore = React.useCallback((link: LinkItem) => onExpand(link, true), [onExpand])

  const activeScreen = navState.navigator === 'screen' ? navState.screen : null
  const experimentalLinks = React.useMemo<SidebarItem[]>(() => visibleExtraScreens(enabledExtraScreenIds).map(screen => ({
    id: `nav:screen:${screen.id}`,
    title: t(screen.labelKey), icon: screen.icon,
    variant: activeScreen === screen.id ? 'default' : 'ghost',
    onClick: () => navigate(routes.view.screen(screen.id)),
    iconColor: EXPERIMENTAL_ICON_COLOR[screen.id] ?? 'var(--info)',
  })), [enabledExtraScreenIds, activeScreen, t])

  // Mirrors ActivityRail: an active destination inside «Ещё» (deep link, ⌘K,
  // route change) keeps the disclosure open so the selection is visible.
  const moreOpen = applicationSectionsOpen || hasActiveLink(moreLinks) || hasActiveLink(experimentalLinks)

  return (
    <>
      {sessionFilters && !isCollapsed && (
        <section className="mb-2 border-b border-border-subtle pb-2" aria-label={t('sidebar.sessionFilters')} data-session-filters="">
          <LeftSidebar isCollapsed={false} onExpand={onExpandPrimary} links={sessionFilters.links} />
          {filtersOpen && sessionFilters.emptyCount > 0 && (
            <button
              type="button"
              className="ml-8 rounded-[var(--radius-control)] px-2 py-1 text-xs text-muted-foreground hover:bg-[var(--state-hover)] hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
              aria-pressed={showEmpty}
              onClick={toggleShowEmpty}
            >
              {showEmpty ? t('sidebar.hideEmpty') : t('sidebar.showEmpty', { count: sessionFilters.emptyCount })}
            </button>
          )}
        </section>
      )}
      {/* WP5: primary group of the shared registry (icons only when collapsed). */}
      <LeftSidebar
        isCollapsed={isCollapsed}
        onExpand={onExpandPrimary}
        links={primaryLinks}
      />
      {/* «Ещё»: every other destination stays reachable, collapsed by default. */}
      <details
        className="group/application-sections mx-1 mt-2 rounded-[var(--radius-card)] bg-[var(--state-hover)]"
        data-application-sections
        open={moreOpen}
        onToggle={event => onApplicationSectionsOpenChange(event.currentTarget.open)}
      >
        <summary
          aria-label={isCollapsed ? t('workbench.mode.more') : undefined}
          title={isCollapsed ? t('workbench.mode.more') : undefined}
          className={cn(
            'flex cursor-pointer list-none items-center rounded-[var(--radius-control)] outline-none focus-visible:ring-1 focus-visible:ring-ring [&::-webkit-details-marker]:hidden',
            isCollapsed
              ? 'mx-auto h-7 w-7 justify-center'
              : 'gap-2 px-3 py-2.5 text-xs font-semibold text-muted-foreground',
          )}
        >
          <MoreHorizontal className="icon-caption text-accent" aria-hidden />
          {!isCollapsed && <span className="min-w-0 flex-1 truncate">{t('workbench.mode.more')}</span>}
          {!isCollapsed && <ChevronRight className="icon-caption transition-transform group-open/application-sections:rotate-90 motion-reduce:transition-none" aria-hidden />}
        </summary>
        <LeftSidebar
          isCollapsed={isCollapsed}
          onExpand={onExpandMore}
          links={moreLinks}
        />
        {experimentalLinks.length > 0 && (
          <section className="mx-1 mt-5 py-2" aria-label={t('sidebar.experimentalFeatures')}>
            {!isCollapsed && <div className="px-3 pb-2 text-xs font-semibold uppercase caps-label text-text-muted">{t('sidebar.experimentalFeatures')}</div>}
            <LeftSidebar isCollapsed={isCollapsed} onExpand={onExpandMore} links={experimentalLinks} />
          </section>
        )}
      </details>
    </>
  )
})

/** The global Sessions row: navigation only, its filter tree moves to the contextual section. */
function stripSessionFilters(link: LinkItem): LinkItem {
  if (link.id !== 'nav:allSessions' || !link.items) return link
  return {
    ...link,
    // Plain navigation: the section toggle no longer applies to this row.
    onClick: () => navigate(routes.view.allSessions()),
    expandable: false, expanded: false, onToggle: undefined, items: undefined, sortable: undefined,
  }
}

export const SESSION_FILTERS_ID = 'nav:sessionFilters'
export const SESSION_FILTERS_EMPTY_HIDDEN_ID = 'nav:sessionFilters:emptyHidden'

/**
 * Contextual session filters: the status buckets (sortable when nothing is
 * hidden), then favourites / archive / labels. Empty, inactive buckets hide
 * behind «Показать пустые» so a column of zeroes does not crowd the list.
 */
export function buildSessionFilters(
  sessions: LinkItem,
  state: { showEmpty: boolean; open: boolean; onToggle: () => void },
  t: (key: string) => string,
): { links: SidebarItem[]; emptyCount: number } {
  const items = sessions.items ?? []
  const split = items.findIndex(isSeparatorItem)
  const statuses = (split >= 0 ? items.slice(0, split) : items).filter((item): item is LinkItem => !isSeparatorItem(item))
  const trailing = split >= 0 ? items.slice(split + 1) : []
  const isEmpty = (item: LinkItem) => item.count === 0 && item.variant !== 'default'
  const emptyCount = statuses.filter(isEmpty).length
  const visibleStatuses = state.showEmpty ? statuses : statuses.filter(item => !isEmpty(item))
  const hidden = visibleStatuses.length !== statuses.length
  const group: LinkItem = {
    id: SESSION_FILTERS_ID,
    title: t('sidebar.sessionFilters'),
    icon: ListFilter,
    variant: 'ghost',
    expandable: true,
    expanded: state.open,
    onToggle: state.onToggle,
    // Reordering a partial list would drop the hidden buckets: DnD only on the full list.
    sortable: hidden ? undefined : sessions.sortable,
    items: [...visibleStatuses, ...(trailing.length > 0 ? [{ id: 'separator:session-filters', type: 'separator' as const }, ...trailing] : [])],
  }
  return { links: [group], emptyCount }
}

/** True when a row, or any of its nested rows, is the active destination. */
export function hasActiveLink(items: readonly SidebarItem[]): boolean {
  return items.some(item => !isSeparatorItem(item) && (item.variant === 'default' || (item.items ? hasActiveLink(item.items) : false)))
}
