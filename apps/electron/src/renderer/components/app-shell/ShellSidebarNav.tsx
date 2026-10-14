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
import { ChevronRight, ListFilter } from 'lucide-react'
import { cn } from '@/lib/utils'
import { navigate, routes } from '@/lib/navigate'
import { enabledExtraScreenIdsAtom } from '@/atoms/extra-screens'
import { visibleExtraScreens } from '@/pages/extra-screens/registry'
import { enabledShellFlagsAtom } from '@/platform/unified-flags'
import { isSessionsNavigation, useNavigationState } from '@/contexts/NavigationContext'
import { isSeparatorItem, LeftSidebar, type LinkItem, type SidebarItem } from './LeftSidebar'
import { usePillModel } from '@/platform/usePillNav'
import { PRIMARY_NAV, PRIMARY_NAV_LINK_IDS, resolvePrimaryNav, type ResolvedPrimaryNavEntry } from './primary-nav'

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
  /**
   * WP6: stable ref setter for the per-surface contextual slot. Mode screens,
   * Notes, Memory, Learning and Settings portal their own navigation into it
   * (`ShellSidebarPortal`); it sits right under the global primary nav.
   */
  contextSlotRef?: (element: HTMLDivElement | null) => void
  /** The TopBar renders the pill (`modePillShown`); pill-placed surfaces it does not render fall back here. */
  pillShown?: boolean
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
  contextSlotRef,
  pillShown = true,
}: ShellSidebarNavProps) {
  const { t } = useTranslation()
  const navState = useNavigationState()
  const shellFlags = useAtomValue(enabledShellFlagsAtom)
  const enabledExtraScreenIds = useAtomValue(enabledExtraScreenIdsAtom)

  const { nav: { placements }, navIds: pillNavIds } = usePillModel(pillShown)
  // Sidebar v2: Settings (registry footer entry) opens from the profile popover only.
  const entries = React.useMemo(() => resolvePrimaryNav({ shellFlags, placements, pillNavIds }).filter(entry => !entry.footer), [shellFlags, placements, pillNavIds])

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
    // WP6: rows never carry their surface's sub-navigation; it moves to the
    // contextual section under the primary nav while that surface is open.
    const navRow = (entry: ResolvedPrimaryNavEntry) => stripContextItems(linkFor(entry), entry, navState)
    const primary = entries.filter(entry => entry.group === 'primary').map(navRow)
    const more: SidebarItem[] = entries.filter(entry => entry.group === 'more').map(navRow)
    // Rows the registry does not own keep their AppShell order after the registry's «Ещё».
    for (const link of baseLinks) {
      if (!isSeparatorItem(link) && !PRIMARY_NAV_LINK_IDS.has(link.id)) more.push(link)
    }
    return { primaryLinks: primary, moreLinks: more }
  }, [baseLinks, entries, navState, onOpenBrowser, t])

  // WP6: the open surface's sub-navigation (Проекты, Страницы, Источники,
  // Автоматизации), taken from its rich AppShell row.
  const contextEntry = React.useMemo(
    // From the whole registry: a surface placed in the pills (no sidebar row) still gets its context.
    () => PRIMARY_NAV.find(entry => CONTEXT_SECTION_LINK_IDS.has(entry.linkId) && entry.isActive(navState)) ?? null,
    [navState],
  )
  const surfaceSection = React.useMemo(() => {
    if (!contextEntry) return null
    const row = baseLinks.find(link => link.id === contextEntry.linkId)
    if (!row || isSeparatorItem(row) || !row.items?.length) return null
    return buildContextSection(row, { open: isExpanded(row.id), onToggle: () => toggleExpanded(row.id) })
  }, [contextEntry, baseLinks, isExpanded, toggleExpanded])

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

  // Sidebar v2 fix1: no «Ещё» disclosure — two labelled, collapsible
  // sections, both expanded by default (the expanded-sections store records
  // collapsed ids). An active destination keeps its section open.
  const showContext = !isCollapsed && (sessionFilters !== null || surfaceSection !== null)
  const navOpen = isExpanded(SIDEBAR_NAV_SECTION_ID) || hasActiveLink(primaryLinks)
  const toolsForced = hasActiveLink(moreLinks) || hasActiveLink(experimentalLinks)
  const toolsOpen = isExpanded(SIDEBAR_TOOLS_SECTION_ID) || toolsForced
  const toggleNav = React.useCallback(() => toggleExpanded(SIDEBAR_NAV_SECTION_ID), [toggleExpanded])
  const toggleTools = React.useCallback(() => toggleExpanded(SIDEBAR_TOOLS_SECTION_ID), [toggleExpanded])
  void applicationSectionsOpen
  void onApplicationSectionsOpenChange

  return (
    <>
      {/* WP6 slot 1: the global primary nav — same rows, same order on every screen. */}
      <nav aria-label={t('sidebar.navigation')} data-sidebar-primary-nav="" className="px-1">
        {!isCollapsed && <SidebarSectionHeader id="sidebar-section-nav" label={t('sidebar.navigation')} open={navOpen} locked={hasActiveLink(primaryLinks)} onToggle={toggleNav} />}
        {(isCollapsed || navOpen) && (
          <div id="sidebar-section-nav">
            <LeftSidebar isCollapsed={isCollapsed} onExpand={onExpandPrimary} links={primaryLinks} />
          </div>
        )}
      </nav>
      {/* WP6 slot 2: the open surface's contextual navigation, right under the global nav. */}
      {showContext && (
        <section
          className="mx-1 mt-2 border-t border-border-subtle pt-2"
          aria-label={sessionFilters ? t('sidebar.sessionFilters') : surfaceSection!.title}
          data-sidebar-context=""
          {...(sessionFilters ? { 'data-session-filters': '' } : {})}
        >
          {sessionFilters && (
            <>
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
            </>
          )}
          {surfaceSection && <LeftSidebar isCollapsed={false} onExpand={onExpandPrimary} links={surfaceSection.links} />}
        </section>
      )}
      {/* Portal target for screens that own their navigation (mode screens, Notes, Memory, Settings…). */}
      <div
        ref={contextSlotRef}
        hidden={isCollapsed}
        data-primary-sidebar-context=""
        className="mx-1 mt-2 border-t border-border-subtle empty:hidden"
      />
      {/* «Инструменты» (former «Ещё»): every other destination, shown directly. */}
      {(moreLinks.length > 0 || experimentalLinks.length > 0) && (
        <section aria-label={t('sidebar.tools')} data-sidebar-tools="" data-application-sections="" className="mt-1 px-1">
          {isCollapsed
            ? <div className="mx-auto my-1.5 h-px w-6 bg-border-subtle" role="separator" aria-hidden data-sidebar-section-divider="" />
            : <SidebarSectionHeader id="sidebar-section-tools" label={t('sidebar.tools')} open={toolsOpen} locked={toolsForced} onToggle={toggleTools} />}
          {(isCollapsed || toolsOpen) && (
            <div id="sidebar-section-tools">
              <LeftSidebar isCollapsed={isCollapsed} onExpand={onExpandMore} links={moreLinks} />
              {experimentalLinks.length > 0 && (
                <section className="mt-2" aria-label={t('sidebar.experimentalFeatures')}>
                  {!isCollapsed && <div className="px-3 pb-0.5 pt-1 text-[11px] font-semibold uppercase caps-label text-text-muted">{t('sidebar.experimentalFeatures')}</div>}
                  <LeftSidebar isCollapsed={isCollapsed} onExpand={onExpandMore} links={experimentalLinks} />
                </section>
              )}
            </div>
          )}
        </section>
      )}
    </>
  )
})

