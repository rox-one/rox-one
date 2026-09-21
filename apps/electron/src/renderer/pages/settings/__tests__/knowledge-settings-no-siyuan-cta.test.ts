import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const page = readFileSync(join(import.meta.dir, '../KnowledgeSettingsPage.tsx'), 'utf8')

describe('knowledge settings rejects SiYuan kernel install CTA', () => {
  it('points at Rox Notes and never starts or installs SiYuan', () => {
    expect(page).toContain("t('knowledge.roxNotes.openNotesCta')")
    expect(page).toContain('data-testid="settings-knowledge-open-rox-notes"')
    expect(page).not.toContain("t('knowledge.kernel.installCta')")
    expect(page).not.toContain("t('knowledge.kernel.startCta')")
    expect(page).not.toContain('engineStart')
    expect(page).not.toContain('b3log.org')
    expect(page).not.toContain('siyuan-not-installed')
  })
})
