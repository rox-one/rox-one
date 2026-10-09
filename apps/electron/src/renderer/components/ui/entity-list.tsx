/**
 * EntityList — Reusable container for rendering a scrollable list of EntityRow items.
 *
 * Handles:
 * - ScrollArea wrapping with proper padding
 * - Optional grouped layout with section headers
 * - Collapsible groups with chevron toggle and item count
 * - Empty state rendering (centered, outside ScrollArea)
 * - Header (e.g. search bar) and footer (e.g. infinite scroll sentinel) slots
 * - Optional windowed rendering (`windowed`) for very large lists
 *
 * Domain-specific logic (filtering, keyboard nav, multi-select) lives in the consumer.
 */

import * as React from 'react'
import { ChevronRight } from 'lucide-react'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  ContextMenu,
  ContextMenuTrigger,
  StyledContextMenuContent,
  StyledContextMenuItem,
  StyledContextMenuSeparator,
} from '@/components/ui/styled-context-menu'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import {
  flattenTableGroups,
  virtualTableWindow,
  type FlattenedTableGroups,
  type VirtualTableEntry,
} from '@/components/app-shell/session-table/table-virtualization'

export function groupHeaderCount(
  isCollapsed: boolean,
  itemsLength: number,
  collapsedCount?: number,
): number {
  return isCollapsed ? (collapsedCount ?? 0) : itemsLength
}

export function selectGroupDisabled(itemCount: number): boolean {
  return itemCount === 0
}

/**
 * Windowed-mode estimates, used until a row/header has been measured.
 * Real heights replace these values through the ResizeObserver feedback loop.
 */
export const ENTITY_LIST_ROW_ESTIMATE = 46
export const ENTITY_LIST_HEADER_ESTIMATE = 33
export const ENTITY_LIST_EMPTY_LANE_ESTIMATE = 40
/** Vertical overscan (px) kept rendered above/below the viewport. */
export const ENTITY_LIST_OVERSCAN = 480
/** Bottom margin of the empty-group drop lane (Tailwind `mb-2`), outside borderBoxSize. */
const EMPTY_LANE_BOTTOM_MARGIN = 8

// ============================================================================
// Types
// ============================================================================

export interface EntityListGroup<T> {
  /** Unique key for the group */
  key: string
  /** Label shown in the section header */
  label: string
  /** Items in this group (empty array for collapsed groups — items are excluded from the data pipeline) */
  items: T[]
  /** Whether this group supports collapse/expand (default: false) */
  collapsible?: boolean
  /** Number of hidden items when collapsed. Present on collapsed placeholder groups (items will be []). */
  collapsedCount?: number
}

export interface EntityListProps<T> {
  /** Flat item list (used when not grouped) */
  items?: T[]
  /** Grouped items with section headers (takes precedence over items) */
  groups?: EntityListGroup<T>[]
  /** Render function for each item */
  renderItem: (item: T, index: number, isFirstInGroup: boolean) => React.ReactNode
  /** Unique key extractor */
  getKey: (item: T) => string
  /** Empty state content — rendered centered, outside ScrollArea */
  emptyState?: React.ReactNode
  /** Header content above the list (e.g. search bar) — rendered outside ScrollArea */
  header?: React.ReactNode
  /** Footer content after all items (e.g. infinite scroll sentinel) — inside ScrollArea */
  footer?: React.ReactNode
  /** Ref for the inner list container (for keyboard navigation zones) */
  containerRef?: React.Ref<HTMLDivElement>
  /** Props spread on the inner list container (role, aria-label, data-focus-zone, drag handlers) */
  containerProps?: Record<string, unknown>
  /** Ref to the ScrollArea viewport element (for scroll-based pagination/windowing) */
  viewportRef?: React.RefObject<HTMLDivElement>
  /** Additional ScrollArea class */
  scrollAreaClassName?: string
  className?: string
  /**
   * Explicit empty/error/loading/ready contract for the list root. Defaults to
   * `empty` when there is no content and `ready` otherwise, so the three state
   * shells stay distinguishable via `[data-state]`.
   */
  state?: 'empty' | 'loading' | 'error' | 'ready'
  /** Set of collapsed group keys (for collapsible groups) */
  collapsedGroups?: Set<string>
  /** Called when a collapsible group header is clicked */
  onToggleCollapse?: (groupKey: string) => void
  /** Collapse all collapsible groups */
  onCollapseAll?: () => void
  /** Expand all collapsible groups */
  onExpandAll?: () => void
  /** Select every currently loaded item in this group */
  onSelectGroup?: (groupKey: string) => void
  /** Highlighted empty-group drop lane */
  dropGroupKey?: string | null
  /** Drag over an empty expanded group (drop lane) */
  onEmptyGroupDragOver?: (groupKey: string, event: React.DragEvent) => void
  /**
   * OPT-IN windowing. When true, only the entries intersecting the viewport
   * (plus overscan) are mounted; the rest is a spacer of `totalHeight`.
   * Default (false) keeps the previous full-render behaviour byte-identical.
   */
  windowed?: boolean
  /** Estimated row height (px) before the row has been measured. */
  windowRowHeight?: number
  /** Estimated group-header height (px) before the header has been measured. */
  windowHeaderHeight?: number
  /** Estimated empty-group drop-lane height (px) before it has been measured. */
  windowEmptyLaneHeight?: number
  /** Vertical overscan (px) rendered above/below the viewport. */
  windowOverscan?: number
  /**
   * Windowed scroll anchor: item key to reveal when it is outside the current
   * window. Consumers pass the active/selected id so keyboard nav and external
   * selection keep the row mounted and focusable.
   */
  scrollToKey?: string | null
}

