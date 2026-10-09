import type { LucideIcon } from "lucide-react"
import * as React from "react"
import { AnimatePresence, motion, useIsPresent, type Variants } from "motion/react"
import { usePrefersReducedMotion } from "@/lib/render-profile-motion"

import { useTranslation } from "react-i18next"

import { cn } from "@/lib/utils"
import { useSuperEngineeringProfile } from '@/hooks/useSuperEngineeringProfile'
import { SE_RAIL_ACTIVE_BUTTON_CLASS, SE_RAIL_INACTIVE_BUTTON_CLASS } from '@/lib/se-icon-map'
import {
  isNavigableExpandable,
  restoreFocusToToggle,
  SidebarDisclosureButton,
  SidebarDisclosureChevron,
  sidebarSectionDomId,
} from './SidebarDisclosure'
import {
  ContextMenu,
  ContextMenuTrigger,
  StyledContextMenuContent,
} from '@/components/ui/styled-context-menu'
import { ContextMenuProvider } from '@/components/ui/menu-context'
import { SidebarMenu, type SidebarMenuType } from './SidebarMenu'
import { SortableList, type SortableItemData } from '@/components/ui/sortable-list'
import type { AppNavDestinationId } from './nav-destinations'
import { getServiceContextLinks } from './service-navigation'
import { preloadRoute } from './route-pages'
import type { RoutePageName } from './route-pages'

/** Context menu configuration for sidebar items */
export interface SidebarContextMenuConfig {
  /** Type of sidebar item (determines available menu items) */
  type: SidebarMenuType
  /** Status ID for status items (e.g., 'todo', 'done') - not currently used but kept for future */
  statusId?: string
  /** Label ID — when set, this is an individual label (enables Delete Label) */
  labelId?: string
  /** Handler for "Configure Statuses" action - for allSessions/status/flagged types */
  onConfigureStatuses?: () => void
  /** Handler for "Mark All Read" action - for allSessions type */
  onMarkAllRead?: () => void
  /** Handler for "Configure Labels" action - receives labelId when triggered from a specific label */
  onConfigureLabels?: (labelId?: string) => void
  /** Handler for "Add New Label" action - creates a label (parentId passed from labelId) */
  onAddLabel?: (parentId?: string) => void
  /** Handler for "Delete Label" action - deletes the label by labelId */
  onDeleteLabel?: (labelId: string) => void
  /** Handler for "Add Source" action - for sources type */
  onAddSource?: () => void
  /** Handler for "Add Skill" action - for skills type */
  onAddSkill?: () => void
  /** Handler for "Add Automation" action - for automations type */
  onAddAutomation?: () => void
  /** Handler for "Add Project" action - for projects type */
  onAddProject?: () => void
  /** Source type filter for "Learn More" link - determines which docs page to open */
  sourceType?: 'api' | 'mcp' | 'local'
  /** Handler for "Edit Views" action - for views type */
  onConfigureViews?: () => void
  /** View ID — when set, this is an individual view (enables Delete) */
  viewId?: string
  /** Handler for "Delete View" action */
  onDeleteView?: (id: string) => void
}

/**
 * Sortable configuration for expandable sidebar items.
 * When present on an expandable LinkItem, its children become drag-sortable.
 */
export interface SortableConfig {
  /** Flat list reorder: called with new ordered array of item IDs after a drag-drop */
  onReorder: (orderedIds: string[]) => void
}

