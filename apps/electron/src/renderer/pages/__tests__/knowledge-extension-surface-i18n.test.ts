import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { setupI18n } from '@craft-agent/shared/i18n/setupI18n'
import i18n from 'i18next'

const renderer = join(import.meta.dir, '../..')

function read(rel: string): string {
  return readFileSync(join(renderer, rel), 'utf8')
}

describe('Knowledge/Extension surface fallbacks are i18n', () => {
  it('uses existing surface keys and skips English defaultValue leftovers', () => {
    const knowledge = read('pages/KnowledgeSurfacePage.tsx')
    const extension = read('pages/ExtensionSurfacePage.tsx')
    const panel = read('components/app-shell/MainContentPanel.tsx')

    expect(knowledge).toContain("t('knowledge.surface.error')")
    expect(knowledge).not.toContain('Failed to open knowledge surface')
    expect(knowledge).not.toContain('defaultValue:')

    expect(extension).toContain("t('extensions.surface.error')")
    expect(extension).toContain("t('extensions.surface.removed')")
    expect(extension).toContain("t('extensions.surface.loading')")
    expect(extension).toContain("t('extensions.surface.loadUrlHint')")
    expect(extension).not.toContain('Failed to open extension surface')
    expect(extension).not.toContain('Extension surface closed')
    expect(extension).not.toContain('Loading extension surface')
    expect(extension).not.toContain('No URL configured for this extension view')
    expect(extension).not.toContain('defaultValue:')

    expect(panel).toContain("t('extensions.surface.noViewSelected')")
    expect(panel).not.toContain('Select an extension view to open')
  })

  it('English locale keeps the existing surface copy', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t('knowledge.surface.error')).toBe("Couldn't load the document")
    expect(i18n.t('extensions.surface.error')).toBe('Failed to open extension surface')
    expect(i18n.t('extensions.surface.removed')).toBe('Extension surface closed')
    expect(i18n.t('extensions.surface.loading')).toBe('Loading extension surface…')
    expect(i18n.t('extensions.surface.loadUrlHint')).toBe('Load extension UI URL')
    expect(i18n.t('extensions.surface.noViewSelected')).toBe('No extension view selected')
  })
})
