/**
 * ShellSidebarNav — the contextual sidebar (Mark: «сайдбар под текущий экран,
 * экраны переключаются пилюлями»).
 *
 * The sidebar shows only the CURRENT screen: its title and primary action
 * (the rich AppShell row's `actions`, e.g. «+ новый чат»), then its own
 * navigation, chosen through `sidebar-registry.ts`:
 * - Сессии: the session filters (statuses, Избранное, Архив, Метки);
 * - Проекты / Страницы / Источники / Автоматизации: the row's sub-items;
 * - screens that own a navigator portal it into `contextSlotRef`;
 * - everything else (or a portal screen whose page rendered nothing):
 *   «Закреплённое» + «Недавнее», loaded lazily.
 * The global Навигация / Инструменты lists are gone: switching screens is the
 * titlebar pill and its «Все экраны» menu. The collapsed rail shows the same
 * current-screen items as icons.
 *
 * WP3: this memoised child owns the atom subscriptions only the sidebar
 * reads, so unrelated atom changes re-render neither this block nor its rows;
 * the portal slot is a stable DOM node, so a route change re-renders this
 * block and the page, never the whole shell.
 */
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronRight, ListFilter } from 'lucide-react'
import { cn } from '@/lib/utils'
import { navigate, routes } from '@/lib/navigate'
import { isSessionsNavigation, useNavigationState } from '@/contexts/NavigationContext'
import { isSeparatorItem, LeftSidebar, type LinkItem, type SidebarItem } from './LeftSidebar'
import { PRIMARY_NAV } from './primary-nav'
import { resolveCurrentSurface } from './sidebar-registry'

const RecentPinnedSidebar = React.lazy(() => import('./RecentPinnedSidebar'))

export interface ShellSidebarNavProps {
  /** Memoised AppShell sidebar rows (rich rows reused by link id). */
  baseLinks: SidebarItem[]
  isCollapsed: boolean
  /** Collapsed-rail click on a current-screen item: expand the sidebar to it. */
  onExpand: (link: LinkItem, inMore: boolean) => void
  /** Kept for API compatibility (the browser opens from the pill now). */
  onOpenBrowser?: () => void
  /** Persisted expanded-sections store (AppShell `collapsedItems`). */
  isExpanded: (id: string) => boolean
  toggleExpanded: (id: string) => void
  /**
   * Stable ref setter for the per-surface slot. Mode screens, Notes, Memory,
   * Learning, Connections and Settings portal their own navigation into it
   * (`ShellSidebarPortal`).
   */
  contextSlotRef?: (element: HTMLDivElement | null) => void
  /** Kept for API compatibility. */
  pillShown?: boolean
  /** Workspace ids (local + remote) scoping «Недавнее» / «Закреплённое». */
  workspaceIds?: readonly string[]
}

const NO_WORKSPACES: readonly string[] = []

/** Session filter group → its rows (collapsed rail shows them flat). */
function flattenGroup(links: readonly SidebarItem[]): LinkItem[] {
  const out: LinkItem[] = []
  for (const link of links) {
    if (isSeparatorItem(link)) continue
    if (link.items?.length) out.push(...flattenGroup(link.items))
    else out.push(link)
  }
  return out
}

/** True while a page has portalled content into the slot (observed, no re-render loop). */
function useSlotFilled(slot: HTMLDivElement | null): boolean {
  const [filled, setFilled] = React.useState(false)
  React.useLayoutEffect(() => {
    if (!slot) { setFilled(false); return }
    const update = () => setFilled(slot.childElementCount > 0)
    update()
    if (typeof MutationObserver === 'undefined') return
    const observer = new MutationObserver(update)
    observer.observe(slot, { childList: true })
    return () => observer.disconnect()
  }, [slot])
  return filled
}

