import { describe, expect, test } from 'bun:test'
import {
  ENTITY_LIST_GROUP_HEADER_HEIGHT,
  ENTITY_LIST_EMPTY_LANE_HEIGHT,
  entityListWindow,
  flattenEntityListRows,
  revealEntryScrollTop,
  rowEntryIndexByItemKey,
  virtualEntryIndices,
} from '../entity-list-virtualization'

interface Item {
  id: string
}

const getItemKey = (item: Item) => item.id
const OPTIONS = {
  getItemKey,
  rowHeight: 40,
  headerHeight: ENTITY_LIST_GROUP_HEADER_HEIGHT,
  emptyLaneHeight: ENTITY_LIST_EMPTY_LANE_HEIGHT,
}

describe('flattenEntityListRows', () => {
  test('an ungrouped list has no header and stacks rows by height', () => {
    const flattened = flattenEntityListRows(
      [{ key: null, items: [{ id: 'a' }, { id: 'b' }] }],
      OPTIONS,
    )
    expect(flattened.entries.map((entry) => entry.kind)).toEqual(['row', 'row'])
    expect(flattened.entries[0]!.offset).toBe(0)
    expect(flattened.entries[1]!.offset).toBe(40)
    expect(flattened.totalHeight).toBe(80)
  })

  test('grouped lists emit headers and per-group rows with stable keys', () => {
    const flattened = flattenEntityListRows(
      [
        { key: 'today', items: [{ id: 'a' }] },
        { key: 'yesterday', items: [{ id: 'b' }, { id: 'c' }] },
      ],
      OPTIONS,
    )
    expect(flattened.entries.map((entry) => entry.key)).toEqual([
      'header:today',
      'row:a',
      'header:yesterday',
      'row:b',
      'row:c',
    ])
    expect(flattened.entries[1]!.offset).toBe(ENTITY_LIST_GROUP_HEADER_HEIGHT)
    expect(flattened.totalHeight).toBe(ENTITY_LIST_GROUP_HEADER_HEIGHT * 2 + 40 * 3)
  })

  test('collapsed groups keep their header and drop their rows and height', () => {
    const flattened = flattenEntityListRows(
      [{ key: 'today', items: [{ id: 'a' }, { id: 'b' }] }],
      { ...OPTIONS, collapsed: new Set(['today']) },
    )
    expect(flattened.entries.map((entry) => entry.key)).toEqual(['header:today'])
    expect(flattened.totalHeight).toBe(ENTITY_LIST_GROUP_HEADER_HEIGHT)
  })

  test('expanded empty groups emit a drop lane instead of a dead header', () => {
    const flattened = flattenEntityListRows([{ key: 'later', items: [] }], OPTIONS)
    expect(flattened.entries.map((entry) => entry.key)).toEqual(['header:later', 'empty:later'])
    expect(flattened.totalHeight).toBe(ENTITY_LIST_GROUP_HEADER_HEIGHT + ENTITY_LIST_EMPTY_LANE_HEIGHT)
  })

  test('measured heights override the estimate per item', () => {
    const flattened = flattenEntityListRows(
      [{ key: null, items: [{ id: 'a' }, { id: 'b' }] }],
      { ...OPTIONS, getRowHeight: (item) => (item.id === 'a' ? 90 : undefined) },
    )
    expect(flattened.entries[1]!.offset).toBe(90)
    expect(flattened.totalHeight).toBe(90 + 40)
  })
})

describe('entityListWindow', () => {
  const flattened = flattenEntityListRows(
    [{ key: null, items: Array.from({ length: 200 }, (_, i) => ({ id: `i${i}` })) }],
    OPTIONS,
  )

  test('returns only the entries intersecting the viewport plus overscan', () => {
    const window = entityListWindow(flattened, 0, 0, 400, 0)
    expect(window.startIndex).toBe(0)
    expect(window.endIndex).toBe(10)
  })

  test('respects the list offset inside its scroll container', () => {
    const window = entityListWindow(flattened, 100, 100, 400, 0)
    expect(window.startIndex).toBe(0)
  })

  test('advances logarithmically with scroll position', () => {
    const window = entityListWindow(flattened, 0, 4000, 400, 0)
    expect(window.startIndex).toBe(100)
    expect(window.endIndex).toBe(110)
  })
})

describe('virtualEntryIndices', () => {
  test('returns the window indices when nothing is pinned', () => {
    expect(virtualEntryIndices({ startIndex: 10, endIndex: 13 }, 100, [])).toEqual([10, 11, 12])
  })

  test('adds an offscreen pinned row without pulling in the rows between', () => {
    expect(virtualEntryIndices({ startIndex: 10, endIndex: 13 }, 100, [75])).toEqual([10, 11, 12, 75])
  })

  test('does not duplicate a pinned index already inside the window', () => {
    expect(virtualEntryIndices({ startIndex: 10, endIndex: 13 }, 100, [11])).toEqual([10, 11, 12])
  })

  test('ignores out-of-range indices and clamps the window to the list', () => {
    expect(virtualEntryIndices({ startIndex: -2, endIndex: 40 }, 30, [-1, 30, 99])).toEqual(
      Array.from({ length: 30 }, (_, i) => i),
    )
  })

  test('an empty window with no pins renders nothing', () => {
    expect(virtualEntryIndices({ startIndex: 5, endIndex: 5 }, 30, [])).toEqual([])
  })
})

describe('rowEntryIndexByItemKey', () => {
  test('maps item keys to their entry index and skips headers', () => {
    const flattened = flattenEntityListRows(
      [{ key: 'g', items: [{ id: 'a' }, { id: 'b' }] }],
      OPTIONS,
    )
    const index = rowEntryIndexByItemKey(flattened.entries, getItemKey)
    expect(index.get('a')).toBe(1)
    expect(index.get('b')).toBe(2)
    expect(index.size).toBe(2)
  })
})

describe('revealEntryScrollTop', () => {
  test('aligns to the top when the entry is above the viewport', () => {
    expect(revealEntryScrollTop({ offset: 100, height: 40 }, 0, 500, 400)).toBe(100)
  })

  test('aligns to the bottom when the entry is below the viewport', () => {
    expect(revealEntryScrollTop({ offset: 900, height: 40 }, 0, 500, 400)).toBe(540)
  })

  test('keeps the scroll position when the entry is already visible', () => {
    expect(revealEntryScrollTop({ offset: 600, height: 40 }, 0, 500, 400)).toBe(500)
  })
})