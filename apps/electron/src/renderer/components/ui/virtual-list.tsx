/**
 * VirtualList — shared windowed list for large collections (ADR-0023 §7, #1578).
 *
 * Built on the same flatten/window kernel as the session table, Kanban and the
 * session list (`table-virtualization`), so every virtualized surface shares
 * one offset model:
 * - Group headers are flattened into the entry list. The header covering the
 *   window start stays mounted and its slot spans the whole group, so a
 *   `sticky top-0` header behaves exactly like the plain layout.
 * - Rows start at `estimateRowHeight` and are re-measured by a ResizeObserver,
 *   so variable-height rows never overlap.
 * - `overscan` counts rows on each side of the viewport.
 * - Pinned, revealed and focused rows stay mounted, so roving focus survives
 *   leaving the window; `keyboardNavigation` moves focus across ALL rows and
 *   scrolls the target into view.
 *
 * Needs a scroll parent: `viewportRef`, else the closest Radix ScrollArea
 * viewport, else the parent element.
 */

import * as React from 'react'
import { cn } from '@/lib/utils'
import {
  ENTITY_LIST_EMPTY_LANE_HEIGHT,
  ENTITY_LIST_GROUP_HEADER_HEIGHT,
  coveringHeaderIndex,
  flattenEntityListRows,
  groupEndByHeaderKey,
  revealEntryScrollTop,
  virtualEntryIndices,
} from '@/components/app-shell/entity-list-virtualization'
import { virtualTableWindow } from '@/components/app-shell/session-table/table-virtualization'

/** Rows rendered above and below the viewport. */
export const VIRTUAL_LIST_DEFAULT_OVERSCAN = 8

/** Shared measured-height keys: one header / empty lane stands for all of them. */
const MEASURE_HEADER_KEY = '$header'
const MEASURE_EMPTY_KEY = '$empty'
const FOCUSABLE_SELECTOR = 'button, a[href], input, select, textarea, [tabindex]'
const NAVIGATION_KEYS = new Set(['ArrowDown', 'ArrowUp', 'Home', 'End'])

export interface VirtualListGroup<T> {
  key: string
  items: readonly T[]
}

export interface VirtualListHeaderProps {
  /** Measures the header; attach it to the sticky element, not a wrapper. */
  ref: (element: HTMLElement | null) => void
  /** Re-enables pointer events inside the click-through group slot. */
  style: React.CSSProperties
}

export interface VirtualListProps<T, G extends VirtualListGroup<T> = VirtualListGroup<T>> {
  /** Flat item list (used when `groups` is empty or absent). */
  items?: readonly T[]
  /** Grouped items; each group contributes a header entry when `renderGroupHeader` is set. */
  groups?: readonly G[]
  /** Group keys whose rows are hidden (header only). */
  collapsedGroups?: ReadonlySet<string>
  getKey: (item: T) => string
  renderItem: (item: T, index: number, isFirstInGroup: boolean) => React.ReactNode
  renderGroupHeader?: (group: G, headerProps: VirtualListHeaderProps) => React.ReactNode
  /** Content for an expanded group without items (e.g. a drop lane). */
  renderEmptyGroup?: (group: G) => React.ReactNode
  /** Row height (px) before the row has been measured. */
  estimateRowHeight: number
  estimateHeaderHeight?: number
  estimateEmptyGroupHeight?: number
  /** Rows rendered above and below the viewport. */
  overscan?: number
  viewportRef?: React.RefObject<HTMLElement | null>
  /** Viewport size used until the scroll parent reports one (non-layout DOMs, first paint). */
  initialRect?: { height: number }
  /** Item keys kept mounted even when offscreen (roving focus targets). */
  pinnedKeys?: ReadonlySet<string>
  /** Item key scrolled into view whenever it changes. */
  revealKey?: string | null
  /** Handle ArrowUp/ArrowDown/Home/End across all rows, mounting and focusing the target. */
  keyboardNavigation?: boolean
  className?: string
}

