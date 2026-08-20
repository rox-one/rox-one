import { describe, expect, it } from 'bun:test'
import { applySlice, BUILTIN_SLICES, filtersSignature, matchingSliceId, sliceMatches } from '../collection-slices'

describe('collection-slices', () => {
  it('matches unread and toggles off', () => {
    const unread = BUILTIN_SLICES[0]
    const next = applySlice({}, unread)
    expect(next).toEqual({ hasUnread: true })
    expect(sliceMatches(next, unread)).toBe(true)
    expect(applySlice(next, unread)).toEqual({})
  })

  it('identifies overdue among builtins', () => {
    expect(matchingSliceId({ due: { type: 'overdue' } })).toBe('overdue')
    expect(matchingSliceId({ status: ['todo'] })).toBe(null)
  })

  it('treats array order as irrelevant', () => {
    expect(filtersSignature({ status: ['b', 'a'] })).toBe(filtersSignature({ status: ['a', 'b'] }))
  })
})
