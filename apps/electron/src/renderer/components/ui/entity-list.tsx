/**
 * EntityList — Reusable container for rendering a scrollable list of EntityRow items.
 *
 * Handles:
 * - ScrollArea wrapping with proper padding
 * - Optional grouped layout with section headers
 * - Collapsible groups with chevron toggle and item count
 * - Empty state rendering (centered, outside ScrollArea)
 * - Header (e.g. search bar) and footer (e.g. infinite scroll sentinel) slots
 * - Opt-in windowing (`virtualize`) so large collections mount only the rows
 *   near the scrollport while keeping the active/selected row available.
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
  ENTITY_LIST_DEFAULT_ROW_HEIGHT,
  ENTITY_LIST_EMPTY_LANE_HEIGHT,
  ENTITY_LIST_GROUP_HEADER_HEIGHT,
  ENTITY_LIST_OVERSCAN,
  coveringHeaderIndex,
  entityListWindow,
  flattenEntityListRows,
  groupEndByHeaderKey,
  revealEntryScrollTop,
  rowEntryIndexByItemKey,
  virtualEntryIndices,
} from '@/components/app-shell/entity-list-virtualization'
import {
  flattenTableGroups,
  virtualTableWindow,
  type FlattenedTableGroups,
  type VirtualTableEntry,
} from '@/components/app-shell/session-table/table-virtualization'

export { ENTITY_LIST_OVERSCAN }

/** Below this many rows, rendering every row is cheaper than measuring a window. */
const ENTITY_LIST_VIRTUALIZE_THRESHOLD = 40
/** Reserved measured-height keys for the shared header / empty-lane shells. */
const MEASURE_HEADER_KEY = '$header'
const MEASURE_EMPTY_LANE_KEY = '$emptyLane'

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

export interface EntityListFlattenOptions<T> {
  getItemKey: (item: T) => string
  rowHeight: number
  headerHeight: number
  emptyLaneHeight?: number
  /** entry key (`row:<id>`) → measured pixel height, fed back from the DOM. */
  measuredRowHeights?: ReadonlyMap<string, number>
}

