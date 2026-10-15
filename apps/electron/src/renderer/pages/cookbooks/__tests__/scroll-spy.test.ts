/**
 * Wave 13 (F8): `pickActiveEntry` — the outline scroll-spy as a pure decision.
 *
 * Every case here is a statement about which heading a reader is in, expressed
 * as numbers: the page measures the offsets, this function owns the meaning.
 */
import { describe, expect, it } from 'bun:test'
import { pickActiveEntry } from '../scroll-spy'

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