export interface LinkItem {
  id: string            // Unique ID for navigation (e.g., 'nav:allSessions')
  title: string
  label?: string        // Optional badge (e.g., count)
  icon: LucideIcon | React.ReactNode  // LucideIcon or custom React element
  iconColor?: string    // Optional color class for the icon
  /** Whether the icon responds to color (uses currentColor). Default true for Lucide icons. */
  iconColorable?: boolean
  variant: "default" | "ghost"  // "default" = highlighted, "ghost" = subtle
  onClick?: () => void
  // Expandable item properties
  expandable?: boolean
  expanded?: boolean
  onToggle?: () => void
  items?: SidebarItem[]    // Subitems as data (rendered as nested LeftSidebar) - supports separators
  // Compact mode: reduced vertical padding (4px less total height)
  compact?: boolean
  // Tutorial system
  dataTutorial?: string // data-tutorial attribute for tutorial targeting
  // Context menu configuration (optional - if provided, right-click shows context menu)
  contextMenu?: SidebarContextMenuConfig
  // Drag-and-drop: flat list reorder (e.g., statuses)
  sortable?: SortableConfig
  // Optional element rendered after the title (e.g., label type icon), revealed on hover
  afterTitle?: React.ReactNode
  /** Accent unseen dot (same treatment as What's New badge) */
  hasUnseen?: boolean
  /** Optional hover tooltip (e.g. saved view descriptions). */
  tooltip?: string
  /** Sibling row actions, never nested inside the navigation button. */
  actions?: React.ReactNode
}

export interface SeparatorItem {
  id: string
  type: 'separator'
}

export type SidebarItem = LinkItem | SeparatorItem

export const isSeparatorItem = (item: SidebarItem): item is SeparatorItem =>
  'type' in item && item.type === 'separator'

interface LeftSidebarProps {
  isCollapsed: boolean
  links: SidebarItem[]
  /** Get props for each item (from unified sidebar navigation) */
  getItemProps?: (id: string) => {
    tabIndex: number
    'data-focused': boolean
    ref: (el: HTMLElement | null) => void
  }
  /** Currently focused item ID */
  focusedItemId?: string | null
  /** Whether this is a nested sidebar (child of expandable item) */
  isNested?: boolean
  /** Limit the outer sidebar to its service; nested sections keep their children. */
  serviceId?: AppNavDestinationId | null
  onExpand?: (link: LinkItem) => void
}

// Stagger only small trees. A 500-row section must not pay sequential delays.
function nestedContainerVariants(childCount: number): Variants {
  const stagger = childCount > 24 ? 0 : 0.025
  return {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: stagger,
        delayChildren: stagger === 0 ? 0 : 0.01,
      },
    },
    exit: {
      opacity: 0,
      transition: {
        staggerChildren: stagger === 0 ? 0 : 0.015,
        staggerDirection: -1,
      },
    },
  }
}

const itemVariants: Variants = {
  hidden: { opacity: 0, x: -8 },
  visible: {
    opacity: 1,
    x: 0,
    transition: { duration: 0.15, ease: 'easeOut' },
  },
  exit: {
    opacity: 0,
    x: -8,
    transition: { duration: 0.1, ease: 'easeIn' },
  },
}

/**
 * LeftSidebar - Vertical list of navigation buttons with icons
 *
 * Navigation is managed by the parent component (Chat.tsx) for unified
 * sidebar keyboard navigation. This component just renders the items.
 *
 * Styling matches agent items in the sidebar for consistency:
 * - py-[7px] px-2 text-[13px] rounded-md
 * - Icon: h-4 w-4, muted idle tone lifting to foreground on row hover
 *
 * Link variants:
 * - "default": Highlighted style (used for active/selected items)
 * - "ghost": Subtle style (used for inactive items)
 *
 * Expandable items:
 * - Show a chevron toggle on hover (replaces icon position)
 * - Children are rendered with animated expand/collapse
 * - Nested items have left indentation with vertical line
 *
 * Drag-and-drop:
 * - Expandable items can opt-in to sortable (flat) or sortableTree (hierarchical) DnD
 * - Uses @dnd-kit with DragOverlay portaled to document.body (no clipping)
 * - Two-phase drop animation: overlay fades out, ghost fades in
 */
