import { describe, expect, it } from 'bun:test'
import { groupHeaderCount } from '../entity-list'

describe('groupHeaderCount', () => {
  it('uses live item length when expanded', () => {
    expect(groupHeaderCount(false, 4, 99)).toBe(4)
  })

  it('uses collapsedCount when collapsed', () => {
    expect(groupHeaderCount(true, 0, 7)).toBe(7)
  })

  it('falls back to zero when collapsed without a count', () => {
    expect(groupHeaderCount(true, 0)).toBe(0)
  })
})
