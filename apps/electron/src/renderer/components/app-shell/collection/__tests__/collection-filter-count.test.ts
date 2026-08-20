import { describe, expect, it } from 'bun:test'
import { activeFilterCount } from '../collection-filter-count'

describe('activeFilterCount', () => {
  it('is zero for empty filters', () => {
    expect(activeFilterCount({})).toBe(0)
  })

  it('counts each selected value', () => {
    expect(activeFilterCount({
      status: ['todo', 'done'],
      priority: ['high'],
      labels: ['a', 'b', 'c'],
      due: { type: 'today' },
      flagged: true,
    })).toBe(8)
  })
})
