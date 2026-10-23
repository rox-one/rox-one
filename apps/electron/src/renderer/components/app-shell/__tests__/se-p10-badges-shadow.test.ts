import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const src = readFileSync(
  join(import.meta.dir, '../ActiveOptionBadges.tsx'),
  'utf8',
)

describe('P10.2 ActiveOptionBadges quiet stacking shadow', () => {
  it('keeps a single hairline drop-shadow (no soft stack)', () => {
    expect(src).toContain("drop-shadow(0px 0px 0.5px rgba(var(--foreground-rgb), 0.25))")
    expect(src.includes('drop-shadow(0px 1px')).toBe(false)
    expect(src.includes('drop-shadow(0px 3px')).toBe(false)
  })
})
