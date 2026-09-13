import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { setupI18n } from '@craft-agent/shared/i18n/setupI18n'
import i18n from 'i18next'

const chips = readFileSync(join(import.meta.dir, '../CollectionFilterChips.tsx'), 'utf8')
const localesDir = join(import.meta.dir, '../../../../../../../../packages/shared/src/i18n/locales')

const FILTER_CHIP_KEYS = ['collection.filter.project', 'collection.filter.label'] as const

describe('CollectionFilterChips group labels are i18n', () => {
  it('uses existing filter keys and skips English defaultValue leftovers', () => {
    expect(chips).toContain("t('collection.filter.project')")
    expect(chips).toContain("t('collection.filter.label')")
    expect(chips).not.toContain("defaultValue: 'Project'")
    expect(chips).not.toContain("defaultValue: 'Label'")
    expect(chips).not.toContain("t('collection.filter.project', { defaultValue: 'Project' })")
    expect(chips).not.toContain("t('collection.filter.label', { defaultValue: 'Label' })")
  })

  it('English locale keeps the previous chip group labels', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t('collection.filter.project')).toBe('Project')
    expect(i18n.t('collection.filter.label')).toBe('Label')
  })

  it('Russian copy is distinct from English', async () => {
    await setupI18n().changeLanguage('ru')
    expect(i18n.t('collection.filter.project')).toBe('Проект')
    expect(i18n.t('collection.filter.label')).toBe('Метка')
    expect(i18n.t('collection.filter.project')).not.toBe('Project')
    expect(i18n.t('collection.filter.label')).not.toBe('Label')
  })

  it('all 12 locales already define the wired filter chip keys', () => {
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
      for (const key of FILTER_CHIP_KEYS) {
        expect(locale[key]?.length).toBeGreaterThan(0)
      }
    }
  })
})