export function VirtualList<T, G extends VirtualListGroup<T> = VirtualListGroup<T>>({
  items,
  groups,
  collapsedGroups,
  getKey,
  renderItem,
  renderGroupHeader,
  renderEmptyGroup,
  estimateRowHeight,
  estimateHeaderHeight = ENTITY_LIST_GROUP_HEADER_HEIGHT,
  estimateEmptyGroupHeight = ENTITY_LIST_EMPTY_LANE_HEIGHT,
  overscan = VIRTUAL_LIST_DEFAULT_OVERSCAN,
  viewportRef,
  initialRect,
  pinnedKeys,
  revealKey,
  keyboardNavigation = false,
  className,
}: VirtualListProps<T, G>): React.ReactElement {
  const isGrouped = !!groups && groups.length > 0
  const hasHeaders = isGrouped && !!renderGroupHeader
  const hasEmptyLanes = isGrouped && !!renderEmptyGroup
  const listRef = React.useRef<HTMLDivElement>(null)
  const viewportElRef = React.useRef<HTMLElement | null>(null)
  const [metrics, setMetrics] = React.useState({ scrollTop: 0, height: 0 })
  const [listOffsetTop, setListOffsetTop] = React.useState(0)
  const [measuredHeights, setMeasuredHeights] = React.useState<ReadonlyMap<string, number>>(() => new Map())
  const [focusKey, setFocusKey] = React.useState<string | null>(null)
  const [pendingFocusKey, setPendingFocusKey] = React.useState<string | null>(null)

  const groupByKey = React.useMemo(() => {
    const map = new Map<string, G>()
    for (const group of groups ?? []) map.set(group.key, group)
    return map
  }, [groups])

  const flatGroups = React.useMemo(() => {
    if (isGrouped) return groups!.map((group) => ({ key: group.key, items: group.items }))
    return [{ key: null, items: items ?? [] }]
  }, [isGrouped, groups, items])

  const rowMeta = React.useMemo(() => {
    const map = new Map<string, { index: number; isFirst: boolean }>()
    for (const group of flatGroups) {
      group.items.forEach((item, index) => map.set(getKey(item), { index, isFirst: index === 0 }))
    }
    return map
  }, [flatGroups, getKey])

  const flattened = React.useMemo(
    () =>
      flattenEntityListRows(flatGroups, {
        getItemKey: getKey,
        rowHeight: estimateRowHeight,
        headerHeight: hasHeaders ? (measuredHeights.get(MEASURE_HEADER_KEY) ?? estimateHeaderHeight) : 0,
        emptyLaneHeight: hasEmptyLanes ? (measuredHeights.get(MEASURE_EMPTY_KEY) ?? estimateEmptyGroupHeight) : undefined,
        collapsed: collapsedGroups,
        getRowHeight: (item) => measuredHeights.get(getKey(item)),
      }),
    [flatGroups, getKey, estimateRowHeight, hasHeaders, hasEmptyLanes, estimateHeaderHeight, estimateEmptyGroupHeight, collapsedGroups, measuredHeights],
  )

  const rowOrder = React.useMemo(() => {
    const keys: string[] = []
    const position = new Map<string, number>()
    const entryIndex = new Map<string, number>()
    flattened.entries.forEach((entry, index) => {
      if (entry.kind !== 'row') return
      const key = getKey(entry.item)
      position.set(key, keys.length)
      entryIndex.set(key, index)
      keys.push(key)
    })
    return { keys, position, entryIndex }
  }, [flattened.entries, getKey])

  // --- Measurement (registration → logical key → content height) ---
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

  const measureCallbacks = React.useRef(new Map<string, (element: HTMLElement | null) => void>())
  const measureRef = React.useCallback((registration: string, logicalKey?: string) => {
    logicalKeyRef.current.set(registration, logicalKey ?? registration)
    let callback = measureCallbacks.current.get(registration)
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
      measureCallbacks.current.set(registration, callback)
    }
    return callback
  }, [])

  const rowElements = React.useRef(new Map<string, HTMLElement>())
  const rowCallbacks = React.useRef(new Map<string, (element: HTMLElement | null) => void>())
  const rowRef = React.useCallback((key: string) => {
    let callback = rowCallbacks.current.get(key)
    if (!callback) {
      const measure = measureRef(key)
      callback = (element: HTMLElement | null) => {
        measure(element)
        if (element) rowElements.current.set(key, element)
        else rowElements.current.delete(key)
      }
      rowCallbacks.current.set(key, callback)
    }
    return callback
  }, [measureRef])

  // --- Viewport tracking ---
  React.useLayoutEffect(() => {
    const list = listRef.current
    const viewport = viewportRef?.current
      ?? list?.closest<HTMLElement>('[data-radix-scroll-area-viewport]')
      ?? list?.parentElement
      ?? null
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
    let observer: ResizeObserver | null = null
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(update)
      observer.observe(viewport)
    }
    return () => {
      viewport.removeEventListener('scroll', update)
      observer?.disconnect()
    }
  }, [viewportRef])

  React.useLayoutEffect(() => {
    const list = listRef.current
    const viewport = viewportElRef.current
    if (!list || !viewport) return
    const next = list.getBoundingClientRect().top - viewport.getBoundingClientRect().top + viewport.scrollTop
    setListOffsetTop((previous) => (previous === next ? previous : next))
  }, [metrics.scrollTop, metrics.height, flattened.totalHeight])

  const viewportHeight = metrics.height > 0 ? metrics.height : (initialRect?.height ?? 0)
  const entryCount = flattened.entries.length
  const visibleRange = virtualTableWindow(flattened.entries, metrics.scrollTop - listOffsetTop, viewportHeight, 0)
  const visibleCount = visibleRange.endIndex - visibleRange.startIndex
  // Overscan never exceeds half the visible entries, so the DOM stays within
  // 2× the visible rows (#1578); before the first layout there is nothing to halve.
  const rowsOverscan = visibleCount > 0 ? Math.min(overscan, Math.floor(visibleCount / 2)) : overscan
  const range = {
    startIndex: Math.max(0, visibleRange.startIndex - rowsOverscan),
    endIndex: Math.min(entryCount, visibleRange.endIndex + rowsOverscan),
  }

  const pinnedIndices = React.useMemo(() => {
    const indices: number[] = []
    const pin = (key: string | null | undefined) => {
      if (!key) return
      const index = rowOrder.entryIndex.get(key)
      if (index != null) indices.push(index)
    }
    for (const key of pinnedKeys ?? []) pin(key)
    pin(revealKey)
    pin(focusKey)
    pin(pendingFocusKey)
    return indices
  }, [pinnedKeys, revealKey, focusKey, pendingFocusKey, rowOrder])

  const covering = React.useMemo(
    () => (hasHeaders ? coveringHeaderIndex(flattened.entries, range.startIndex) : null),
    [hasHeaders, flattened.entries, range.startIndex],
  )
  const groupEnds = React.useMemo(
    () => groupEndByHeaderKey(flattened.entries, flattened.totalHeight),
    [flattened.entries, flattened.totalHeight],
  )
  const visibleIndices = virtualEntryIndices(
    range,
    entryCount,
    covering == null ? pinnedIndices : [...pinnedIndices, covering],
  )

  const scrollRowIntoView = React.useCallback((key: string) => {
    const index = rowOrder.entryIndex.get(key)
    const entry = index == null ? undefined : flattened.entries[index]
    const viewport = viewportElRef.current
    const list = listRef.current
    if (!entry || !viewport || !list) return
    const offsetTop = list.getBoundingClientRect().top - viewport.getBoundingClientRect().top + viewport.scrollTop
    const height = viewport.clientHeight > 0 ? viewport.clientHeight : viewportHeight
    const next = revealEntryScrollTop(entry, offsetTop, viewport.scrollTop, height)
    if (next === viewport.scrollTop) return
    viewport.scrollTop = next
    const applied = viewport.scrollTop
    setMetrics((previous) => (previous.scrollTop === applied ? previous : { scrollTop: applied, height: previous.height }))
  }, [rowOrder, flattened.entries, viewportHeight])

  React.useEffect(() => {
    if (revealKey) scrollRowIntoView(revealKey)
    // Only react to reveal-key changes; offsets are read live from the DOM.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealKey])

  const handleKeyDown = React.useCallback((event: KeyboardEvent) => {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return
    if (!NAVIGATION_KEYS.has(event.key)) return
    const target = event.target as HTMLElement | null
    if (!target) return
    if (target.closest('input, textarea, select, [contenteditable="true"]')) return
    const currentKey = target.closest<HTMLElement>('[data-virtual-row]')?.dataset.virtualRow
    if (currentKey === undefined) return
    const position = rowOrder.position.get(currentKey)
    const count = rowOrder.keys.length
    if (position == null || count === 0) return
    event.preventDefault()
    event.stopPropagation()
    const nextPosition =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? count - 1
          : event.key === 'ArrowDown'
            ? (position + 1) % count
            : (position - 1 + count) % count
    if (nextPosition === position) return
    const nextKey = rowOrder.keys[nextPosition]!
    scrollRowIntoView(nextKey)
    setFocusKey(nextKey)
    setPendingFocusKey(nextKey)
  }, [rowOrder, scrollRowIntoView])

  // Native capture so Home/End/Arrows reach the list before a focused row's
  // roving-tabindex handler stopPropagation (EntityPanel / EntityRow).
  React.useLayoutEffect(() => {
    if (!keyboardNavigation) return
    const list = listRef.current
    if (!list) return
    list.addEventListener('keydown', handleKeyDown, true)
    return () => list.removeEventListener('keydown', handleKeyDown, true)
  }, [keyboardNavigation, handleKeyDown])

  const handleFocus = React.useCallback((event: React.FocusEvent<HTMLDivElement>) => {
    const key = (event.target as HTMLElement).closest<HTMLElement>('[data-virtual-row]')?.dataset.virtualRow
    if (key !== undefined) setFocusKey((previous) => (previous === key ? previous : key))
  }, [])

  React.useLayoutEffect(() => {
    if (!pendingFocusKey) return
    const row = rowElements.current.get(pendingFocusKey)
    if (!row) return
    const target =
      row.querySelector<HTMLElement>('[role="option"]')
      ?? row.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)
      ?? row
    target.focus({ preventScroll: true })
    setPendingFocusKey(null)
  })

  return (
    <div
      ref={listRef}
      className={cn('relative', className)}
      style={{ height: flattened.totalHeight }}
      onFocus={handleFocus}
    >
      {visibleIndices.map((index) => {
        const entry = flattened.entries[index]!
        const style: React.CSSProperties = { position: 'absolute', left: 0, right: 0, top: entry.offset }
        if (entry.kind === 'header') {
          const group = groupByKey.get(entry.bucket.key)
          if (!group || !renderGroupHeader) return null
          const slotStyle: React.CSSProperties = {
            ...style,
            height: Math.max(entry.height, (groupEnds.get(entry.key) ?? flattened.totalHeight) - entry.offset),
            pointerEvents: 'none',
          }
          return (
            <div key={entry.key} role="none" data-virtual-header={group.key} style={slotStyle}>
              {renderGroupHeader(group, {
                ref: measureRef(`h:${group.key}`, MEASURE_HEADER_KEY),
                style: { pointerEvents: 'auto' },
              })}
            </div>
          )
        }
        if (entry.kind === 'empty') {
          const group = groupByKey.get(entry.bucket.key)
          if (!group || !renderEmptyGroup) return null
          return (
            <div key={entry.key} role="none" style={style} ref={measureRef(`e:${group.key}`, MEASURE_EMPTY_KEY)}>
              {renderEmptyGroup(group)}
            </div>
          )
        }
        const key = getKey(entry.item)
        const meta = rowMeta.get(key)
        return (
          <div
            key={entry.key}
            role="none"
            data-virtual-row={key}
            tabIndex={keyboardNavigation ? -1 : undefined}
            style={style}
            ref={rowRef(key)}
          >
            {renderItem(entry.item, meta?.index ?? 0, meta?.isFirst ?? false)}
          </div>
        )
      })}
    </div>
  )
}