export interface EntityListFlattenOptions<T> {
  getItemKey: (item: T) => string
  rowHeight: number
  headerHeight: number
  emptyLaneHeight?: number
  /** entry key (`row:<id>`) → measured pixel height, fed back from the DOM. */
  measuredRowHeights?: ReadonlyMap<string, number>
}

/**
 * Pure windowing kernel for EntityList: flattens groups (or a flat list) into
 * positioned entries at estimated/measured heights. Reuses the session-table
 * kernel (`flattenTableGroups`) so binary-search offsets and overscan match.
 */
export function flattenEntityListGroups<T>(
  groups: EntityListGroup<T>[] | undefined,
  items: T[] | undefined,
  collapsed: ReadonlySet<string>,
  options: EntityListFlattenOptions<T>,
): FlattenedTableGroups<T, EntityListGroup<T>> {
  const getRowHeight = options.measuredRowHeights
    ? (item: T) =>
        options.measuredRowHeights!.get(`row:${options.getItemKey(item)}`) ?? options.rowHeight
    : undefined

  if (groups && groups.length > 0) {
    return flattenTableGroups<T, EntityListGroup<T>>(
      groups.map((group) => ({ bucket: group, items: group.items })),
      collapsed,
      {
        getItemKey: options.getItemKey,
        rowHeight: options.rowHeight,
        headerHeight: options.headerHeight,
        ...(options.emptyLaneHeight != null ? { emptyLaneHeight: options.emptyLaneHeight } : {}),
        ...(getRowHeight ? { getRowHeight } : {}),
      },
    )
  }

  return flattenTableGroups<T, EntityListGroup<T>>([{ bucket: null, items: items ?? [] }], collapsed, {
    getItemKey: options.getItemKey,
    rowHeight: options.rowHeight,
    headerHeight: 0,
    ...(getRowHeight ? { getRowHeight } : {}),
  })
}

// ============================================================================
// Section Header
// ============================================================================

function SectionHeader({
  label,
  itemCount,
  onSelectGroup,
  elementRef,
  style,
}: {
  label: string
  itemCount: number
  onSelectGroup?: () => void
  elementRef?: React.Ref<HTMLDivElement>
  style?: React.CSSProperties
}) {
  const { t } = useTranslation()
  return (
    <ContextMenu modal>
      <ContextMenuTrigger asChild>
        <div ref={elementRef} style={style} className="sticky top-0 z-10 bg-background px-5 py-2">
          <span className="text-[11px] font-medium text-text-secondary uppercase tracking-wider">
            {label} <> · <span className="text-muted-foreground/50">{itemCount}</span></>
          </span>
        </div>
      </ContextMenuTrigger>
      {onSelectGroup ? (
        <StyledContextMenuContent>
          <StyledContextMenuItem disabled={selectGroupDisabled(itemCount)} onClick={onSelectGroup}>
            {t('entityList.selectGroup')}
          </StyledContextMenuItem>
        </StyledContextMenuContent>
      ) : null}
    </ContextMenu>
  )
}

/** Collapsible group header with chevron toggle and item count */
function CollapsibleGroupHeader({
  label,
  isCollapsed,
  itemCount,
  onToggle,
  onCollapseAll,
  onExpandAll,
  onSelectGroup,
  elementRef,
  style,
}: {
  label: string
  isCollapsed: boolean
  itemCount: number
  onToggle: () => void
  onCollapseAll?: () => void
  onExpandAll?: () => void
  onSelectGroup?: () => void
  elementRef?: React.Ref<HTMLButtonElement>
  style?: React.CSSProperties
}) {
  const { t } = useTranslation()
  return (
    <ContextMenu modal>
      <ContextMenuTrigger asChild>
        <button
          ref={elementRef}
          style={style}
          onClick={onToggle}
          className="sticky top-0 z-10 flex w-full cursor-pointer items-center gap-1.5 bg-background px-5 py-2 group/header relative"
        >
          <div className="absolute inset-y-0.5 left-2 right-2 rounded-[var(--radius-card)] group-hover/header:bg-foreground/2 transition-colors duration-[var(--motion-fast)] pointer-events-none" />
          <ChevronRight
            className={cn(
              "h-3 w-3 text-muted-foreground/60 transition-transform duration-[var(--motion-fast)] relative",
              !isCollapsed && "rotate-90"
            )}
          />
          <span className="text-[11px] font-medium uppercase tracking-wider text-text-secondary relative">
            {label} <> · <span className="text-muted-foreground/50">{itemCount}</span></>
          </span>
        </button>
      </ContextMenuTrigger>
      <StyledContextMenuContent>
        <StyledContextMenuItem onClick={onToggle}>
          {isCollapsed ? t('entityList.expand') : t('entityList.collapse')}
        </StyledContextMenuItem>
        {onSelectGroup ? (
          <StyledContextMenuItem disabled={selectGroupDisabled(itemCount)} onClick={onSelectGroup}>
            {t('entityList.selectGroup')}
          </StyledContextMenuItem>
        ) : null}
        <StyledContextMenuSeparator />
        <StyledContextMenuItem onClick={onCollapseAll}>
          {t('entityList.collapseAll')}
        </StyledContextMenuItem>
        <StyledContextMenuItem onClick={onExpandAll}>
          {t('entityList.expandAll')}
        </StyledContextMenuItem>
      </StyledContextMenuContent>
    </ContextMenu>
  )
}

