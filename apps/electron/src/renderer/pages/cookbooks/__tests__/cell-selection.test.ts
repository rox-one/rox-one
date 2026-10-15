/**
 * Wave 14 (F2): the multi-cell selection model — `cell-selection.ts`.
 *
 * Every case here is a statement about which cells are selected, expressed as
 * numbers: the page owns the gestures, this module owns the range arithmetic.
 */
import { describe, expect, it } from 'bun:test'
import {
  clampIndex,
  collapseSelection,
  extendSelection,
  normalizeSelection,
  selectedIndices,
  type CellSelection,
} from '../cell-selection'

describe('clampIndex', () => {
  it('clamps into the document bounds', () => {
    expect(clampIndex(-5, 4)).toBe(0)
    expect(clampIndex(0, 4)).toBe(0)
    expect(clampIndex(3, 4)).toBe(3)
    expect(clampIndex(9, 4)).toBe(3)
  })

  it('answers 0 for an empty document', () => {
    expect(clampIndex(4, 0)).toBe(0)
    expect(clampIndex(-1, 0)).toBe(0)
  })
})

describe('normalizeSelection', () => {
  it('passes null through and drops any selection in an empty document', () => {
    expect(normalizeSelection(null, 4)).toBeNull()
    expect(normalizeSelection({ focus: 0, anchor: null }, 0)).toBeNull()
    expect(normalizeSelection({ focus: 2, anchor: 1 }, 0)).toBeNull()
  })

  it('clamps both the focus and the anchor', () => {
    expect(normalizeSelection({ focus: 9, anchor: null }, 4)).toEqual({ focus: 3, anchor: null })
    expect(normalizeSelection({ focus: -2, anchor: 7 }, 4)).toEqual({ focus: 0, anchor: 3 })
  })

  it('keeps a null anchor null (a single-cell selection)', () => {
    expect(normalizeSelection({ focus: 2, anchor: null }, 4)).toEqual({ focus: 2, anchor: null })
  })
})

describe('selectedIndices', () => {
  it('reports nothing for no selection or an empty document', () => {
    expect(selectedIndices(null, 4)).toEqual([])
    expect(selectedIndices({ focus: 0, anchor: null }, 0)).toEqual([])
  })

  it('reports a single index for a focus with no anchor', () => {
    expect(selectedIndices({ focus: 2, anchor: null }, 4)).toEqual([2])
  })

  it('reports an ascending, inclusive range regardless of anchor order', () => {
    expect(selectedIndices({ focus: 0, anchor: 2 }, 4)).toEqual([0, 1, 2])
    expect(selectedIndices({ focus: 2, anchor: 0 }, 4)).toEqual([0, 1, 2])
    expect(selectedIndices({ focus: 3, anchor: 1 }, 4)).toEqual([1, 2, 3])
  })

  it('treats anchor === focus as a single-cell selection', () => {
    expect(selectedIndices({ focus: 1, anchor: 1 }, 4)).toEqual([1])
  })

  it('clamps an out-of-range range to the document bounds', () => {
    expect(selectedIndices({ focus: -3, anchor: 9 }, 3)).toEqual([0, 1, 2])
  })
})

describe('extendSelection', () => {
  it('initializes the anchor to the current focus on the first extension', () => {
    expect(extendSelection({ focus: 1, anchor: null }, 3)).toEqual({ focus: 3, anchor: 1 })
  })

  it('keeps an existing anchor and only moves the focus', () => {
    expect(extendSelection({ focus: 3, anchor: 1 }, 0)).toEqual({ focus: 0, anchor: 1 })
  })

  it('is idempotent for a repeated focus', () => {
    const once = extendSelection({ focus: 1, anchor: null }, 2)
    expect(extendSelection(once, 2)).toEqual({ focus: 2, anchor: 1 })
    // A no-op extension keeps the same range.
    expect(selectedIndices(extendSelection(once, 2), 5)).toEqual([1, 2])
  })
})

describe('collapseSelection', () => {
  it('passes null through', () => {
    expect(collapseSelection(null)).toBeNull()
  })

  it('drops the anchor, keeping the focus as a single-cell selection', () => {
    const collapsed = collapseSelection({ focus: 3, anchor: 1 } as CellSelection)
    expect(collapsed).toEqual({ focus: 3, anchor: null })
    expect(selectedIndices(collapsed, 5)).toEqual([3])
  })
})