export function LeftSidebar({ links, isCollapsed, getItemProps, focusedItemId, isNested, serviceId, onExpand }: LeftSidebarProps) {
  const { t } = useTranslation()
  const reduceMotion = usePrefersReducedMotion()
  const visibleLinks = !isNested && serviceId !== undefined
    ? getServiceContextLinks(links, serviceId)
    : links
  // For nested sidebars, wrap in motion container for stagger effect
  const NavWrapper = isNested && !reduceMotion ? motion.nav : 'nav'
  const navProps = isNested && !reduceMotion ? {
    variants: nestedContainerVariants(visibleLinks.length),
    initial: 'hidden',
    animate: 'visible',
    exit: 'exit',
  } : {}

  return (
    <div className={cn("flex flex-col select-none", !isNested && "py-1")}>
      <NavWrapper
        className={cn(
          "grid gap-0.5",
          isNested ? "pl-5 pr-0 relative" : "px-2"
        )}
        role="navigation"
        aria-label={t(isNested ? 'sidebar.subNavigation' : 'sidebar.contextNavigation')}
        {...navProps}
      >
        {/* Vertical line for nested items - 4px left of chevron center */}
        {isNested && (
          <div
            className="absolute left-[13px] top-1 bottom-1 w-px bg-foreground/10"
            aria-hidden="true"
          />
        )}
        {visibleLinks.map((item) => {
          // Handle separator items
          if (isSeparatorItem(item)) {
            return (
              <div key={item.id} className="py-1 px-2" aria-hidden="true">
                <div className="h-px bg-foreground/5" />
              </div>
            )
          }

          const link = item
          const itemProps = getItemProps?.(link.id)

          if (isCollapsed) {
            return (
              <button key={link.id} type="button" title={link.title} aria-label={link.title}
                aria-current={link.variant === 'default' ? 'page' : undefined}
                data-sidebar-link-id={link.id}
                onClick={() => { if (onExpand) onExpand(link); else link.onClick?.() }}
                className={cn('group mx-auto grid size-9 place-items-center rounded-[var(--radius-control)] outline-none transition-colors focus-visible:ring-1 focus-visible:ring-ring', link.variant === 'default' ? 'rox-nav-shimmer bg-[var(--shell-hover,var(--element-hover,var(--foreground-5)))]' : 'hover:bg-[var(--shell-hover,var(--element-hover,var(--foreground-5)))]')}>
                <span className="flex h-4 w-4 items-center justify-center">{renderIcon(link)}</span>
              </button>
            )
          }

          const content = link.expandable ? (
            <ExpandableSection
              link={link}
              itemProps={itemProps}
              getItemProps={getItemProps}
              focusedItemId={focusedItemId}
              isNested={isNested}
            />
          ) : (
            <div className="group/section">
              <div className="flex min-w-0 items-center gap-1">
                <div className="min-w-0 flex-1">{wrapWithContextMenu(link, <SidebarButton link={link} itemProps={itemProps} />)}</div>
                {link.actions}
              </div>
            </div>
          )

          // For nested items, wrap in motion.div for stagger animation
          return isNested && !reduceMotion ? (
            <motion.div key={link.id} variants={itemVariants}>
              {content}
            </motion.div>
          ) : (
            <React.Fragment key={link.id}>
              {content}
            </React.Fragment>
          )
        })}
      </NavWrapper>
    </div>
  )
}

function wrapWithContextMenu(link: LinkItem, button: React.ReactElement) {
  if (!link.contextMenu) return button
  return (
    <ContextMenu modal={true}>
      <ContextMenuTrigger asChild>
        {button}
      </ContextMenuTrigger>
      <StyledContextMenuContent>
        <ContextMenuProvider>
          <SidebarMenu
            type={link.contextMenu.type}
            statusId={link.contextMenu.statusId}
            labelId={link.contextMenu.labelId}
            onConfigureStatuses={link.contextMenu.onConfigureStatuses}
            onMarkAllRead={link.contextMenu.onMarkAllRead}
            onConfigureLabels={link.contextMenu.onConfigureLabels}
            onAddLabel={link.contextMenu.onAddLabel}
            onDeleteLabel={link.contextMenu.onDeleteLabel}
            onAddSource={link.contextMenu.onAddSource}
            onAddSkill={link.contextMenu.onAddSkill}
            onAddAutomation={link.contextMenu.onAddAutomation}
            onAddProject={link.contextMenu.onAddProject}
            sourceType={link.contextMenu.sourceType}
            onConfigureViews={link.contextMenu.onConfigureViews}
            viewId={link.contextMenu.viewId}
            onDeleteView={link.contextMenu.onDeleteView}
          />
        </ContextMenuProvider>
      </StyledContextMenuContent>
    </ContextMenu>
  )
}

