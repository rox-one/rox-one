import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const home = readFileSync(join(import.meta.dir, '../KnowledgeHome.tsx'), 'utf8')

describe('knowledge home rejects SiYuan kernel install CTA', () => {
  it('routes empty state to Rox Notes and never opens SiYuan install docs', () => {
    expect(home).toContain("t('knowledge.roxNotes.emptyTitle')")
    expect(home).toContain("t('knowledge.roxNotes.openNotesCta')")
    expect(home).toContain('data-testid="knowledge-open-rox-notes"')
    expect(home).toContain('routes.view.notes()')
    expect(home).not.toContain('b3log.org/siyuan')
    expect(home).not.toContain("t('knowledge.kernel.installCta')")
    expect(home).not.toContain("t('knowledge.kernel.offlineTitle')")
  })
})
