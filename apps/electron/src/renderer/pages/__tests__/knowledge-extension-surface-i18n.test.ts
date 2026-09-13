import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { setupI18n } from '@craft-agent/shared/i18n/setupI18n'
import i18n from 'i18next'

const renderer = join(import.meta.dir, '../..')
const localesDir = join(import.meta.dir, '../../../../../../packages/shared/src/i18n/locales')

const SURFACE_KEYS = [
  'knowledge.surface.error',
  'extensions.surface.error',
  'extensions.surface.removed',
  'extensions.surface.loading',
  'extensions.surface.loadUrlHint',
  'extensions.surface.noViewSelected',
] as const

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

  it('Russian copy is distinct from English', async () => {
    await setupI18n().changeLanguage('ru')
    expect(i18n.t('knowledge.surface.error')).toBe('Не удалось загрузить документ')
    expect(i18n.t('extensions.surface.error')).toBe('Не удалось открыть поверхность расширения')
    expect(i18n.t('knowledge.surface.error')).not.toBe("Couldn't load the document")
  })

  it('all 12 locales already define the wired surface keys', () => {
    const files = readdirSync(localesDir).filter((name) => name.endsWith('.json')).sort()
    expect(files).toEqual([
      'ar.json',
      'de.json',
      'en.json',
      'es.json',
      'fr.json',
      'hu.json',
      'ja.json',
      'ko.json',
      'pl.json',
      'ru.json',
      'zh-Hans.json',
      'zh-Hant.json',
    ])
    for (const file of files) {
      const locale = JSON.parse(readFileSync(join(localesDir, file), 'utf8')) as Record<string, string>
      for (const key of SURFACE_KEYS) {
        expect(locale[key]?.length).toBeGreaterThan(0)
      }
    }
  })
})