function ExpandableSection({
  link,
  itemProps,
  getItemProps,
  focusedItemId,
  isNested,
}: {
  link: LinkItem
  itemProps: ReturnType<NonNullable<LeftSidebarProps['getItemProps']>> | undefined
  getItemProps: LeftSidebarProps['getItemProps']
  focusedItemId: string | null | undefined
  isNested: boolean | undefined
}) {
  const { t } = useTranslation()
  const reduceMotion = usePrefersReducedMotion()
  const bodyRef = React.useRef<HTMLDivElement>(null)
  const toggleRef = React.useRef<HTMLButtonElement>(null)
  const sectionId = sidebarSectionDomId(link.id)
  const navParent = isNavigableExpandable(link)
  const duration = reduceMotion ? 0 : 0.18
  const groupAriaLabel = !navParent
    ? t(link.expanded ? 'sidebar.disclosure.collapse' : 'sidebar.disclosure.expand', { section: link.title })
    : undefined

  const handleToggle = React.useCallback(() => {
    if (link.expanded) {
      restoreFocusToToggle(bodyRef.current, toggleRef.current)
    }
    link.onToggle?.()
  }, [link])

  const navButton = (
    <SidebarButton
      link={link}
      itemProps={itemProps}
      groupDisclosure={!navParent}
      sectionId={sectionId}
      toggleRef={!navParent ? toggleRef : undefined}
      onGroupToggle={!navParent ? handleToggle : undefined}
      groupAriaLabel={groupAriaLabel}
    />
  )

  return (
    <div className="group/section">
      {navParent ? (
        <div className="group/row flex min-w-0 items-center gap-0.5" role="none">
          <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center">
            <SidebarDisclosureButton
              ref={toggleRef}
              expanded={!!link.expanded}
              sectionId={sectionId}
              sectionTitle={link.title}
              onToggle={handleToggle}
            />
          </span>
          <div className="min-w-0 flex-1">
            {wrapWithContextMenu(link, navButton)}
          </div>
          {link.actions}
        </div>
      ) : (
        wrapWithContextMenu(link, navButton)
      )}
      {link.items && (
        <AnimatePresence initial={false}>
          {link.expanded && (
            <SidebarSectionBody
              ref={bodyRef}
              id={sectionId}
              initial={{ height: 0, opacity: 0, marginTop: 0, marginBottom: 0 }}
              animate={{ height: 'auto', opacity: 1, marginTop: 2, marginBottom: isNested ? 4 : 8 }}
              exit={{ height: 0, opacity: 0, marginTop: 0, marginBottom: 0 }}
              transition={{ duration, ease: 'easeInOut' }}
              className="overflow-hidden"
            >
              {renderExpandedContent(link, getItemProps, focusedItemId, isNested)}
            </SidebarSectionBody>
          )}
        </AnimatePresence>
      )}
    </div>
  )
}

// AnimatePresence keeps exiting content mounted for the closing animation.
// Remove it from native focus traversal as soon as the disclosure closes.
const SidebarSectionBody = React.forwardRef<HTMLDivElement, React.ComponentProps<typeof motion.div>>(
  function SidebarSectionBody(props, ref) {
    const isPresent = useIsPresent()
    // React 18 supports the native attribute through a string-valued spread;
    // its HTML types predate inert, and boolean unknown attributes are omitted.
    return <motion.div {...props} {...(isPresent ? {} : { inert: '' })} ref={ref} aria-hidden={!isPresent} />
  },
)

// ============================================================
// Expanded Content Renderer
// Chooses between sortable, sortableTree, or regular nested sidebar
// ============================================================