// ============================================================================
// Component
// ============================================================================

/**
 * The windowed slice plus the active/selected row when it lies outside it. The active row must
 * stay mounted: keyboard navigation focuses its DOM node (unmounted rows lose their ref), so
 * dropping it would make arrow nav silently dead until the user clicks a mounted row again.
 */
export function withMountedAnchor<T, G extends { key: string }>(
  slice: readonly VirtualTableEntry<T, G>[],
  all: readonly VirtualTableEntry<T, G>[],
  anchorKey: string | null,
): readonly VirtualTableEntry<T, G>[] {
  if (!anchorKey || slice.some((entry) => entry.key === anchorKey)) return slice
  const anchor = all.find((entry) => entry.key === anchorKey)
  return anchor ? [...slice, anchor] : slice
}

export function EntityList<T>({
  items,
  groups,
  renderItem,
  getKey,
  emptyState,
  header,
  footer,
  containerRef,
  containerProps,
  viewportRef,
  scrollAreaClassName,
  className,
  state,
  collapsedGroups,
  onToggleCollapse,
  onCollapseAll,
  onExpandAll,
  onSelectGroup,
  dropGroupKey,
  onEmptyGroupDragOver,
  windowed = false,
  windowRowHeight,
  windowHeaderHeight,
  windowEmptyLaneHeight,
  windowOverscan,
  scrollToKey,
}: EntityListProps<T>) {
  const { t } = useTranslation()
  // Determine if we have content
  const hasGroups = groups && groups.length > 0
  const hasItems = items && items.length > 0
  const isEmpty = !hasGroups && !hasItems
  const resolvedState = state ?? (isEmpty ? 'empty' : 'ready')

  const windowedEnabled = windowed === true
  const internalViewportRef = React.useRef<HTMLDivElement | null>(null)
  const activeViewportRef = viewportRef ?? internalViewportRef
  const listRef = React.useRef<HTMLDivElement | null>(null)

  const [scrollTop, setScrollTop] = React.useState(0)
  const [viewportHeight, setViewportHeight] = React.useState(0)
  const [listOffsetTop, setListOffsetTop] = React.useState(0)
  const [measuredRowHeights, setMeasuredRowHeights] = React.useState<ReadonlyMap<string, number>>(
    () => new Map(),
  )
  const [measuredHeaderHeight, setMeasuredHeaderHeight] = React.useState<number | null>(null)
  const [measuredEmptyLaneHeight, setMeasuredEmptyLaneHeight] = React.useState<number | null>(null)

  // --- Variable-height measurement (ResizeObserver → measured heights) ---
  const observerRef = React.useRef<ResizeObserver | null>(null)
  const observedRef = React.useRef(new Map<Element, { key: string; kind: 'row' | 'header' | 'empty' }>())

  React.useEffect(() => {
    if (!windowedEnabled || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver((entries) => {
      const rowUpdates: Array<[string, number]> = []
      let nextHeader: number | null = null
      let nextEmpty: number | null = null
      for (const entry of entries) {
        const info = observedRef.current.get(entry.target)
        if (!info) continue
        const box = entry.borderBoxSize?.[0]
        const raw = box ? box.blockSize : entry.contentRect.height
        const height = Math.ceil(raw)
        if (height <= 0) continue
        if (info.kind === 'row') rowUpdates.push([info.key, height])
        else if (info.kind === 'header') nextHeader = height
        else nextEmpty = height
      }
      if (rowUpdates.length > 0) {
        setMeasuredRowHeights((previous) => {
          let next: Map<string, number> | null = null
          for (const [key, height] of rowUpdates) {
            if (previous.get(key) === height) continue
            next ??= new Map(previous)
            next.set(key, height)
          }
          return next ?? previous
        })
      }
      if (nextHeader != null) setMeasuredHeaderHeight((prev) => (prev === nextHeader ? prev : nextHeader))
      if (nextEmpty != null) {
        const withMargin = nextEmpty + EMPTY_LANE_BOTTOM_MARGIN
        setMeasuredEmptyLaneHeight((prev) => (prev === withMargin ? prev : withMargin))
      }
    })
    observerRef.current = observer
    for (const element of observedRef.current.keys()) observer.observe(element)
    return () => {
      observer.disconnect()
      observerRef.current = null
    }
  }, [windowedEnabled])

  // Stable ref callback per entry key (no observe/unobserve churn per render).
  const refCallbacks = React.useRef(new Map<string, (element: HTMLElement | null) => void>())
  const measureRef = React.useCallback((key: string, kind: 'row' | 'header' | 'empty') => {
    let callback = refCallbacks.current.get(key)
    if (!callback) {
      let current: HTMLElement | null = null
      callback = (element: HTMLElement | null) => {
        if (current && current !== element) {
          observerRef.current?.unobserve(current)
          observedRef.current.delete(current)
        }
        current = element
        if (element) {
          observedRef.current.set(element, { key, kind })
          observerRef.current?.observe(element)
        }
      }
      refCallbacks.current.set(key, callback)
    }
    return callback
  }, [])

  // --- Scroll / size tracking on the ScrollArea viewport ---
  React.useEffect(() => {
    if (!windowedEnabled) return
    const viewport = activeViewportRef.current
    if (!viewport) return
    const syncScroll = () => setScrollTop(viewport.scrollTop)
    const syncSize = () => setViewportHeight(viewport.clientHeight)
    syncScroll()
    syncSize()
    viewport.addEventListener('scroll', syncScroll, { passive: true })
    let observer: ResizeObserver | null = null
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(syncSize)
      observer.observe(viewport)
    }
    return () => {
      viewport.removeEventListener('scroll', syncScroll)
      observer?.disconnect()
    }
  }, [windowedEnabled, viewportRef, isEmpty])

  // Collapsed set restricted to collapsible groups, matching the non-windowed
  // `group.collapsible && collapsedGroups?.has(group.key)` check exactly.
  const windowCollapsedKeys = React.useMemo(() => {
    const set = new Set<string>()
    if (!hasGroups) return set
    for (const group of groups!) {
      if (group.collapsible && collapsedGroups?.has(group.key)) set.add(group.key)
    }
    return set
  }, [groups, hasGroups, collapsedGroups])

  const rowHeightEstimate = windowRowHeight ?? ENTITY_LIST_ROW_ESTIMATE
  const headerHeightEstimate =
    measuredHeaderHeight ?? windowHeaderHeight ?? ENTITY_LIST_HEADER_ESTIMATE
  const emptyLaneHeightEstimate =
    measuredEmptyLaneHeight ?? windowEmptyLaneHeight ?? ENTITY_LIST_EMPTY_LANE_ESTIMATE

  const flattened = React.useMemo<FlattenedTableGroups<T, EntityListGroup<T>>>(() => {
    if (!windowedEnabled) {
      return { entries: [] as VirtualTableEntry<T, EntityListGroup<T>>[], totalHeight: 0 }
    }
    return flattenEntityListGroups(groups, items, windowCollapsedKeys, {
      getItemKey: getKey,
      rowHeight: rowHeightEstimate,
      headerHeight: headerHeightEstimate,
      emptyLaneHeight: emptyLaneHeightEstimate,
      measuredRowHeights,
    })
  }, [
    windowedEnabled,
    groups,
    items,
    windowCollapsedKeys,
    getKey,
    rowHeightEstimate,
    headerHeightEstimate,
    emptyLaneHeightEstimate,
    measuredRowHeights,
  ])

  const over = windowOverscan ?? ENTITY_LIST_OVERSCAN
  const windowRange = React.useMemo(
    () =>
      windowedEnabled
        ? virtualTableWindow(flattened.entries, scrollTop - listOffsetTop, viewportHeight, over)
        : { startIndex: 0, endIndex: 0 },
    [windowedEnabled, flattened, scrollTop, listOffsetTop, viewportHeight, over],
  )
  // A window in the middle of a group must still mount that group's header,
  // otherwise its sticky header would unmount while the group is on screen.
  // The covering header is rendered as a single extra entry — never by
  // widening the slice, which would re-mount every skipped row.
  const headerIndexes = React.useMemo(() => {
    const indexes: number[] = []
    flattened.entries.forEach((entry, index) => {
      if (entry.kind === 'header') indexes.push(index)
    })
    return indexes
  }, [flattened])

  let coveringHeaderIndex: number | null = null
  if (windowedEnabled && flattened.entries[windowRange.startIndex]?.kind !== 'header') {
    const start = windowRange.startIndex
    let low = 0
    let high = headerIndexes.length
    while (low < high) {
      const middle = (low + high) >> 1
      if (headerIndexes[middle]! < start) low = middle + 1
      else high = middle
    }
    if (low > 0) coveringHeaderIndex = headerIndexes[low - 1]!
  }
  const slice =
    coveringHeaderIndex != null
      ? [flattened.entries[coveringHeaderIndex]!, ...flattened.entries.slice(windowRange.startIndex, windowRange.endIndex)]
      : flattened.entries.slice(windowRange.startIndex, windowRange.endIndex)
  const visibleEntries = windowedEnabled
    ? withMountedAnchor(slice, flattened.entries, scrollToKey ? `row:${scrollToKey}` : null)
    : []

  // Per-row index/isFirstInGroup, so `renderItem` receives the same arguments
  // as the non-windowed branches.
  const rowMetaByKey = React.useMemo(() => {
    const map = new Map<string, { index: number; isFirst: boolean }>()
    if (hasGroups) {
      for (const group of groups!) {
        group.items.forEach((item, index) =>
          map.set(`row:${getKey(item)}`, { index, isFirst: index === 0 }),
        )
      }
    } else {
      ;(items ?? []).forEach((item, index) =>
        map.set(`row:${getKey(item)}`, { index, isFirst: index === 0 }),
      )
    }
    return map
  }, [groups, hasGroups, items, getKey])

  // A header's abspos slot spans its whole group so the sticky header keeps
  // sticking until the next group (exactly like the non-windowed layout).
  const groupEndByHeaderKey = React.useMemo(() => {
    const map = new Map<string, number>()
    let lastHeaderKey: string | null = null
    for (const entry of flattened.entries) {
      if (entry.kind !== 'header') continue
      if (lastHeaderKey !== null) map.set(lastHeaderKey, entry.offset)
      lastHeaderKey = entry.key
    }
    if (lastHeaderKey !== null) map.set(lastHeaderKey, flattened.totalHeight)
    return map
  }, [flattened])

  // Keep list offset in sync with the scroll parent (padding/margin/measurement).
  React.useLayoutEffect(() => {
    if (!windowedEnabled) return
    const list = listRef.current
    const viewport = activeViewportRef.current
    if (!list || !viewport) return
    const next =
      list.getBoundingClientRect().top - viewport.getBoundingClientRect().top + viewport.scrollTop
    setListOffsetTop((previous) => (previous === next ? previous : next))
  }, [windowedEnabled, scrollTop, viewportHeight, flattened.totalHeight])

  // Reveal an off-window anchor (selected/active row) — only on key change so
  // user scrolling is never fought. Runs in a layout effect so the newly
  // revealed row is mounted (and ref-registered) before the roving-tabindex
  // `requestAnimationFrame` focus callback fires.
  const lastScrollToKeyRef = React.useRef<string | null>(null)
  React.useLayoutEffect(() => {
    if (!windowedEnabled) return
    if (!scrollToKey) {
      lastScrollToKeyRef.current = null
      return
    }
    if (lastScrollToKeyRef.current === scrollToKey) return
    if (viewportHeight <= 0) return
    lastScrollToKeyRef.current = scrollToKey
    const viewport = activeViewportRef.current
    if (!viewport) return
    const entry = flattened.entries.find(
      (candidate) => candidate.kind === 'row' && candidate.key === `row:${scrollToKey}`,
    )
    if (!entry) return
    const entryTop = listOffsetTop + entry.offset
    const entryBottom = entryTop + entry.height
    if (entryTop >= scrollTop && entryBottom <= scrollTop + viewportHeight) return
    const next = Math.max(0, entryTop - viewportHeight / 3)
    viewport.scrollTop = next
    setScrollTop(next)
  }, [windowedEnabled, scrollToKey, flattened, listOffsetTop, scrollTop, viewportHeight])

  // Dashed placeholder for an empty group; highlights while it is the active drop target.
  const renderEmptyLane = (groupKey: string) => (
    <div
      data-empty-group={groupKey}
      className={cn(
        'mx-3 mb-2 rounded-[var(--radius-card)] border border-dashed px-3 py-2 text-caption text-muted-foreground',
        dropGroupKey === groupKey
          ? 'border-foreground/40 bg-foreground/5 text-foreground/80'
          : 'border-foreground/[0.07]',
      )}
      onDragOver={(event) => onEmptyGroupDragOver?.(groupKey, event)}
    >
      {t('entityList.emptyGroupDrop')}
    </div>
  )

  const renderWindowedEntry = (entry: VirtualTableEntry<T, EntityListGroup<T>>) => {
    const baseStyle: React.CSSProperties = {
      position: 'absolute',
      left: 0,
      right: 0,
      top: entry.offset,
    }

    if (entry.kind === 'header') {
      const group = entry.bucket
      const isCollapsed = group.collapsible === true && windowCollapsedKeys.has(group.key)
      const groupEnd = groupEndByHeaderKey.get(entry.key) ?? flattened.totalHeight
      return (
        <div
          key={entry.key}
          data-windowed-header={group.key}
          style={{
            ...baseStyle,
            height: Math.max(entry.height, groupEnd - entry.offset),
            pointerEvents: 'none',
          }}
        >
          {group.collapsible && onToggleCollapse ? (
            <CollapsibleGroupHeader
              label={group.label}
              isCollapsed={isCollapsed}
              itemCount={groupHeaderCount(isCollapsed, group.items.length, group.collapsedCount)}
              onToggle={() => onToggleCollapse(group.key)}
              onCollapseAll={onCollapseAll}
              onExpandAll={onExpandAll}
              onSelectGroup={onSelectGroup ? () => onSelectGroup(group.key) : undefined}
              elementRef={measureRef(entry.key, 'header')}
              style={{ pointerEvents: 'auto' }}
            />
          ) : (
            <SectionHeader
              label={group.label}
              itemCount={group.items.length}
              onSelectGroup={onSelectGroup ? () => onSelectGroup(group.key) : undefined}
              elementRef={measureRef(entry.key, 'header')}
              style={{ pointerEvents: 'auto' }}
            />
          )}
        </div>
      )
    }

    if (entry.kind === 'empty') {
      const group = entry.bucket
      return (
        <div key={entry.key} style={baseStyle}>
          <div ref={measureRef(entry.key, 'empty')}>{renderEmptyLane(group.key)}</div>
        </div>
      )
    }

    const meta = rowMetaByKey.get(entry.key)
    return (
      <div key={entry.key} style={baseStyle}>
        <div ref={measureRef(entry.key, 'row')}>
          {renderItem(entry.item, meta?.index ?? 0, meta?.isFirst ?? false)}
        </div>
      </div>
    )
  }

  // Empty state — rendered outside everything for proper centering
  if (isEmpty && emptyState) {
    return (
      <div className={cn('flex flex-col flex-1 min-h-0', className)} data-state={resolvedState}>
        {header}
        {emptyState}
      </div>
    )
  }

  return (
    <div className={cn('flex flex-col flex-1 min-h-0', className)} data-state={resolvedState}>
      {header}
      <ScrollArea
        className={cn('flex-1', scrollAreaClassName)}
        viewportRef={windowedEnabled ? activeViewportRef : viewportRef}
      >
        <div
          ref={containerRef}
          className="flex flex-col pb-2"
          {...containerProps}
        >
          {windowedEnabled ? (
            <div ref={listRef} className="relative mt-1" style={{ height: flattened.totalHeight }}>
              {visibleEntries.map(renderWindowedEntry)}
            </div>
          ) : (
            <div className="pt-1">
              {hasGroups
                ? groups!.map((group) => {
                    const isCollapsed = group.collapsible && collapsedGroups?.has(group.key)

                    return (
                      <div key={group.key}>
                        {group.collapsible && onToggleCollapse ? (
                          <CollapsibleGroupHeader
                            label={group.label}
                            isCollapsed={!!isCollapsed}
                            itemCount={groupHeaderCount(!!isCollapsed, group.items.length, group.collapsedCount)}
                            onToggle={() => onToggleCollapse(group.key)}
                            onCollapseAll={onCollapseAll}
                            onExpandAll={onExpandAll}
                            onSelectGroup={onSelectGroup ? () => onSelectGroup(group.key) : undefined}
                          />
                        ) : (
                          <SectionHeader
                            label={group.label}
                            itemCount={group.items.length}
                            onSelectGroup={onSelectGroup ? () => onSelectGroup(group.key) : undefined}
                          />
                        )}
                        {!isCollapsed && group.items.length === 0 ? renderEmptyLane(group.key) : null}
                        {group.items.map((item, indexInGroup) =>
                          <React.Fragment key={getKey(item)}>
                            {renderItem(item, indexInGroup, indexInGroup === 0)}
                          </React.Fragment>
                        )}
                      </div>
                    )
                  })
                : items?.map((item, index) =>
                    <React.Fragment key={getKey(item)}>
                      {renderItem(item, index, index === 0)}
                    </React.Fragment>
                  )
              }
            </div>
          )}
          {footer}
        </div>
      </ScrollArea>
    </div>
  )
}

