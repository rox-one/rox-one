import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('gamification storage session ratings', () => {
  it('normalizes persisted scores with normalizeSessionRatingScore (1-100)', () => {
    const src = readFileSync(join(import.meta.dir, 'storage.ts'), 'utf8')
    expect(src).toContain('normalizeSessionRatingScore(rec.score)')
    expect(src).not.toContain('score !== 1 && score !== 2 && score !== 3 && score !== 4 && score !== 5')
  })
})