function renderExpandedContent(
  link: LinkItem,
  getItemProps: LeftSidebarProps['getItemProps'],
  focusedItemId: string | null | undefined,
  isNested: boolean | undefined
): React.ReactNode {
  // Flat sortable (e.g., statuses): wrap items in SortableList
  if (link.sortable && link.items) {
    // Split at first separator: items before are sortable, items after are trailing (non-sortable)
    const separatorIndex = link.items.findIndex(isSeparatorItem)
    const sortableItems = separatorIndex >= 0 ? link.items.slice(0, separatorIndex) : link.items
    const trailingItems = separatorIndex >= 0
      ? link.items.slice(separatorIndex + 1).filter((item): item is LinkItem => !isSeparatorItem(item))
      : []

    return (
      <SortableStatusList
        items={sortableItems}
        onReorder={link.sortable.onReorder}
        getItemProps={getItemProps}
        focusedItemId={focusedItemId}
        trailingItems={trailingItems.length > 0 ? trailingItems : undefined}
      />
    )
  }

  // Default: regular nested sidebar (no DnD)
  return (
    <LeftSidebar
      isCollapsed={false}
      isNested={true}
      getItemProps={getItemProps}
      focusedItemId={focusedItemId}
      links={link.items!}
    />
  )
}

// ============================================================
// SortableStatusList — flat sortable wrapper for status items
// ============================================================

interface SortableStatusListProps {
  items: SidebarItem[]
  onReorder: (orderedIds: string[]) => void
  getItemProps: LeftSidebarProps['getItemProps']
  focusedItemId: string | null | undefined
  /** Non-sortable items rendered after the sortable list (e.g., Flagged, Archived) */
  trailingItems?: LinkItem[]
}

function SortableStatusList({ items, onReorder, getItemProps, focusedItemId, trailingItems }: SortableStatusListProps) {
  // Filter to LinkItems only (separators don't participate in DnD)
  const linkItems = items.filter((item): item is LinkItem => !isSeparatorItem(item))

  // Map to SortableItemData format (needs `id` field)
  const sortableItems: (LinkItem & SortableItemData)[] = linkItems.map(item => ({
    ...item,
    id: item.id,
  }))

  const handleReorder = React.useCallback((newItems: (LinkItem & SortableItemData)[]) => {
    // Extract the raw IDs (strip 'nav:state:' prefix) for the IPC call
    const orderedIds = newItems.map(item => {
      // Strip navigation prefix to get the actual status/label ID
      const parts = item.id.split(':')
      return parts[parts.length - 1]
    })
    onReorder(orderedIds)
  }, [onReorder])

  return (
    <div className="flex flex-col select-none">
      <div className="pl-5 pr-0 relative">
        {/* Vertical line for nested items */}
        <div
          className="absolute left-[13px] top-1 bottom-1 w-px bg-foreground/10"
          aria-hidden="true"
        />
        <SortableList
          items={sortableItems}
          onReorder={handleReorder}
          className="grid gap-0.5"
          renderItem={(item) => (
            <div className="group/section">
              {item.contextMenu ? (
                <ContextMenu modal={true}>
                  <ContextMenuTrigger asChild>
                    <SidebarButton
                      link={item}
                      itemProps={getItemProps?.(item.id)}
                    />
                  </ContextMenuTrigger>
                  <StyledContextMenuContent>
                    <ContextMenuProvider>
                      <SidebarMenu
                        type={item.contextMenu.type}
                        statusId={item.contextMenu.statusId}
                        labelId={item.contextMenu.labelId}
                        onConfigureStatuses={item.contextMenu.onConfigureStatuses}
                        onMarkAllRead={item.contextMenu.onMarkAllRead}
                        onConfigureLabels={item.contextMenu.onConfigureLabels}
                        onAddLabel={item.contextMenu.onAddLabel}
                        onDeleteLabel={item.contextMenu.onDeleteLabel}
                        onAddSource={item.contextMenu.onAddSource}
                        onAddSkill={item.contextMenu.onAddSkill}
                        onAddAutomation={item.contextMenu.onAddAutomation}
                        sourceType={item.contextMenu.sourceType}
                        onConfigureViews={item.contextMenu.onConfigureViews}
                        viewId={item.contextMenu.viewId}
                        onDeleteView={item.contextMenu.onDeleteView}
                      />
                    </ContextMenuProvider>
                  </StyledContextMenuContent>
                </ContextMenu>
              ) : (
                <SidebarButton
                  link={item}
                  itemProps={getItemProps?.(item.id)}
                />
              )}
            </div>
          )}
          renderOverlay={(item) => (
            <SidebarButton
              link={item}
              isOverlay={true}
            />
          )}
        />
        {/* Non-sortable trailing items (e.g., Flagged, Archived) */}
        {trailingItems && trailingItems.length > 0 && (
          <>
            <div className="my-1 ml-2" aria-hidden="true">
              <div className="h-px bg-foreground/5" />
            </div>
            <LeftSidebar links={trailingItems} isCollapsed={false} getItemProps={getItemProps} focusedItemId={focusedItemId} />
          </>
        )}
      </div>
    </div>
  )
}

