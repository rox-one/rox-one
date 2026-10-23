/**
 * Wave 13 (F8): `pickActiveEntry` — the outline scroll-spy as a pure decision.
 *
 * Every case here is a statement about which heading a reader is in, expressed
 * as numbers: the page measures the offsets, this function owns the meaning.
 */
import { describe, expect, it } from 'bun:test'
import { numberHeadings, pickActiveEntry } from '../scroll-spy'

describe('pickActiveEntry', () => {
  it('reports nothing for a document with no outline', () => {
    expect(pickActiveEntry([], 0)).toBeNull()
    expect(pickActiveEntry([], 900)).toBeNull()
  })

  it('makes the first entry current at the top of the document', () => {
    expect(pickActiveEntry([0, 120, 640], 0)).toBe(0)
  })

  it('makes the first entry current while the reader is above every heading', () => {
    // The first heading sits below the fold: no entry has been reached yet, so
    // the outline still points at the top of the document rather than nowhere.
    expect(pickActiveEntry([40, 300, 900], 0)).toBe(0)
    expect(pickActiveEntry([40, 300, 900], 35)).toBe(0)
  })

  it('picks the last entry at or above the scroll offset', () => {
    const offsets = [0, 120, 640, 1200]
    expect(pickActiveEntry(offsets, 0)).toBe(0)
    expect(pickActiveEntry(offsets, 115)).toBe(0)
    expect(pickActiveEntry(offsets, 635)).toBe(1)
    expect(pickActiveEntry(offsets, 640)).toBe(2)
    expect(pickActiveEntry(offsets, 1195)).toBe(2)
    expect(pickActiveEntry(offsets, 1200)).toBe(3)
  })

  it('counts a heading as reached within the four-pixel slack', () => {
    const offsets = [0, 100]
    // 100 <= 96 + 4 — the heading is at the very edge and counts.
    expect(pickActiveEntry(offsets, 96)).toBe(1)
    // 100 <= 95 + 4 is false — the heading is still below the edge.
    expect(pickActiveEntry(offsets, 95)).toBe(0)
  })

  it('keeps the last entry current past the end of the document', () => {
    const offsets = [0, 120, 640]
    expect(pickActiveEntry(offsets, 640)).toBe(2)
    expect(pickActiveEntry(offsets, 100_000)).toBe(2)
  })

  it('handles a single-entry outline at both ends', () => {
    expect(pickActiveEntry([0], 0)).toBe(0)
    expect(pickActiveEntry([0], 5_000)).toBe(0)
    expect(pickActiveEntry([64], 0)).toBe(0)
    expect(pickActiveEntry([64], 60)).toBe(0)
  })

  it('survives a negative scroll offset (rubber-band overscroll)', () => {
    expect(pickActiveEntry([0, 120], -80)).toBe(0)
  })

  it('takes offsets in document order and reports the deepest match', () => {
    // Two headings of the same cell land on the same offset; both are `<=` the
    // boundary, so the later one wins — the reader is in the lower section.
    expect(pickActiveEntry([0, 0, 0], 0)).toBe(2)
  })
})

describe('numberHeadings', () => {
  it('answers nothing for a document with no headings', () => {
    expect(numberHeadings([])).toEqual([])
  })

  it('numbers one counter per level, joined with dots', () => {
    expect(numberHeadings([1])).toEqual(['1'])
    expect(numberHeadings([1, 2, 3])).toEqual(['1', '1.1', '1.1.1'])
    // Siblings share the parent and count up on their own level.
    expect(numberHeadings([1, 2, 2, 3, 2])).toEqual(['1', '1.1', '1.2', '1.2.1', '1.3'])
  })

  it('resets every deeper counter when a shallower heading arrives', () => {
    // The H1 after `1.1.1` starts the count over; its own H2 numbers `2.1`.
    expect(numberHeadings([1, 2, 3, 1, 2])).toEqual(['1', '1.1', '1.1.1', '2', '2.1'])
    expect(numberHeadings([1, 2, 1, 2, 1])).toEqual(['1', '1.1', '2', '2.1', '3'])
  })

  it('counts a skipped level as the first child of the level it skipped', () => {
    // `HEADING_PATTERN` stops at H3, so an H1 followed by an H3 is legal — the
    // numerals stay contiguous rather than carrying a hole.
    expect(numberHeadings([1, 3])).toEqual(['1', '1.1.1'])
  })

  it('clamps a level into the 1..6 range Markdown defines', () => {
    // Below the first level counts as the first; above the sixth counts as six.
    expect(numberHeadings([0, -3])).toEqual(['1', '2'])
    expect(numberHeadings([2, 6])).toEqual(['1.1', '1.1.1.1.1.1'])
  })
})