export const ShellSidebarNav = React.memo(function ShellSidebarNav({
  baseLinks,
  isCollapsed,
  onExpand,
  isExpanded,
  toggleExpanded,
  contextSlotRef,
  workspaceIds = NO_WORKSPACES,
}: ShellSidebarNavProps) {
  const { t } = useTranslation()
  const navState = useNavigationState()
  const current = React.useMemo(() => resolveCurrentSurface(navState), [navState])

  const rowById = React.useCallback((id: string | null): LinkItem | null => {
    if (!id) return null
    const row = baseLinks.find(link => !isSeparatorItem(link) && link.id === id)
    return row && !isSeparatorItem(row) ? row : null
  }, [baseLinks])

  // Contextual sub-navigation (Проекты, Страницы, Источники, Автоматизации).
  const surfaceSection = React.useMemo(() => {
    if (current.kind !== 'context') return null
    const row = rowById(current.linkId)
    if (!row?.items?.length) return null
    return buildContextSection(row, { open: isExpanded(row.id), onToggle: () => toggleExpanded(row.id) })
  }, [current, rowById, isExpanded, toggleExpanded])

  // Session filters (statuses, favourites, archive, labels).
  const inSessions = isSessionsNavigation(navState)
  // The store records collapsed ids, so «empty buckets hidden» is the
  // default (expanded) state of SESSION_FILTERS_EMPTY_HIDDEN_ID.
  const filtersOpen = isExpanded(SESSION_FILTERS_ID)
  const showEmpty = !isExpanded(SESSION_FILTERS_EMPTY_HIDDEN_ID)
  const toggleFilters = React.useCallback(() => toggleExpanded(SESSION_FILTERS_ID), [toggleExpanded])
  const toggleShowEmpty = React.useCallback(() => toggleExpanded(SESSION_FILTERS_EMPTY_HIDDEN_ID), [toggleExpanded])
  const sessionFilters = React.useMemo(() => {
    const sessions = rowById('nav:allSessions')
    if (!inSessions || !sessions?.items?.length) return null
    return buildSessionFilters(sessions, { showEmpty, open: filtersOpen, onToggle: toggleFilters }, t)
  }, [rowById, inSessions, showEmpty, filtersOpen, toggleFilters, t])

  // Page-owned navigator slot: a portal screen with nothing in it falls back.
  const [slot, setSlot] = React.useState<HTMLDivElement | null>(null)
  const slotRef = React.useCallback((element: HTMLDivElement | null) => {
    setSlot(element)
    contextSlotRef?.(element)
  }, [contextSlotRef])
  const slotFilled = useSlotFilled(slot)
  const showFallback = current.kind === 'fallback'
    || (current.kind === 'portal' && !slotFilled)
    || (current.kind === 'context' && !surfaceSection)
    || (current.kind === 'sessions' && !sessionFilters)

  // Header primary action: the screen row's own actions; screens without one
  // (Главная and the other fallback screens) get «+ новый чат» from Сессии.
  const headerRow = rowById(current.linkId)
  const headerActions = headerRow?.actions ?? (showFallback || current.kind === 'sessions' ? rowById('nav:allSessions')?.actions : undefined)
  const title = current.titleKey ? t(current.titleKey) : null
  const goRoot = React.useCallback(() => {
    if (current.kind === 'sessions') { navigate(routes.view.allSessions()); return }
    const entry = PRIMARY_NAV.find(candidate => candidate.id === current.id)
    if (entry?.route) navigate(entry.route())
  }, [current])

  const onExpandRow = React.useCallback((link: LinkItem) => onExpand(link, false), [onExpand])
  const railLinks = React.useMemo(() => {
    if (!isCollapsed) return null
    if (sessionFilters) return flattenGroup(sessionFilters.links)
    if (surfaceSection) return flattenGroup(surfaceSection.links)
    return null
  }, [isCollapsed, sessionFilters, surfaceSection])

  return (
    <nav
      aria-label={title ?? t('sidebar.navigation')}
      data-sidebar-primary-nav=""
      data-tour="guide.sidebar-nav"
      data-sidebar-surface={current.id ?? undefined}
      data-sidebar-content={showFallback ? 'fallback' : current.kind}
      className="px-1"
    >
      {!isCollapsed && title && (
        <div className="flex h-8 items-center gap-1 pl-3 pr-1" data-sidebar-screen-header="">
          <button
            type="button"
            onClick={goRoot}
            className="min-w-0 flex-1 truncate rounded-[var(--radius-control)] text-left text-body font-semibold text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring"
            data-sidebar-screen-title=""
          >
            <h2 className="truncate text-body font-semibold">{title}</h2>
          </button>
          {headerActions}
        </div>
      )}
      {railLinks && railLinks.length > 0 && <LeftSidebar isCollapsed onExpand={onExpandRow} links={railLinks} />}
      {!isCollapsed && sessionFilters && (
        <section aria-label={t('sidebar.sessionFilters')} data-sidebar-context="" data-session-filters="">
          <LeftSidebar isCollapsed={false} onExpand={onExpandRow} links={sessionFilters.links} />
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
          {/* chat-folders hook point: the folder tree mounts here (feat/chat-folders). */}
          <div data-sidebar-folders-slot="" className="empty:hidden" />
        </section>
      )}
      {!isCollapsed && surfaceSection && (
        <section aria-label={surfaceSection.title} data-sidebar-context="">
          <LeftSidebar isCollapsed={false} onExpand={onExpandRow} links={surfaceSection.links} />
        </section>
      )}
      {/* Portal target for screens that own their navigation (mode screens, Notes, Memory, Settings…). */}
      <div ref={slotRef} hidden={isCollapsed} data-primary-sidebar-context="" className="empty:hidden" />
      {(showFallback || isCollapsed) && !railLinks?.length && (
        <React.Suspense fallback={null}>
          <RecentPinnedSidebar workspaceIds={workspaceIds} isCollapsed={isCollapsed} onExpand={onExpandRow} />
        </React.Suspense>
      )}
    </nav>
  )
})

/** Rows whose children become the contextual section while their surface is open. */
export const CONTEXT_SECTION_LINK_IDS: ReadonlySet<string> = new Set(['nav:projects', 'nav:pages', 'nav:sources', 'nav:automations'])

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
export function SidebarSectionHeader({ id, label, open, onToggle }: { id: string; label: string; open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-controls={id}
      onClick={onToggle}
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

/** A collapsed section keeps only its active row(s) (a row is active itself or through a nested row). */
export function activeRowsOnly(items: readonly SidebarItem[]): SidebarItem[] {
  return items.filter(item => !isSeparatorItem(item) && hasActiveLink([item]))
}

/** True when a row, or any of its nested rows, is the active destination. */
export function hasActiveLink(items: readonly SidebarItem[]): boolean {
  return items.some(item => !isSeparatorItem(item) && (item.variant === 'default' || (item.items ? hasActiveLink(item.items) : false)))
}