// ============================================================
// SidebarButton - Extracted button component for reuse in sortable contexts
// ============================================================

/**
 * PERF-10 (#1577) — hover/focus prefetch table: sidebar link id → the lazy
 * route chunk that link's `onClick` opens. AppShell builds the rows and
 * navigates `routes.*`; the dispatcher (`MainContentPanel`'s
 * `SurfaceRoutePanel`) mounts exactly these registry pages.
 *
 * Links whose landing page is eager have no entry — the sessions list
 * (`nav:allSessions`, flag/archive/state/label/view filters), home, memory,
 * learning, projects home, settings, the automations picker, page details
 * (`PageView`) and project details. Nested session rows are covered by
 * `SessionItem`'s transcript prefetch instead.
 */
const SIDEBAR_ROUTE_PRELOADS: Record<string, RoutePageName> = {
  'nav:notes': 'notes', // routes.view.notes() → NotesPage
  'nav:tasks': 'tasks', // routes.view.tasks() → TasksPage
  'nav:meetings': 'planWorkspace', // routes.view.meetings() → MeetingsPage (planWorkspace chunk)
  'nav:feed': 'feed', // routes.view.feed() → FeedPage
  'nav:inbox': 'inbox', // routes.view.inbox() → InboxPage
  'nav:pages': 'pagesHome', // routes.view.pages() → PagesHome
  'nav:sources': 'integrationsCatalog', // routes.view.sources() → IntegrationsCatalogPage
  'nav:sources:api': 'integrationsCatalog', // routes.view.sourcesApi() → IntegrationsCatalogPage
  'nav:sources:mcp': 'integrationsCatalog', // routes.view.sourcesMcp() → IntegrationsCatalogPage
  'nav:sources:local': 'integrationsCatalog', // routes.view.sourcesLocal() → IntegrationsCatalogPage
  'nav:skills': 'skillsCatalog', // routes.view.skills() → SkillsCatalogPage
  'nav:connections': 'connections', // routes.view.connections() → ConnectionsPage
  'nav:screen:agents': 'agentsWorkspace', // routes.view.screen('agents') → AgentsWorkspacePage
}

/** Dynamic link ids: `nav:screen:<other>` opens ExtraScreenHost (`routes.view.screen`). */
const SIDEBAR_ROUTE_PRELOAD_PREFIXES: readonly (readonly [string, RoutePageName])[] = [
  ['nav:screen:', 'extraScreens'],
]

function sidebarRoutePreload(id: string): RoutePageName | null {
  const exact = SIDEBAR_ROUTE_PRELOADS[id]
  if (exact) return exact
  for (const [prefix, page] of SIDEBAR_ROUTE_PRELOAD_PREFIXES) {
    if (id.startsWith(prefix)) return page
  }
  return null
}

interface SidebarButtonProps {
  link: LinkItem
  itemProps?: {
    tabIndex: number
    'data-focused': boolean
    ref: (el: HTMLElement | null) => void
  }
  /** True when rendering inside the DragOverlay (floating clone) */
  isOverlay?: boolean
  /** Non-navigable expandable group: this button is the disclosure. */
  groupDisclosure?: boolean
  sectionId?: string
  toggleRef?: React.Ref<HTMLButtonElement>
  onGroupToggle?: () => void
  groupAriaLabel?: string
}

