import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { setupI18n } from '@craft-agent/shared/i18n/setupI18n'
import i18n from 'i18next'
import {
  CONATION_OPEN_BOARD_COMMAND_ID,
  CONATION_OPEN_FUND_COMMAND_ID,
} from '../omnibox-conation'

const platformDir = join(import.meta.dir, '..')
const localesDir = join(import.meta.dir, '../../../../../../packages/shared/src/i18n/locales')

const CATALOG_KEYS = [
  'conation.board.open',
  'conation.fund.open',
  'knowledge.openCompat',
  'knowledge.openHome',
  'knowledge.search',
  'omnibox.category.siyuanPlugin',
  'settings.appearance.conationShell',
  'sidebar.knowledge',
  'siyuan.openCompat',
] as const

const ENGLISH_LEFTOVERS = [
  'Open Fund in Conation',
  'Open Board in Conation',
  "title: 'Open Knowledge'",
  "title: 'Search Knowledge'",
  "title: 'Open SiYuan compatibility view'",
  "category: 'Knowledge'",
  "category: 'SiYuan Plugin'",
  "label('settings.appearance.conationShell', 'Conation')",
] as const

function source(): string {
  return readFileSync(join(platformDir, 'omnibox-bootstrap.ts'), 'utf8')
}

describe('omnibox bootstrap labels are i18n', () => {
  it('uses catalog keys and identifier fallbacks, not English leftover defaultValue', () => {
    const text = source()

    expect(text).toContain("catalogLabel(t, 'conation.fund.open', CONATION_OPEN_FUND_COMMAND_ID)")
    expect(text).toContain("catalogLabel(t, 'conation.board.open', CONATION_OPEN_BOARD_COMMAND_ID)")
    expect(text).toContain("catalogLabel(t, 'settings.appearance.conationShell', 'conation')")
    expect(text).toContain('t ? t(key, identifier) : identifier')

    expect(text).toContain("i18n.t('knowledge.openHome')")
    expect(text).toContain("i18n.t('knowledge.search')")
    expect(text).toContain("i18n.t('knowledge.openCompat')")
    expect(text).toContain("i18n.t('siyuan.openCompat')")
    expect(text).toContain("i18n.t('sidebar.knowledge')")
    expect(text).toContain("i18n.t('omnibox.category.siyuanPlugin')")

    for (const leftover of ENGLISH_LEFTOVERS) {
      expect(text).not.toContain(leftover)
    }
    expect(text).not.toContain('defaultValue:')
    expect(text).not.toContain("defaultValue: '")
  })

  it('English locale keeps the existing palette labels', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t('conation.fund.open')).toBe('Open Fund in Conation')
    expect(i18n.t('conation.board.open')).toBe('Open Board in Conation')
    expect(i18n.t('settings.appearance.conationShell')).toBe('Conation')
    expect(i18n.t('knowledge.openHome')).toBe('Open Knowledge')
    expect(i18n.t('knowledge.search')).toBe('Search Knowledge')
    expect(i18n.t('knowledge.openCompat')).toBe('Open compatibility view')
    expect(i18n.t('siyuan.openCompat')).toBe('Open SiYuan compatibility view')
    expect(i18n.t('sidebar.knowledge')).toBe('Knowledge')
    expect(i18n.t('omnibox.category.siyuanPlugin')).toBe('SiYuan Plugin')
    expect(CONATION_OPEN_FUND_COMMAND_ID).toBe('conation.openFund')
    expect(CONATION_OPEN_BOARD_COMMAND_ID).toBe('conation.openBoard')
  })

  it('Russian copy is distinct from English', async () => {
    await setupI18n().changeLanguage('ru')
    expect(i18n.t('conation.fund.open')).toBe('Открыть Fund в Conation')
    expect(i18n.t('knowledge.openHome')).toBe('Открыть знания')
    expect(i18n.t('knowledge.search')).toBe('Искать в знаниях')
    expect(i18n.t('omnibox.category.siyuanPlugin')).toBe('Плагин SiYuan')
    expect(i18n.t('sidebar.knowledge')).toBe('Знания')
    expect(i18n.t('conation.fund.open')).not.toBe('Open Fund in Conation')
    expect(i18n.t('knowledge.openHome')).not.toBe('Open Knowledge')
  })

  it('all 12 locales define the wired bootstrap keys', () => {
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
      for (const key of CATALOG_KEYS) {
        expect(locale[key]?.length).toBeGreaterThan(0)
      }
    }
  })
})
