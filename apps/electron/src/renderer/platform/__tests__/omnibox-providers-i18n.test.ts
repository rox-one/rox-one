import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { setupI18n } from '@craft-agent/shared/i18n/setupI18n'
import i18n from 'i18next'
import {
  createAutomationsProvider,
  createKnowledgeProvider,
  createSessionsProvider,
  createSettingsProvider,
  createSkillsProvider,
  createSourcesProvider,
} from '../omnibox-providers'

const platformDir = join(import.meta.dir, '..')
const localesDir = join(import.meta.dir, '../../../../../../packages/shared/src/i18n/locales')

const SECTION_KEYS = [
  'sidebar.allSessions',
  'sidebar.settings',
  'sidebar.skills',
  'sidebar.sources',
  'sidebar.automations',
  'sidebar.knowledge',
] as const

function source(): string {
  return readFileSync(join(platformDir, 'omnibox-providers.ts'), 'utf8')
}

describe('omnibox provider section labels are i18n', () => {
  it('uses existing sidebar keys and skips English leftover labels', () => {
    const text = source()

    expect(text).toContain("i18n.t('sidebar.allSessions')")
    expect(text).toContain("i18n.t('sidebar.settings')")
    expect(text).toContain("i18n.t('sidebar.skills')")
    expect(text).toContain("i18n.t('sidebar.sources')")
    expect(text).toContain("i18n.t('sidebar.automations')")
    expect(text).toContain("i18n.t('sidebar.knowledge')")

    expect(text).not.toContain("label: 'Sessions'")
    expect(text).not.toContain("label: 'Settings'")
    expect(text).not.toContain("label: 'Skills'")
    expect(text).not.toContain("label: 'Sources'")
    expect(text).not.toContain("label: 'Automations'")
    expect(text).not.toContain("label: 'Knowledge'")
    expect(text).not.toContain('i18n.t(\'sidebar.allSessions\', ')
    expect(text).not.toContain('defaultValue:')
  })

  it('English locale keeps the existing section labels', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t('sidebar.allSessions')).toBe('Sessions')
    expect(i18n.t('sidebar.settings')).toBe('Settings')
    expect(i18n.t('sidebar.skills')).toBe('Skills')
    expect(i18n.t('sidebar.sources')).toBe('Sources')
    expect(i18n.t('sidebar.automations')).toBe('Automations')
    expect(i18n.t('sidebar.knowledge')).toBe('Knowledge')

    expect(createSessionsProvider(() => [], () => '').label).toBe('Sessions')
    expect(createSettingsProvider([], () => '').label).toBe('Settings')
    expect(createSkillsProvider(() => [], () => '').label).toBe('Skills')
    expect(createSourcesProvider(() => [], () => '').label).toBe('Sources')
    expect(createAutomationsProvider(() => [], () => '').label).toBe('Automations')
    expect(createKnowledgeProvider(async () => []).label).toBe('Knowledge')
  })

  it('Russian copy is distinct from English', async () => {
    await setupI18n().changeLanguage('ru')
    expect(i18n.t('sidebar.allSessions')).toBe('Сессии')
    expect(i18n.t('sidebar.settings')).toBe('Настройки')
    expect(i18n.t('sidebar.skills')).toBe('Навыки')
    expect(i18n.t('sidebar.sources')).toBe('Источники')
    expect(i18n.t('sidebar.automations')).toBe('Автоматизации')
    expect(i18n.t('sidebar.knowledge')).toBe('Знания')
    expect(i18n.t('sidebar.allSessions')).not.toBe('Sessions')
    expect(createSessionsProvider(() => [], () => '').label).toBe('Сессии')
    expect(createKnowledgeProvider(async () => []).label).toBe('Знания')
  })

  it('all 12 locales already define the wired sidebar keys', () => {
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
      for (const key of SECTION_KEYS) {
        expect(locale[key]?.length).toBeGreaterThan(0)
      }
    }
  })
})