/**
 * Flatten groups (or a flat list) into positioned entries for the tree path
 * (`WindowedTreeList`), reusing the session-table kernel so binary-search
 * offsets and overscan match `EntityList`.
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

/**
 * The windowed slice plus the active/selected row when it lies outside it. The
 * active row must stay mounted: keyboard navigation focuses its DOM node
 * (unmounted rows lose their ref), so dropping it would make arrow nav silently
 * dead until the user clicks a mounted row again.
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
  /** Ref to the ScrollArea viewport element (for scroll-based pagination) */
  viewportRef?: React.RefObject<HTMLDivElement>
  /** Additional ScrollArea class */
  scrollAreaClassName?: string
  className?: string
  /**
   * Explicit empty/error/loading/ready contract for the list root. Defaults to
   * `empty` when there is no content and `ready` otherwise, so the state shells
   * stay distinguishable via `[data-state]`.
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
  /** Window large lists so the DOM does not grow linearly with the collection. */
  virtualize?: boolean
  /** Estimated row height before the first measurement (virtualized mode). */
  estimateRowHeight?: number
  /** Item keys kept mounted even when offscreen (roving focus target). */
  ensureVisibleKeys?: ReadonlySet<string>
  /** Item key to reveal when it changes (external selection). */
  revealKey?: string | null
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
  /** Ref onto the sticky element, so windowed mode measures the header, not its slot. */
  elementRef?: React.Ref<HTMLDivElement>
  /** Inline style for the sticky element (windowed mode re-enables pointer events). */
  style?: React.CSSProperties
}) {
  const { t } = useTranslation()
  return (
    <ContextMenu modal>
      <ContextMenuTrigger asChild>
<div ref={elementRef} style={style} className="sticky top-0 z-10 bg-background px-5 py-2">
          <span className="text-caption font-medium text-text-secondary uppercase caps-label">
            {label} <> · <span className="text-muted-foreground/50 numeric">{itemCount}</span></>
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
  /** Ref onto the sticky element, so windowed mode measures the header, not its slot. */
  elementRef?: React.Ref<HTMLButtonElement>
  /** Inline style for the sticky element (windowed mode re-enables pointer events). */
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
          <div className="absolute inset-y-0.5 left-2 right-2 rounded-[var(--radius-card)] group-hover/header:bg-surface-hover transition-colors duration-[var(--motion-fast)] ease-[var(--ease-standard)] pointer-events-none" />
          <ChevronRight
            className={cn(
              "h-3 w-3 text-muted-foreground/60 transition-transform duration-[var(--motion-fast)] ease-[var(--ease-standard)] relative",
              !isCollapsed && "rotate-90"
            )}
          />
          <span className="text-caption font-medium uppercase caps-label text-text-secondary relative">
            {label} <> · <span className="text-muted-foreground/50 numeric">{itemCount}</span></>
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
// Virtualized body
// ============================================================================

interface VirtualEntityListBodyProps<T> {
  groups?: EntityListGroup<T>[]
  items?: T[]
  getKey: (item: T) => string
  renderItem: (item: T, index: number, isFirstInGroup: boolean) => React.ReactNode
  collapsedGroups?: Set<string>
  onToggleCollapse?: (groupKey: string) => void
  onCollapseAll?: () => void
  onExpandAll?: () => void
  onSelectGroup?: (groupKey: string) => void
  dropGroupKey?: string | null
  onEmptyGroupDragOver?: (groupKey: string, event: React.DragEvent) => void
  estimateRowHeight: number
  ensureVisibleKeys?: ReadonlySet<string>
  revealKey?: string | null
  viewportRef?: React.RefObject<HTMLDivElement>
}

/**
 * Windowed body of EntityList. Rows are absolutely positioned by offset while
 * heights come back from a ResizeObserver, so variable-height rows (badges,
 * tags, family decoration) never overlap. The active/selected rows are pinned
 * into the window so roving focus and scroll-into-view keep working.
 */
function VirtualEntityListBody<T>({
  groups,
  items,
  getKey,
  renderItem,
  collapsedGroups,
  onToggleCollapse,
  onCollapseAll,
  onExpandAll,
  onSelectGroup,
  dropGroupKey,
  onEmptyGroupDragOver,
  estimateRowHeight,
  ensureVisibleKeys,
  revealKey,
  viewportRef,
}: VirtualEntityListBodyProps<T>) {
  const { t } = useTranslation()
  const isGrouped = !!groups && groups.length > 0
  const listRef = React.useRef<HTMLDivElement>(null)
  const viewportElRef = React.useRef<HTMLDivElement | null>(null)
  const [metrics, setMetrics] = React.useState({ scrollTop: 0, height: 0 })
  const [listOffsetTop, setListOffsetTop] = React.useState(0)
  const [measuredHeights, setMeasuredHeights] = React.useState<ReadonlyMap<string, number>>(() => new Map())

  const groupByKey = React.useMemo(() => {
    const map = new Map<string, EntityListGroup<T>>()
    for (const group of groups ?? []) map.set(group.key, group)
    return map
  }, [groups])

  // flattenTableGroups collapses any key in the set; only collapsible groups on
  // this list may collapse, so unrelated keys never hide a row.
  const collapsedSet = React.useMemo(() => {
    const keys = new Set<string>()
    for (const key of collapsedGroups ?? []) {
      if (groupByKey.get(key)?.collapsible) keys.add(key)
    }
    return keys
  }, [collapsedGroups, groupByKey])

  const virtualGroups = React.useMemo(() => {
    if (isGrouped) return groups!.map((group) => ({ key: group.key, items: group.items }))
    return [{ key: null, items: items ?? [] }]
  }, [isGrouped, groups, items])

  const rowMeta = React.useMemo(() => {
    const map = new Map<string, { index: number; isFirst: boolean }>()
    if (isGrouped) {
      for (const group of groups!) {
        group.items.forEach((item, index) => map.set(getKey(item), { index, isFirst: index === 0 }))
      }
    } else {
      ;(items ?? []).forEach((item, index) => map.set(getKey(item), { index, isFirst: index === 0 }))
    }
    return map
  }, [isGrouped, groups, items, getKey])

  const flattened = React.useMemo(
    () =>
      flattenEntityListRows(virtualGroups, {
        getItemKey: getKey,
        rowHeight: estimateRowHeight,
        // Header/empty-lane text sits in a line box whose height depends on the
        // surrounding strut, so measure the first one instead of trusting a
        // constant (falls back until the first paint).
        headerHeight: measuredHeights.get(MEASURE_HEADER_KEY) ?? ENTITY_LIST_GROUP_HEADER_HEIGHT,
        emptyLaneHeight: measuredHeights.get(MEASURE_EMPTY_LANE_KEY) ?? ENTITY_LIST_EMPTY_LANE_HEIGHT,
        collapsed: collapsedSet,
        getRowHeight: (item) => measuredHeights.get(getKey(item)),
      }),
    [virtualGroups, getKey, estimateRowHeight, collapsedSet, measuredHeights],
  )

  // --- Row measurement (logical key → content height) ---
  const observerRef = React.useRef<ResizeObserver | null>(null)
  const observedRef = React.useRef(new Map<Element, string>())
  const logicalKeyRef = React.useRef(new Map<string, string>())
  React.useEffect(() => {
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver((entries) => {
      setMeasuredHeights((previous) => {
        let next: Map<string, number> | null = null
        for (const entry of entries) {
          const registration = observedRef.current.get(entry.target)
          if (!registration) continue
          const key = logicalKeyRef.current.get(registration) ?? registration
          const height = Math.ceil(entry.contentRect.height)
          if (height <= 0 || previous.get(key) === height) continue
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
  }, [])

  const refCallbacks = React.useRef(new Map<string, (element: HTMLElement | null) => void>())
  const measureRef = React.useCallback((registration: string, logicalKey?: string) => {
    logicalKeyRef.current.set(registration, logicalKey ?? registration)
    let callback = refCallbacks.current.get(registration)
    if (!callback) {
      let current: HTMLElement | null = null
      callback = (element: HTMLElement | null) => {
        if (current && current !== element) {
          observerRef.current?.unobserve(current)
          observedRef.current.delete(current)
        }
        current = element
        if (element) {
          observedRef.current.set(element, registration)
          observerRef.current?.observe(element)
        }
      }
      refCallbacks.current.set(registration, callback)
    }
    return callback
  }, [])

  // --- Viewport tracking ---
  React.useLayoutEffect(() => {
    const viewport = viewportRef?.current
      ?? (listRef.current?.closest('[data-radix-scroll-area-viewport]') as HTMLDivElement | null)
    viewportElRef.current = viewport
    if (!viewport) return
    const update = () => {
      setMetrics((previous) => {
        const next = { scrollTop: viewport.scrollTop, height: viewport.clientHeight }
        return previous.scrollTop === next.scrollTop && previous.height === next.height ? previous : next
      })
    }
    update()
    viewport.addEventListener('scroll', update, { passive: true })
    const observer = new ResizeObserver(update)
    observer.observe(viewport)
    return () => {
      viewport.removeEventListener('scroll', update)
      observer.disconnect()
    }
  }, [viewportRef])

  React.useLayoutEffect(() => {
    const list = listRef.current
    const viewport = viewportElRef.current
    if (!list || !viewport) return
    const box = list.getBoundingClientRect()
    const parentBox = viewport.getBoundingClientRect()
    const next = box.top - parentBox.top + viewport.scrollTop
    setListOffsetTop((previous) => (previous === next ? previous : next))
  }, [metrics.scrollTop, metrics.height, flattened.totalHeight, virtualGroups.length])

  const keyIndex = React.useMemo(
    () => rowEntryIndexByItemKey(flattened.entries, getKey),
    [flattened.entries, getKey],
  )

  const baseWindow = entityListWindow(flattened, listOffsetTop, metrics.scrollTop, metrics.height)
  const pinnedIndices = React.useMemo(() => {
    if (!ensureVisibleKeys || ensureVisibleKeys.size === 0) return []
    const indices: number[] = []
    for (const key of ensureVisibleKeys) {
      const index = keyIndex.get(key)
      if (index != null) indices.push(index)
    }
    return indices
  }, [ensureVisibleKeys, keyIndex])
  // Keep the group header that covers the window start mounted while its group
  // is on screen. Without it the header entry leaves the window mid-group and
  // the sticky header disappears — the non-windowed layout keeps it.
  const covering = React.useMemo(
    () => coveringHeaderIndex(flattened.entries, baseWindow.startIndex),
    [flattened.entries, baseWindow.startIndex],
  )
  const pinnedWithCovering = React.useMemo(
    () => (covering == null ? pinnedIndices : [...pinnedIndices, covering]),
    [pinnedIndices, covering],
  )
  // Where each header's group ends: the slot spans this far so `sticky top-0`
  // stays pinned until the next group scrolls in.
  const groupEnds = React.useMemo(
    () => groupEndByHeaderKey(flattened.entries, flattened.totalHeight),
    [flattened.entries, flattened.totalHeight],
  )
  const visibleIndices = virtualEntryIndices(baseWindow, flattened.entries.length, pinnedWithCovering)
  const visible = visibleIndices.map((index) => flattened.entries[index]!)

  // Reveal an externally selected item with the least scroll movement.
  React.useEffect(() => {
    if (!revealKey) return
    const index = keyIndex.get(revealKey)
    if (index == null) return
    const entry = flattened.entries[index]
    const viewport = viewportElRef.current
    const list = listRef.current
    if (!entry || !viewport || !list) return
    const offsetTop = list.getBoundingClientRect().top - viewport.getBoundingClientRect().top + viewport.scrollTop
    viewport.scrollTop = revealEntryScrollTop(entry, offsetTop, viewport.scrollTop, viewport.clientHeight)
    // Only react to selection changes; offsets are read live from the DOM.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealKey])

  return (
    <div ref={listRef} className="relative" style={{ height: flattened.totalHeight }}>
      {visible.map((entry) => {
        const style: React.CSSProperties = { position: 'absolute', left: 0, right: 0, top: entry.offset }
        if (entry.kind === 'header') {
          const group = groupByKey.get(entry.bucket.key)
          if (!group) return null
          const isCollapsed = group.collapsible && collapsedSet.has(group.key)
          const headerRef = measureRef(`h:${entry.bucket.key}`, MEASURE_HEADER_KEY)
          // The slot spans the whole group and stays click-through; the inner
          // sticky header owns its own height and re-enables pointer events, so
          // it sticks until the next group arrives (same as non-windowed).
          const headerStyle: React.CSSProperties = {
            ...style,
            height: Math.max(entry.height, (groupEnds.get(entry.key) ?? flattened.totalHeight) - entry.offset),
            pointerEvents: 'none',
          }
          return (
            <div key={entry.key} data-windowed-header={group.key} style={headerStyle}>
              {group.collapsible && onToggleCollapse ? (
                <CollapsibleGroupHeader
                  label={group.label}
                  isCollapsed={!!isCollapsed}
                  itemCount={groupHeaderCount(!!isCollapsed, group.items.length, group.collapsedCount)}
                  onToggle={() => onToggleCollapse(group.key)}
                  onCollapseAll={onCollapseAll}
                  onExpandAll={onExpandAll}
                  onSelectGroup={onSelectGroup ? () => onSelectGroup(group.key) : undefined}
                  elementRef={headerRef}
                  style={{ pointerEvents: 'auto' }}
                />
              ) : (
                <SectionHeader
                  label={group.label}
                  itemCount={group.items.length}
                  onSelectGroup={onSelectGroup ? () => onSelectGroup(group.key) : undefined}
                  elementRef={headerRef}
                  style={{ pointerEvents: 'auto' }}
                />
              )}
            </div>
          )
        }
        if (entry.kind === 'empty') {
          const group = groupByKey.get(entry.bucket.key)
          return (
            <div key={entry.key} style={style} ref={measureRef(`e:${entry.bucket.key}`, MEASURE_EMPTY_LANE_KEY)}>
              <div
                data-empty-group={group?.key ?? entry.bucket.key}
                className={cn(
                  'mx-3 rounded-[var(--radius-card)] border border-dashed px-3 py-2 text-caption text-muted-foreground/70',
                  dropGroupKey === entry.bucket.key
                    ? 'border-border-strong bg-surface-hover text-foreground'
                    : 'border-border-subtle',
                )}
                onDragOver={(event) => onEmptyGroupDragOver?.(entry.bucket.key, event)}
              >
                {t('entityList.emptyGroupDrop')}
              </div>
            </div>
          )
        }
        const meta = rowMeta.get(getKey(entry.item))
        return (
          <div key={entry.key} style={style} ref={measureRef(getKey(entry.item))}>
            {renderItem(entry.item, meta?.index ?? 0, meta?.isFirst ?? false)}
          </div>
        )
      })}
    </div>
  )
}

// ============================================================================
// Component
// ============================================================================

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
  virtualize,
  estimateRowHeight,
  ensureVisibleKeys,
  revealKey,
}: EntityListProps<T>) {
  const { t } = useTranslation()
  // Determine if we have content
  const hasGroups = groups && groups.length > 0
  const hasItems = items && items.length > 0
  const isEmpty = !hasGroups && !hasItems
  const resolvedState = state ?? (isEmpty ? 'empty' : 'ready')

  // Empty state — rendered outside everything for proper centering
  if (isEmpty && emptyState) {
    return (
      <div className={cn('flex flex-col flex-1 min-h-0', className)} data-state={resolvedState}>
        {header}
        {emptyState}
      </div>
    )
  }

  const itemCount = hasGroups
    ? groups!.reduce((sum, group) => sum + group.items.length, 0)
    : (items?.length ?? 0)
  const windowed = !!virtualize && itemCount >= ENTITY_LIST_VIRTUALIZE_THRESHOLD

  return (
    <div className={cn('flex flex-col flex-1 min-h-0', className)} data-state={resolvedState}>
      {header}
      <ScrollArea className={cn('flex-1', scrollAreaClassName)} viewportRef={viewportRef}>
        <div
          ref={containerRef}
          className="flex flex-col pb-2"
          {...containerProps}
        >
          <div className="pt-1">
            {windowed ? (
              <VirtualEntityListBody
                groups={groups}
                items={items}
                getKey={getKey}
                renderItem={renderItem}
                collapsedGroups={collapsedGroups}
                onToggleCollapse={onToggleCollapse}
                onCollapseAll={onCollapseAll}
                onExpandAll={onExpandAll}
                onSelectGroup={onSelectGroup}
                dropGroupKey={dropGroupKey}
                onEmptyGroupDragOver={onEmptyGroupDragOver}
                estimateRowHeight={estimateRowHeight ?? ENTITY_LIST_DEFAULT_ROW_HEIGHT}
                ensureVisibleKeys={ensureVisibleKeys}
                revealKey={revealKey}
                viewportRef={viewportRef}
              />
            ) : hasGroups
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
                      {!isCollapsed && group.items.length === 0 ? (
                        <div
                          data-empty-group={group.key}
                          className={cn(
                            'mx-3 mb-2 rounded-[var(--radius-card)] border border-dashed px-3 py-2 text-caption text-muted-foreground/70',
                            dropGroupKey === group.key
                              ? 'border-border-strong bg-surface-hover text-foreground'
                              : 'border-border-subtle',
                          )}
                          onDragOver={(event) => onEmptyGroupDragOver?.(group.key, event)}
                        >
                          {t('entityList.emptyGroupDrop')}
                        </div>
                      ) : null}
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