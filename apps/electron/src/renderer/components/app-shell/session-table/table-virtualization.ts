export interface VirtualTableGroup<TItem, TBucket extends { key: string }> {
  bucket: TBucket | null
  items: readonly TItem[]
}

export interface FlattenTableGroupsOptions<TItem> {
  getItemKey: (item: TItem) => string
  rowHeight: number
  headerHeight: number
  getRowHeight?: (item: TItem) => number
  /** Expanded empty groups keep a drop-lane row instead of a dead header. */
  emptyLaneHeight?: number
}

export type VirtualTableEntry<TItem, TBucket extends { key: string }> =
  | {
      kind: 'header'
      key: string
      bucket: TBucket
      offset: number
      height: number
    }
  | {
      kind: 'empty'
      key: string
      bucket: TBucket
      offset: number
      height: number
    }
  | {
      kind: 'row'
      key: string
      item: TItem
      offset: number
      height: number
    }

export interface FlattenedTableGroups<TItem, TBucket extends { key: string }> {
  entries: readonly VirtualTableEntry<TItem, TBucket>[]
  totalHeight: number
}

/**
 * Converts expanded table groups into a fixed-height render list. Headers remain
 * visible for collapsed groups; their rows are omitted from both DOM and height.
 * Expanded empty groups keep a drop-lane entry when `emptyLaneHeight` is set.
 */
export function flattenTableGroups<TItem, TBucket extends { key: string }>(
  groups: readonly VirtualTableGroup<TItem, TBucket>[],
  collapsed: ReadonlySet<string>,
  options: FlattenTableGroupsOptions<TItem>,
): FlattenedTableGroups<TItem, TBucket> {
  const { getItemKey, rowHeight, headerHeight, getRowHeight, emptyLaneHeight } = options
  const entries: VirtualTableEntry<TItem, TBucket>[] = []
  let offset = 0

  for (const group of groups) {
    if (group.bucket) {
      entries.push({
        kind: 'header',
        key: `header:${group.bucket.key}`,
        bucket: group.bucket,
        offset,
        height: headerHeight,
      })
      offset += headerHeight
      if (collapsed.has(group.bucket.key)) continue
      if (group.items.length === 0 && emptyLaneHeight && emptyLaneHeight > 0) {
        entries.push({
          kind: 'empty',
          key: `empty:${group.bucket.key}`,
          bucket: group.bucket,
          offset,
          height: emptyLaneHeight,
        })
        offset += emptyLaneHeight
        continue
      }
    }

    for (const item of group.items) {
      const height = getRowHeight?.(item) ?? rowHeight
      entries.push({
        kind: 'row',
        key: `row:${getItemKey(item)}`,
        item,
        offset,
        height,
      })
      offset += height
    }
  }

  return { entries, totalHeight: offset }
}

export interface VirtualTableWindow {
  startIndex: number
  endIndex: number
}

/**
 * Returns the half-open range intersecting the viewport plus pixel overscan.
 * Entries are ordered by offset, so binary search keeps scroll work logarithmic.
 */
export function virtualTableWindow<TItem, TBucket extends { key: string }>(
  entries: readonly VirtualTableEntry<TItem, TBucket>[],
  scrollTop: number,
  viewportHeight: number,
  overscan = 0,
): VirtualTableWindow {
  const startOffset = Math.max(0, scrollTop - overscan)
  const endOffset = Math.max(startOffset, scrollTop + Math.max(0, viewportHeight) + overscan)

  let low = 0
  let high = entries.length
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    const entry = entries[middle]
    if (entry && entry.offset + entry.height <= startOffset) low = middle + 1
    else high = middle
  }
  const startIndex = low

  low = startIndex
  high = entries.length
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    const entry = entries[middle]
    if (entry && entry.offset < endOffset) low = middle + 1
    else high = middle
  }

  return { startIndex, endIndex: low }
}
