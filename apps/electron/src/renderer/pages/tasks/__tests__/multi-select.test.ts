import { describe, expect, it } from 'bun:test'
import { orderedSelection, pruneSelection, rangeSelection, toggleInSelection } from '../multi-select'

const order = ['a', 'b', 'c', 'd', 'e']

describe('multi-select', () => {
  it('toggles ids and seeds the focused row on the first ⌘-click', () => {
    expect([...toggleInSelection(new Set(), 'c', 'a')].sort()).toEqual(['a', 'c'])
    expect([...toggleInSelection(new Set(), 'a', 'a')]).toEqual(['a'])
    expect([...toggleInSelection(new Set(['a', 'c']), 'c', 'a')]).toEqual(['a'])
    expect([...toggleInSelection(new Set(), 'b', null)]).toEqual(['b'])
  })

  it('selects an inclusive range in either direction', () => {
    expect([...rangeSelection(order, 'b', 'd')]).toEqual(['b', 'c', 'd'])
    expect([...rangeSelection(order, 'd', 'b')]).toEqual(['b', 'c', 'd'])
    expect([...rangeSelection(order, null, 'c')]).toEqual(['c'])
    expect([...rangeSelection(order, 'gone', 'c')]).toEqual(['c'])
    expect(rangeSelection(order, 'a', 'missing').size).toBe(0)
  })

  it('prunes hidden ids and keeps identity when nothing changed', () => {
    const sel = new Set(['a', 'c'])
    expect(pruneSelection(sel, order)).toBe(sel)
    expect([...pruneSelection(new Set(['a', 'x']), order)]).toEqual(['a'])
    const empty = new Set<string>()
    expect(pruneSelection(empty, [])).toBe(empty)
  })

  it('returns selection in visible order', () => {
    expect(orderedSelection(new Set(['e', 'a', 'c']), order)).toEqual(['a', 'c', 'e'])
  })
})