// forwardRef is required so Radix's ContextMenuTrigger (asChild) can attach its ref
// and pass props like data-state="open" directly onto this button element.
const SidebarButton = React.forwardRef<HTMLButtonElement, SidebarButtonProps & React.ButtonHTMLAttributes<HTMLButtonElement>>(
  ({ link, itemProps, isOverlay, groupDisclosure, sectionId, toggleRef, onGroupToggle, groupAriaLabel, className: extraClassName, ...radixProps }, forwardedRef) => {
    // Empty buckets remain navigable, without repeating a column of zeroes.
    const badge = link.label === '0' ? undefined : link.label
    const seRail = useSuperEngineeringProfile()
    // PERF-10 (#1577): a row whose click navigates preloads the destination
    // chunk on hover/focus. Group disclosures toggle instead of navigating and
    // DragOverlay clones never activate; the preloader memoizes, so repeat
    // events are free and a failed chunk stays retryable (the route error
    // boundary owns the user-visible failure).
    const prefetchOnIntent = !isOverlay && !groupDisclosure && link.onClick
      ? () => {
          const page = sidebarRoutePreload(link.id)
          if (page) void preloadRoute(page).catch(() => {})
        }
      : undefined
    return (
      <button
        {...(isOverlay ? {} : (() => {
          // Separate ref from itemProps so we can merge it with forwardedRef
          const { ref: _itemRef, ...rest } = itemProps || { ref: undefined }
          return rest
        })())}
        // Spread Radix props (data-state, onContextMenu, onPointerDown, etc.)
        {...radixProps}
        ref={(el) => {
          // Merge forwarded ref (from Radix) and itemProps ref (for keyboard nav)
          if (typeof forwardedRef === 'function') forwardedRef(el)
          else if (forwardedRef) forwardedRef.current = el
          if (typeof toggleRef === 'function') toggleRef(el)
          else if (toggleRef) (toggleRef as React.MutableRefObject<HTMLButtonElement | null>).current = el
          if (!isOverlay && itemProps?.ref) itemProps.ref(el)
        }}
        onClick={isOverlay ? undefined : (groupDisclosure ? onGroupToggle : link.onClick)}
        onPointerEnter={prefetchOnIntent}
        onFocus={prefetchOnIntent}
        type="button"
        title={link.tooltip}
        aria-current={link.variant === 'default' && !groupDisclosure ? 'page' : undefined}
        data-tutorial={link.dataTutorial}
        data-sidebar-link-id={link.id}
        aria-expanded={link.expandable ? !!link.expanded : undefined}
        aria-controls={link.expandable ? sectionId : undefined}
        aria-label={groupAriaLabel}
        className={cn(
          "group flex min-h-7 w-full min-w-0 items-center gap-2 rounded-lg text-[13px] select-none outline-none transition-colors [@media(pointer:coarse)]:min-h-11",
          "focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring",
          // Compact mode: 4px less total height (py-[3px] vs py-[5px])
          link.compact ? "py-[3px]" : "py-[5px]",
          "px-2",
          seRail
            ? link.variant === 'default'
              ? SE_RAIL_ACTIVE_BUTTON_CLASS
              : SE_RAIL_INACTIVE_BUTTON_CLASS
            : link.variant === "default"
              ? "rox-nav-shimmer bg-[var(--shell-hover,var(--element-hover,var(--foreground-5)))]"
// Highlight on hover, context menu open (data-state), or EditPopover active (data-edit-active)
              : "hover:bg-[var(--shell-hover,var(--element-hover,var(--foreground-5)))] data-[state=open]:bg-[var(--shell-hover,var(--element-hover,var(--foreground-5)))] data-[edit-active=true]:bg-[var(--shell-hover,var(--element-hover,var(--foreground-5)))]",
          extraClassName,
        )}
      >
        {groupDisclosure && !isOverlay && (
          <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center" aria-hidden>
            <SidebarDisclosureChevron expanded={!!link.expanded} />
          </span>
        )}
        <span className="relative flex h-4 w-4 shrink-0 items-center justify-center">
          {renderIcon(link)}
        </span>
        <span className="min-w-0 truncate text-left">{link.title}</span>
        {/* After-title element: type indicator icon, right-aligned before count badge, revealed on hover */}
        {link.afterTitle && (
          <span data-touch-reveal="true" className="ml-auto opacity-100">
            {link.afterTitle}
          </span>
        )}
        {/* Unseen accent — same treatment as What's New top-bar badge. */}
        {link.hasUnseen && (
          <span
            className={cn(
              'h-1.5 w-1.5 shrink-0 rounded-full bg-accent',
              !link.afterTitle && !badge && 'ml-auto'
            )}
            aria-hidden
          />
        )}
        {/* Useful counts and nonnumeric status labels keep a stable right edge. */}
        {badge && (
          <span data-touch-reveal="true" className={cn(link.afterTitle || link.hasUnseen ? 'ml-0' : 'ml-auto', 'shrink-0 text-xs tabular-nums text-text-secondary opacity-100')}>
            {badge}
          </span>
        )}
      </button>
    )
  }
)

