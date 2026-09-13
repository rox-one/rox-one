import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { setupI18n } from '@craft-agent/shared/i18n/setupI18n'
import i18n from 'i18next'

const platformDir = join(import.meta.dir, '..')
const localesDir = join(import.meta.dir, '../../../../../../packages/shared/src/i18n/locales')

const OMNIBOX_KEYS = [
  'omnibox.context.open',
  'omnibox.empty',
  'omnibox.placeholder',
  'omnibox.prefix.automations',
  'omnibox.prefix.commands',
  'omnibox.prefix.labels',
  'omnibox.prefix.mentions',
  'omnibox.prefix.search',
  'omnibox.prefix.skills',
  'omnibox.section.actions',
  'omnibox.section.context',
  'omnibox.section.navigation',
] as const

function source(): string {
  return readFileSync(join(platformDir, 'Omnibox.tsx'), 'utf8')
}

describe('omnibox chrome labels are i18n', () => {
  it('uses catalog keys and skips English leftover defaultValue', () => {
    const text = source()

    for (const key of OMNIBOX_KEYS) {
      expect(text).toContain(`t('${key}'`)
    }
    expect(text).not.toContain('defaultValue:')
  })

  it('English locale keeps the existing chrome labels', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t('omnibox.placeholder')).toBe('Search or jump to…')
    expect(i18n.t('omnibox.empty')).toBe('No results')
    expect(i18n.t('omnibox.prefix.commands')).toBe('Search commands…')
    expect(i18n.t('omnibox.section.navigation')).toBe('Navigation')
    expect(i18n.t('omnibox.section.context')).toBe('Context')
    expect(i18n.t('omnibox.section.actions')).toBe('Actions')
    expect(i18n.t('omnibox.context.open', { title: 'Notes' })).toBe('Open “Notes”')
  })

  it('Russian copy is distinct from English', async () => {
    await setupI18n().changeLanguage('ru')
    expect(i18n.t('omnibox.placeholder')).toBe('Поиск или переход…')
    expect(i18n.t('omnibox.empty')).toBe('Ничего не найдено')
    expect(i18n.t('omnibox.section.navigation')).toBe('Навигация')
    expect(i18n.t('omnibox.placeholder')).not.toBe('Search or jump to…')
  })

  it('all 12 locales already define the wired omnibox keys', () => {
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
      for (const key of OMNIBOX_KEYS) {
        expect(locale[key]?.length).toBeGreaterThan(0)
      }
    }
  })
})
