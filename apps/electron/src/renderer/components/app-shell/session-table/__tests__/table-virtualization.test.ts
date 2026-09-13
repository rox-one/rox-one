import { describe, expect, it } from 'bun:test'
import { flattenTableGroups, virtualTableWindow } from '../table-virtualization'

type Item = { id: string }
type Bucket = { key: string; label: string; count: number }

const groups: Array<{ bucket: Bucket | null; items: Item[] }> = [
  {
    bucket: { key: 'status:todo', label: 'Todo', count: 2 },
    items: [{ id: 'a' }, { id: 'b' }],
  },
  {
    bucket: { key: 'status:done', label: 'Done', count: 1 },
    items: [{ id: 'c' }],
  },
]

const options = { getItemKey: (item: Item) => item.id, rowHeight: 40, headerHeight: 32 }

describe('table virtualization', () => {
  it('keeps collapsed group headers while excluding their rows from layout', () => {
    const flattened = flattenTableGroups(groups, new Set(['status:todo']), options)

    expect(flattened.entries.map((entry) => [entry.kind, entry.key, entry.offset])).toEqual([
      ['header', 'header:status:todo', 0],
      ['header', 'header:status:done', 32],
      ['row', 'row:c', 64],
    ])
    expect(flattened.totalHeight).toBe(104)
  })
  it('returns only entries intersecting the viewport and overscan', () => {
    const flattened = flattenTableGroups(groups, new Set(), options)
    const window = virtualTableWindow(flattened.entries, 70, 20)

    expect(window).toEqual({ startIndex: 1, endIndex: 3 })
    expect(flattened.entries.slice(window.startIndex, window.endIndex).map((entry) => entry.key)).toEqual([
      'row:a',
      'row:b',
    ])
  })

  it('keeps an empty drop lane under expanded empty buckets', () => {
    const flattened = flattenTableGroups(
      [
        { bucket: { key: 'status:todo', label: 'Todo', count: 0 }, items: [] },
        {
          bucket: { key: 'status:done', label: 'Done', count: 1 },
          items: [{ id: 'c' }],
        },
      ],
      new Set(),
      { ...options, emptyLaneHeight: 40 },
    )

    expect(flattened.entries.map((entry) => [entry.kind, entry.key, entry.offset, entry.height])).toEqual([
      ['header', 'header:status:todo', 0, 32],
      ['empty', 'empty:status:todo', 32, 40],
      ['header', 'header:status:done', 72, 32],
      ['row', 'row:c', 104, 40],
    ])
    expect(flattened.totalHeight).toBe(144)
  })

  it('omits the empty drop lane when that group is collapsed', () => {
    const flattened = flattenTableGroups(
      [{ bucket: { key: 'status:todo', label: 'Todo', count: 0 }, items: [] }],
      new Set(['status:todo']),
      { ...options, emptyLaneHeight: 40 },
    )

    expect(flattened.entries.map((entry) => entry.kind)).toEqual(['header'])
    expect(flattened.totalHeight).toBe(32)
  })

  it('uses per-row heights when getRowHeight is provided', () => {
    const flattened = flattenTableGroups(groups, new Set(), {
      ...options,
      getRowHeight: (item) => (item.id === 'a' ? 80 : 40),
    })
    expect(flattened.entries.filter((entry) => entry.kind === 'row').map((entry) => [entry.key, entry.offset, entry.height])).toEqual([
      ['row:a', 32, 80],
      ['row:b', 112, 40],
      ['row:c', 184, 40],
    ])
    expect(flattened.totalHeight).toBe(224)
  })
})
