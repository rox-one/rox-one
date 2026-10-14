import { describe, expect, test } from 'bun:test'
import { flattenEntityListRows, groupEndByHeaderKey, observedBlockSize } from '../entity-list-virtualization'

/**
 * Regression for the Sessions list: collapsed date headers piled on top of each
 * other because the sticky header (py-2) was measured from contentRect, which
 * excludes padding, so header slots were ~16px shorter than the headers.
 */
describe('observedBlockSize', () => {
  const target = { getBoundingClientRect: () => ({ height: 32 }) } as unknown as Element
  test('prefers the border box over the padding-less content rect', () => {
    expect(observedBlockSize({ target, contentRect: { height: 16 } as DOMRectReadOnly, borderBoxSize: [{ blockSize: 32 }] })).toBe(32)
  })
  test('falls back to the bounding rect, then contentRect', () => {
    expect(observedBlockSize({ target, contentRect: { height: 16 } as DOMRectReadOnly })).toBe(32)
    const flat = { getBoundingClientRect: () => ({ height: 0 }) } as unknown as Element
    expect(observedBlockSize({ target: flat, contentRect: { height: 16.2 } as DOMRectReadOnly })).toBe(17)
  })
})

describe('collapsed group layout', () => {
  const groups = ['oct-10', 'oct-9', 'oct-8'].map((key) => ({ key, items: [{ id: `${key}-a` }, { id: `${key}-b` }] }))
  const headerHeight = observedBlockSize({
    target: { getBoundingClientRect: () => ({ height: 30 }) } as unknown as Element,
    contentRect: { height: 14 } as DOMRectReadOnly,
    borderBoxSize: [{ blockSize: 30 }],
  })
  const flat = flattenEntityListRows(groups, {
    getItemKey: (item: { id: string }) => item.id,
    rowHeight: 32,
    headerHeight,
    emptyLaneHeight: 40,
    collapsed: new Set(['oct-10', 'oct-9']),
    getRowHeight: () => undefined,
  })
  const headers = flat.entries.filter((entry) => entry.kind === 'header')

  test('collapsed headers are stacked in normal flow, one header height apart', () => {
    expect(headers.map((entry) => entry.offset)).toEqual([0, 30, 60])
    expect(flat.entries.filter((entry) => entry.kind === 'row')).toHaveLength(2)
  })

  test('a collapsed header slot spans exactly its own header, so it cannot stick over the next one', () => {
    const ends = groupEndByHeaderKey(flat.entries, flat.totalHeight)
    for (const [index, header] of headers.entries()) {
      const end = ends.get(header.key)!
      if (index < 2) expect(end - header.offset).toBe(headerHeight)
    }
    expect(flat.totalHeight).toBe(30 * 3 + 32 * 2)
  })
})
