import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const files = [
  'collection-menu-row.tsx',
  'CollectionFilterChips.tsx',
  'CollectionFilterMenu.tsx',
  'CollectionDisplayPopover.tsx',
  'CollectionBulkBar.tsx',
  'CollectionBulkMenu.tsx',
]

describe('P6.2 collection selection fill (SE)', () => {
  it('uses surface-hover/selected, not foreground-alpha fills', () => {
    for (const name of files) {
      const src = readFileSync(join(import.meta.dir, '..', name), 'utf8')
      expect(src.includes('bg-foreground/['), `${name} still has bg-foreground/[`).toBe(false)
      expect(src.includes('hover:bg-foreground/['), `${name} still has hover fg`).toBe(false)
    }
    const row = readFileSync(join(import.meta.dir, '../collection-menu-row.tsx'), 'utf8')
    expect(row).toContain('bg-surface-selected')
    expect(row).toContain('hover:bg-surface-hover')
  })
})
