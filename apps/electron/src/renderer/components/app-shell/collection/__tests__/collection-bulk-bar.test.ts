import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const SOURCE = readFileSync(join(__dirname, '..', 'CollectionBulkBar.tsx'), 'utf8')

describe('CollectionBulkBar premium menus', () => {
  it('replaces native selects with PremiumMenuSelect', () => {
    expect(SOURCE).toContain('PremiumMenuSelect')
    expect(SOURCE).not.toContain('<select')
  })
})