/**
 * Helper to render icon - either component (function/forwardRef) or React element.
 *
 * W-04: default-profile navigation/service icons share one muted chrome tone that
 * matches the inspector rail — idle `text-muted-foreground`, hovered row lifts the
 * icon to `text-foreground`, the active row tints it `text-accent`. A single 16px
 * box removes the size jump between the collapsed and expanded sidebar. Items with
 * an explicit `iconColor` (e.g. resolved session statuses) keep their inline colour.
 */
function renderIcon(link: LinkItem) {
  const isComponent = typeof link.icon === 'function' ||
    (typeof link.icon === 'object' && link.icon !== null && 'render' in link.icon)
  const seRail = typeof document !== 'undefined' && document.documentElement.dataset.uiProfile === 'super-engineering'
  // Muted idle tone, foreground on row hover and while the row is active — the
  // active state is carried by the thin animated accent sweep, not a filled
  // accent icon.
  const colorClass = link.variant === 'default'
    ? 'text-foreground'
    : 'text-muted-foreground group-hover:text-foreground'
  // Only an explicit per-item colour overrides the shared class.
  const colorStyle = link.iconColorable !== false && link.iconColor ? { color: link.iconColor } : undefined

  if (isComponent) {
    const Icon = link.icon as React.ComponentType<{ className?: string; style?: React.CSSProperties }>
    return (
      <Icon
        className={cn(seRail ? 'h-3.5 w-3.5' : 'h-4 w-4', 'shrink-0', seRail && '[&_svg]:stroke-[1.5]', !seRail && colorClass)}
        style={seRail ? undefined : colorStyle}
      />
    )
  }
  // Already a React element or primitive ReactNode
  // Clone with bare={true} to remove EntityIcon container, wrapper provides sizing
  // Only pass bare to components that accept it (have acceptsBare marker) to avoid
  // forwarding unknown props to DOM elements (e.g., Lucide icons → SVG)
  const iconElement = link.icon as React.ReactNode
  // EntityIcon advertises `acceptsBare`; the DOM/Lucide function types can't express
  // that marker, so keep the capability check on a named boundary value.
  const iconType = React.isValidElement(iconElement) ? iconElement.type : undefined
  const bareCapable = iconType as { acceptsBare?: boolean } | undefined
  const acceptsBare = typeof iconType === 'function' && bareCapable?.acceptsBare === true
  const bareIcon = React.isValidElement(iconElement) && acceptsBare
    ? React.cloneElement(iconElement as React.ReactElement<{ bare?: boolean }>, { bare: true })
    : iconElement
  return (
    <span
      className={cn('flex h-4 w-4 shrink-0 items-center justify-center [&>svg]:h-full [&>svg]:w-full', !seRail && colorClass)}
      style={seRail ? undefined : colorStyle}
    >
      {bareIcon}
    </span>
  )
}