// ============================================================================
// WindowedTreeList — opt-in windowing for flattened trees
// ============================================================================

/** Estimated row height for {@link WindowedTreeList} before a row is measured. */
export const WINDOWED_TREE_ROW_ESTIMATE = 40
/** Lists at or below this size render every row (no absolute wrappers). */
export const WINDOWED_TREE_DEFAULT_THRESHOLD = 200

export interface WindowedTreeListProps<T> {
  /** Flattened rows in render order (expanded nodes only). */
  rows: T[]
  /** Stable key per row. */
  getKey: (row: T) => string
  /** Renders one row (the component wraps it and measures its height). */
  renderRow: (row: T) => React.ReactNode
  /**
   * Scroll parent. Windowed rendering activates only when this is provided —
   * callers that cannot supply a viewport keep the plain full render.
   */
  viewportRef?: React.RefObject<HTMLDivElement | null>
  /** Lists at or below this size render every row. */
  windowThreshold?: number
  /** Estimated row height (px) before the row has been measured. */
  rowHeight?: number
  /** Vertical overscan (px) rendered above/below the viewport. */
  overscan?: number
  className?: string
  containerRef?: React.Ref<HTMLDivElement>
  containerProps?: Record<string, unknown>
  /** Row key to reveal when it is outside the current window (active row). */
  scrollToKey?: string | null
}

