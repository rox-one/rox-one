import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const src = readFileSync(join(import.meta.dir, '../KnowledgeHome.tsx'), 'utf8')

describe('KnowledgeHome empty CTA tokens (P5.4)', () => {
  it('empty Rox Notes CTA avoids foreground alpha', () => {
    expect(src).toContain('EntityListEmptyScreen')
    expect(src).toContain('knowledge-open-rox-notes')
    const cta = src.slice(src.indexOf('knowledge-open-rox-notes') - 400, src.indexOf('knowledge-open-rox-notes') + 80)
    expect(cta).toContain('bg-surface-hover')
    expect(cta).not.toMatch(/bg-foreground\/\[/)
  })
})
