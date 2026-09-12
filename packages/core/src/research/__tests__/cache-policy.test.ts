import { describe, expect, it } from 'bun:test'
import { decideResearchCache, shouldPersistResearchHit } from '../index.ts'

describe('research cache policy', () => {
  it('stores locally only when search-cache consent is explicit', () => {
    expect(decideResearchCache(undefined)).toBe('none')
    expect(decideResearchCache({})).toBe('none')
    expect(decideResearchCache({ aiIndexing: true, productImprovement: true })).toBe('none')
    expect(decideResearchCache({ searchCache: false })).toBe('none')
    expect(decideResearchCache({ searchCache: true })).toBe('local')
    expect(shouldPersistResearchHit({ searchCache: true })).toBe(true)
    expect(shouldPersistResearchHit({ searchCache: false })).toBe(false)
  })
})
