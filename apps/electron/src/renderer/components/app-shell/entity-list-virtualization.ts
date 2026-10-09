/**
 * Windowing math for large EntityList collections (session list and any other
 * opt-in consumer). Reuses the session-table flatten/window primitives so every
 * virtualized collection in the app shares one implementation, exactly like the
 * kanban board does for its columns.
 */

import {
  flattenTableGroups,
  virtualTableWindow,
  type FlattenedTableGroups,
} from './session-table/table-virtualization'

/** Pixel overscan above/below the viewport for EntityList rows. */
export const ENTITY_LIST_OVERSCAN = 480
/**
 * Rendered height of a group header (SectionHeader / CollapsibleGroupHeader):
 * py-2 (16px) + text-caption line-height (14px).
 */
export const ENTITY_LIST_GROUP_HEADER_HEIGHT = 30
/** Rendered height of an expanded empty-group drop lane (borders + py-2 + caption). */
export const ENTITY_LIST_EMPTY_LANE_HEIGHT = 32
/** Fallback row height before the first measurement (EntityRow py-3 + text-sm). */
export const ENTITY_LIST_DEFAULT_ROW_HEIGHT = 48

export interface VirtualEntityGroup<T> {
  /** Group key, or `null` for an ungrouped list (no header entry). */
  key: string | null
  items: readonly T[]
}

export interface FlattenEntityListOptions<T> {
  getItemKey: (item: T) => string
  rowHeight: number
  headerHeight: number
  emptyLaneHeight?: number
  /** Keys of collapsible groups currently collapsed. */
  collapsed?: ReadonlySet<string>
  /** Measured item height (feedback from the rendered rows). */
  getRowHeight?: (item: T) => number | undefined
}

/**
 * Converts EntityList groups (or a single ungrouped list) into a fixed-height
 * render list: group headers, expanded empty-group lanes, and rows. Collapsed
 * groups keep only their header in both DOM and height.
 */
export function flattenEntityListRows<T>(
  groups: readonly VirtualEntityGroup<T>[],
  options: FlattenEntityListOptions<T>,
): FlattenedTableGroups<T, { key: string }> {
  return flattenTableGroups(
    groups.map((group) => ({
      bucket: group.key === null ? null : { key: group.key },
      items: group.items,
    })),
    options.collapsed ?? new Set<string>(),
    {
      getItemKey: options.getItemKey,
      rowHeight: options.rowHeight,
      headerHeight: options.headerHeight,
      emptyLaneHeight: options.emptyLaneHeight,
      getRowHeight: options.getRowHeight
        ? (item) => options.getRowHeight?.(item) ?? options.rowHeight
        : undefined,
    },
  )
}

/**
 * Half-open entry window intersecting the viewport. `listOffsetTop` is the
 * list's offset inside its scroll container (padding/margins above it).
 */
export function entityListWindow<T>(
  flattened: FlattenedTableGroups<T, { key: string }>,
  listOffsetTop: number,
  scrollTop: number,
  viewportHeight: number,
  overscan = ENTITY_LIST_OVERSCAN,
): { startIndex: number; endIndex: number } {
  return virtualTableWindow(
    flattened.entries,
    scrollTop - listOffsetTop,
    viewportHeight,
    overscan,
  )
}

/**
 * Indices to render: the scrollport window plus any pinned entry indices
 * (active/selected rows). Returned sorted and de-duplicated so keeping a far
 * away pinned row mounted never pulls in every row in between.
 */
export function virtualEntryIndices(
  window: { startIndex: number; endIndex: number },
  entriesLength: number,
  pinnedIndices: readonly number[],
): number[] {
  const inWindow = (index: number) => index >= window.startIndex && index < window.endIndex
  const indices: number[] = []
  for (let index = Math.max(0, window.startIndex); index < Math.min(entriesLength, window.endIndex); index++) {
    indices.push(index)
  }
  for (const index of pinnedIndices) {
    if (index >= 0 && index < entriesLength && !inWindow(index)) indices.push(index)
  }
  indices.sort((a, b) => a - b)
  return indices
}

/**
 * Index of the group header entry that covers the window start: the last
 * header strictly before `startIndex`, or null when the window already starts
 * on a header (or at the very top). Pinning it keeps the group header mounted
 * while its group fills the scrollport, so the header's `sticky top-0` element
 * can stay pinned exactly like in the non-windowed layout.
 */
export function coveringHeaderIndex<T>(
  entries: FlattenedTableGroups<T, { key: string }>['entries'],
  startIndex: number,
): number | null {
  const first = entries[startIndex]
  if (startIndex <= 0 || !first || first.kind === 'header') return null
  const headerIndexes: number[] = []
  for (let index = 0; index < entries.length; index++) {
    if (entries[index]!.kind === 'header') headerIndexes.push(index)
  }
  // First header at or after the window start; its predecessor covers the top.
  let low = 0
  let high = headerIndexes.length
  while (low < high) {
    const middle = (low + high) >> 1
    if (headerIndexes[middle]! < startIndex) low = middle + 1
    else high = middle
  }
  return low > 0 ? headerIndexes[low - 1]! : null
}

/**
 * Scroll offset where each header entry's group ends: the next header entry's
 * offset, or the list total for the last group. The header's absolutely
 * positioned slot spans this range while the inner header keeps its own height,
 * which is what lets `sticky top-0` stick until the next group arrives.
 */
export function groupEndByHeaderKey<T>(
  entries: FlattenedTableGroups<T, { key: string }>['entries'],
  totalHeight: number,
): Map<string, number> {
  const headerIndexes: number[] = []
  for (let index = 0; index < entries.length; index++) {
    if (entries[index]!.kind === 'header') headerIndexes.push(index)
  }
  const ends = new Map<string, number>()
  headerIndexes.forEach((entryIndex, position) => {
    const entry = entries[entryIndex]!
    const nextIndex = headerIndexes[position + 1]
    ends.set(entry.key, nextIndex == null ? totalHeight : entries[nextIndex]!.offset)
  })
  return ends
}

/** Row entry index by item key, so DOM ids can be mapped to scroll offsets. */
export function rowEntryIndexByItemKey<T>(
  entries: FlattenedTableGroups<T, { key: string }>['entries'],
  getItemKey: (item: T) => string,
): Map<string, number> {
  const map = new Map<string, number>()
  entries.forEach((entry, index) => {
    if (entry.kind === 'row') map.set(getItemKey(entry.item), index)
  })
  return map
}

/**
 * Scroll offset that reveals `entry` with the least movement: align to the top
 * when it sits above the viewport, to the bottom when it sits below.
 */
export function revealEntryScrollTop(
  entry: { offset: number; height: number },
  listOffsetTop: number,
  scrollTop: number,
  viewportHeight: number,
): number {
  const top = listOffsetTop + entry.offset
  const bottom = top + entry.height
  if (top < scrollTop) return Math.max(0, top)
  if (bottom > scrollTop + viewportHeight) return Math.max(0, bottom - viewportHeight)
  return scrollTop
}