/** Rows whose children become the contextual section while their surface is open. */
export const CONTEXT_SECTION_LINK_IDS: ReadonlySet<string> = new Set(['nav:projects', 'nav:pages', 'nav:sources', 'nav:automations'])

/**
 * A global nav row is navigation only: its filter tree (sessions) or
 * sub-items (projects, pages, sources, automations) move to the contextual
 * section. Clicking the row of the open surface returns to its root (clears
 * a sub-filter) instead of toggling a section that is no longer there.
 */
export function stripContextItems(link: LinkItem, entry: Pick<ResolvedPrimaryNavEntry, 'route' | 'isActive'>, navState: Parameters<ResolvedPrimaryNavEntry['isActive']>[0]): LinkItem {
  const owned = link.id === 'nav:allSessions' || CONTEXT_SECTION_LINK_IDS.has(link.id)
  if (!owned || !link.items) return link
  const route = entry.route
  const active = entry.isActive(navState)
  const onClick = link.id === 'nav:allSessions'
    ? () => navigate(routes.view.allSessions())
    : route && active ? () => navigate(route()) : link.onClick
  return {
    ...link,
    onClick,
    // On a filtered sub-view (status, source type, a page…) the surface row
    // stays highlighted — and keeps «Ещё» open — while the child is selected
    // in the context section.
    variant: active ? 'default' : link.variant,
    // Children (and the jump-to-filter highlights they carry) live in the context section only.
    expandable: false, expanded: false, onToggle: undefined, items: undefined, sortable: undefined,
  }
}

/** The contextual section for a surface row: its sub-items under a collapsible header (state persisted per row id). */
export function buildContextSection(row: LinkItem, state: { open: boolean; onToggle: () => void }): { title: string; links: SidebarItem[] } {
  const group: LinkItem = {
    id: `${row.id}:context`,
    title: row.title,
    icon: row.icon,
    variant: 'ghost',
    expandable: true,
    expanded: state.open,
    onToggle: state.onToggle,
    contextMenu: row.contextMenu,
    items: row.items,
  }
  return { title: row.title, links: [group] }
}

export const SIDEBAR_NAV_SECTION_ID = 'sidebar:section:navigation'
export const SIDEBAR_TOOLS_SECTION_ID = 'sidebar:section:tools'

/** Collapsible section label (persisted via the expanded-sections store). */
export function SidebarSectionHeader({ id, label, open, locked, onToggle }: { id: string; label: string; open: boolean; locked?: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-controls={id}
      aria-disabled={locked || undefined}
      onClick={locked ? undefined : onToggle}
      data-sidebar-section-header=""
      className="group/section-header flex h-7 w-full items-center gap-1 rounded-[var(--radius-control)] px-3 text-left text-[11px] font-semibold uppercase caps-label text-text-muted outline-none transition-colors hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
    >
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <ChevronRight className={cn('h-3 w-3 shrink-0 opacity-0 transition-transform group-hover/section-header:opacity-100 group-focus-visible/section-header:opacity-100 motion-reduce:transition-none', open && 'rotate-90')} aria-hidden />
    </button>
  )
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
