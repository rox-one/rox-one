import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const body = readFileSync(join(import.meta.dir, '../KnowledgeHome.tsx'), 'utf8')

describe('KnowledgeHome empty (P5.4)', () => {
  it('uses EntityListEmptyScreen for Rox Notes connection empty', () => {
    expect(body).toContain('EntityListEmptyScreen')
    expect(body).toContain('knowledge.roxNotes.emptyTitle')
    expect(body).toContain('knowledge-open-rox-notes')
    expect(body).not.toMatch(/Arc Glass: kernel\/connection empty/)
  })
})
