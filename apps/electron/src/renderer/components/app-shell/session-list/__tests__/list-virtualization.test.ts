import { describe, expect, it } from 'bun:test'
import {
  ENTITY_LIST_OVERSCAN,
  ENTITY_LIST_ROW_ESTIMATE,
  flattenEntityListGroups,
  type EntityListGroup,
} from '@/components/ui/entity-list'
import { virtualTableWindow } from '@/components/app-shell/session-table/table-virtualization'

/** Minimal session-row stand-in: the kernel only needs a stable key. */
interface Row {
  id: string
}

const VIEWPORT_HEIGHT = 640
const HEADER_HEIGHT = 33

function rows(count: number): Row[] {
  return Array.from({ length: count }, (_, index) => ({ id: `s${index}` }))
}

function flattenFlat(items: Row[], measuredRowHeights?: ReadonlyMap<string, number>) {
  return flattenEntityListGroups(undefined, items, new Set(), {
    getItemKey: (row) => row.id,
    rowHeight: ENTITY_LIST_ROW_ESTIMATE,
    headerHeight: 0,
    ...(measuredRowHeights ? { measuredRowHeights } : {}),
  })
}

describe('flattenEntityListGroups', () => {
  it('flattens a 2000-row sidebar list and windows to viewport plus overscan', () => {
    const items = rows(2000)
    const started = performance.now()
    const flattened = flattenFlat(items)
    const range = virtualTableWindow(flattened.entries, 4800, VIEWPORT_HEIGHT, ENTITY_LIST_OVERSCAN)
    const elapsed = performance.now() - started
    const visible = flattened.entries.slice(range.startIndex, range.endIndex)

    expect(flattened.entries).toHaveLength(2000)
    expect(flattened.totalHeight).toBe(2000 * ENTITY_LIST_ROW_ESTIMATE)
    expect(visible.length).toBeGreaterThan(0)
    expect(visible.length).toBeLessThan(2000)
    expect(visible.length).toBeLessThan(
      Math.ceil((VIEWPORT_HEIGHT + 2 * ENTITY_LIST_OVERSCAN) / ENTITY_LIST_ROW_ESTIMATE) + 4,
    )
    expect(elapsed).toBeLessThan(50)
  })

  it('flattens grouped rows with one header per group and keeps headers in the window', () => {
    const groups: EntityListGroup<Row>[] = [
      { key: 'g1', label: 'Today', items: rows(1200), collapsible: true },
      { key: 'g2', label: 'Older', items: rows(800), collapsible: true },
    ]
    const flattened = flattenEntityListGroups(groups, undefined, new Set(), {
      getItemKey: (row) => row.id,
      rowHeight: ENTITY_LIST_ROW_ESTIMATE,
      headerHeight: HEADER_HEIGHT,
    })
    const range = virtualTableWindow(flattened.entries, 0, VIEWPORT_HEIGHT, ENTITY_LIST_OVERSCAN)
    const visible = flattened.entries.slice(range.startIndex, range.endIndex)
    const visibleRows = visible.filter((entry) => entry.kind === 'row')

    expect(flattened.entries).toHaveLength(2002)
    expect(flattened.entries.filter((entry) => entry.kind === 'header')).toHaveLength(2)
    expect(flattened.totalHeight).toBe(2 * HEADER_HEIGHT + 2000 * ENTITY_LIST_ROW_ESTIMATE)
    expect(visibleRows.length).toBeGreaterThan(0)
    expect(visibleRows.length).toBeLessThan(2000)
    expect(visible.some((entry) => entry.kind === 'header')).toBe(true)
  })

  it('excludes rows and height of collapsed groups while keeping their header', () => {
    const groups: EntityListGroup<Row>[] = [
      { key: 'collapsed', label: 'Collapsed', items: rows(40), collapsible: true, collapsedCount: 40 },
      { key: 'open', label: 'Open', items: rows(5), collapsible: true },
    ]
    const flattened = flattenEntityListGroups(groups, undefined, new Set(['collapsed']), {
      getItemKey: (row) => row.id,
      rowHeight: ENTITY_LIST_ROW_ESTIMATE,
      headerHeight: HEADER_HEIGHT,
    })

    const rowEntries = flattened.entries.filter((entry) => entry.kind === 'row')
    expect(rowEntries).toHaveLength(5)
    expect(flattened.entries.filter((entry) => entry.kind === 'header')).toHaveLength(2)
    expect(flattened.totalHeight).toBe(2 * HEADER_HEIGHT + 5 * ENTITY_LIST_ROW_ESTIMATE)
  })

  it('uses measured row heights in the offset math', () => {
    const items = rows(3)
    const measured = new Map<string, number>([
      ['row:s1', 120],
      ['row:s2', 60],
    ])
    const flattened = flattenFlat(items, measured)
    const [first, second, third] = flattened.entries

    expect(first?.kind === 'row' && first.height).toBe(ENTITY_LIST_ROW_ESTIMATE)
    expect(second?.kind === 'row' && second.height).toBe(120)
    expect(third?.kind === 'row' && third.height).toBe(60)
    expect(second?.offset).toBe(ENTITY_LIST_ROW_ESTIMATE)
    expect(third?.offset).toBe(ENTITY_LIST_ROW_ESTIMATE + 120)
    expect(flattened.totalHeight).toBe(ENTITY_LIST_ROW_ESTIMATE + 120 + 60)
  })
})