/**
 * Opt-in windowing for pre-flattened trees (notes vault, knowledge notebooks).
 *
 * Same mechanism as `EntityList`'s `windowed` mode: `flattenEntityListGroups` +
 * `virtualTableWindow` position only the rows intersecting the viewport (plus
 * overscan); a ResizeObserver feeds measured heights back into the kernel.
 *
 * Keyboard navigation is model-driven here — ArrowUp/Down/Home/End move across
 * ALL rows, revealing and focusing an off-window row instead of stopping at the
 * mounted edge. Only those four keys are intercepted, so the shared
 * `handleSidebarTreeKeyDown` (expand/collapse, sidebar sections) still runs.
 */
export function WindowedTreeList<T>({
  rows,
  getKey,
  renderRow,
  viewportRef,
  windowThreshold = WINDOWED_TREE_DEFAULT_THRESHOLD,
  rowHeight,
  overscan,
  className,
  containerRef,
  containerProps,
  scrollToKey,
}: WindowedTreeListProps<T>): React.ReactElement {
  const windowedEnabled = viewportRef != null && rows.length > windowThreshold
  const estimate = rowHeight ?? WINDOWED_TREE_ROW_ESTIMATE
  const over = overscan ?? ENTITY_LIST_OVERSCAN

  const listRef = React.useRef<HTMLDivElement | null>(null)
  const [scrollTop, setScrollTop] = React.useState(0)
  const [viewportHeight, setViewportHeight] = React.useState(0)
  const [listOffsetTop, setListOffsetTop] = React.useState(0)
  const [measuredHeights, setMeasuredHeights] = React.useState<ReadonlyMap<string, number>>(
    () => new Map(),
  )
  const [pendingFocusKey, setPendingFocusKey] = React.useState<string | null>(null)

  // --- Variable-height measurement (ResizeObserver → measured heights) ---
  const observerRef = React.useRef<ResizeObserver | null>(null)
  const observedRef = React.useRef(new Map<Element, string>())
  React.useEffect(() => {
    if (!windowedEnabled || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver((entries) => {
      const updates: Array<[string, number]> = []
      for (const entry of entries) {
        const key = observedRef.current.get(entry.target)
        if (!key) continue
        const box = entry.borderBoxSize?.[0]
        const height = Math.ceil(box ? box.blockSize : entry.contentRect.height)
        if (height > 0) updates.push([key, height])
      }
      if (updates.length === 0) return
      setMeasuredHeights((previous) => {
        let next: Map<string, number> | null = null
        for (const [key, height] of updates) {
          if (previous.get(key) === height) continue
          next ??= new Map(previous)
          next.set(key, height)
        }
        return next ?? previous
      })
    })
    observerRef.current = observer
    for (const element of observedRef.current.keys()) observer.observe(element)
    return () => {
      observer.disconnect()
      observerRef.current = null
    }
  }, [windowedEnabled])

  const measureCallbacks = React.useRef(new Map<string, (element: HTMLElement | null) => void>())
  const measureRef = React.useCallback((key: string) => {
    let callback = measureCallbacks.current.get(key)
    if (!callback) {
      let current: HTMLElement | null = null
      callback = (element: HTMLElement | null) => {
        if (current && current !== element) {
          observerRef.current?.unobserve(current)
          observedRef.current.delete(current)
        }
        current = element
        if (element) {
          observedRef.current.set(element, key)
          observerRef.current?.observe(element)
        }
      }
      measureCallbacks.current.set(key, callback)
    }
    return callback
  }, [])

  const rowElements = React.useRef(new Map<string, HTMLElement>())
  const rowCallbacks = React.useRef(new Map<string, (element: HTMLElement | null) => void>())
  const rowRef = React.useCallback((key: string) => {
    let callback = rowCallbacks.current.get(key)
    if (!callback) {
      callback = (element: HTMLElement | null) => {
        if (element) rowElements.current.set(key, element)
        else rowElements.current.delete(key)
      }
      rowCallbacks.current.set(key, callback)
    }
    return callback
  }, [])

  // --- Scroll / size tracking on the scroll parent ---
  React.useEffect(() => {
    if (!windowedEnabled) return
    const viewport = viewportRef?.current
    if (!viewport) return
    const syncScroll = () => setScrollTop(viewport.scrollTop)
    const syncSize = () => setViewportHeight(viewport.clientHeight)
    syncScroll()
    syncSize()
    viewport.addEventListener('scroll', syncScroll, { passive: true })
    let observer: ResizeObserver | null = null
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(syncSize)
      observer.observe(viewport)
    }
    return () => {
      viewport.removeEventListener('scroll', syncScroll)
      observer?.disconnect()
    }
  }, [windowedEnabled, viewportRef, rows.length])

  const flattened = React.useMemo<FlattenedTableGroups<T, EntityListGroup<T>>>(() => {
    if (!windowedEnabled) {
      return { entries: [] as VirtualTableEntry<T, EntityListGroup<T>>[], totalHeight: 0 }
    }
    return flattenEntityListGroups<T>(undefined, rows, new Set<string>(), {
      getItemKey: getKey,
      rowHeight: estimate,
      headerHeight: 0,
      measuredRowHeights: measuredHeights,
    })
  }, [windowedEnabled, rows, getKey, estimate, measuredHeights])

  const windowRange = React.useMemo(
    () =>
      windowedEnabled
        ? virtualTableWindow(flattened.entries, scrollTop - listOffsetTop, viewportHeight, over)
        : { startIndex: 0, endIndex: 0 },
    [windowedEnabled, flattened, scrollTop, listOffsetTop, viewportHeight, over],
  )

  const visibleEntries = windowedEnabled
    ? withMountedAnchor(
        flattened.entries.slice(windowRange.startIndex, windowRange.endIndex),
        flattened.entries,
        scrollToKey ? `row:${scrollToKey}` : null,
      )
    : []

  // Keep the list offset in sync with the scroll parent (padding/measurement).
  React.useLayoutEffect(() => {
    if (!windowedEnabled) return
    const list = listRef.current
    const viewport = viewportRef?.current
    if (!list || !viewport) return
    const next =
      list.getBoundingClientRect().top - viewport.getBoundingClientRect().top + viewport.scrollTop
    setListOffsetTop((previous) => (previous === next ? previous : next))
  }, [windowedEnabled, scrollTop, viewportHeight, flattened.totalHeight, viewportRef])

  const revealKey = React.useCallback(
    (key: string) => {
      const viewport = viewportRef?.current
      const entry = flattened.entries.find(
        (candidate) => candidate.kind === 'row' && candidate.key === `row:${key}`,
      )
      if (viewport && entry && viewportHeight > 0) {
        const entryTop = listOffsetTop + entry.offset
        if (entryTop < scrollTop || entryTop + entry.height > scrollTop + viewportHeight) {
          const next = Math.max(0, entryTop - viewportHeight / 3)
          viewport.scrollTop = next
          setScrollTop(next)
        }
      }
      setPendingFocusKey(key)
    },
    [viewportRef, flattened, listOffsetTop, scrollTop, viewportHeight],
  )

  const handleKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.metaKey || event.ctrlKey || event.altKey || event.defaultPrevented) return
      const target = event.target as HTMLElement
      if (target.closest('input, textarea, select, [contenteditable="true"]')) return
      if (
        event.key !== 'ArrowDown' &&
        event.key !== 'ArrowUp' &&
        event.key !== 'Home' &&
        event.key !== 'End'
      ) {
        return
      }
      const currentKey = target.closest<HTMLElement>('[data-windowed-tree-row]')?.dataset
        .windowedTreeRow
      if (currentKey === undefined) return
      const keys = rows.map(getKey)
      const index = keys.indexOf(currentKey)
      if (index < 0) return
      event.preventDefault()
      event.stopPropagation()
      const nextIndex =
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? keys.length - 1
            : event.key === 'ArrowDown'
              ? (index + 1) % keys.length
              : (index - 1 + keys.length) % keys.length
      revealKey(keys[nextIndex]!)
    },
    [rows, getKey, revealKey],
  )

  // Reveal an off-window anchor (active/selected row) — only on key change so
  // user scrolling is never fought.
  const lastScrollToKeyRef = React.useRef<string | null>(null)
  React.useLayoutEffect(() => {
    if (!windowedEnabled) return
    if (!scrollToKey) {
      lastScrollToKeyRef.current = null
      return
    }
    if (lastScrollToKeyRef.current === scrollToKey) return
    if (viewportHeight <= 0) return
    lastScrollToKeyRef.current = scrollToKey
    const viewport = viewportRef?.current
    if (!viewport) return
    const entry = flattened.entries.find(
      (candidate) => candidate.kind === 'row' && candidate.key === `row:${scrollToKey}`,
    )
    if (!entry) return
    const entryTop = listOffsetTop + entry.offset
    if (entryTop >= scrollTop && entryTop + entry.height <= scrollTop + viewportHeight) return
    const next = Math.max(0, entryTop - viewportHeight / 3)
    viewport.scrollTop = next
    setScrollTop(next)
  }, [windowedEnabled, scrollToKey, flattened, listOffsetTop, scrollTop, viewportHeight, viewportRef])

  // Focus the pending row once the reveal has mounted it.
  React.useLayoutEffect(() => {
    if (!pendingFocusKey) return
    const element = rowElements.current.get(pendingFocusKey)
    if (!element) return
    const focusable =
      element.querySelector<HTMLElement>('button, summary, a[href], [tabindex]') ?? element
    focusable.focus()
    setPendingFocusKey(null)
  })

  if (!windowedEnabled) {
    return (
      <div ref={containerRef} className={className} {...containerProps}>
        {rows.map((row) => (
          <React.Fragment key={getKey(row)}>{renderRow(row)}</React.Fragment>
        ))}
      </div>
    )
  }

  return (
    <div ref={containerRef} className={className} onKeyDown={handleKeyDown} {...containerProps}>
      <div ref={listRef} className="relative" style={{ height: flattened.totalHeight }}>
        {visibleEntries.map((entry) => {
          if (entry.kind !== 'row') return null
          const key = getKey(entry.item)
          return (
            <div
              key={entry.key}
              ref={rowRef(key)}
              data-windowed-tree-row={key}
              style={{ position: 'absolute', left: 0, right: 0, top: entry.offset }}
            >
              <div ref={measureRef(entry.key)}>{renderRow(entry.item)}</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}