import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { setupI18n } from '@craft-agent/shared/i18n/setupI18n'
import i18n from 'i18next'

const sessionList = readFileSync(join(import.meta.dir, '../../SessionList.tsx'), 'utf8')
const grouping = readFileSync(join(import.meta.dir, '../list-grouping.ts'), 'utf8')
const localesDir = join(import.meta.dir, '../../../../../../../../packages/shared/src/i18n/locales')

const STATIC_KEYS = [
  'collection.display.labelNone',
  'sidebar.noProject',
  'sidebar.unknownProject',
] as const

describe('P35-53 SessionList / list-grouping leftover chrome is i18n', () => {
  it('does not inject English string defaultValue leftovers', () => {
    expect(sessionList).not.toMatch(/defaultValue:\s*['"]/)
    expect(grouping).not.toMatch(/defaultValue:\s*['"]/)
    expect(sessionList).not.toContain("defaultValue: 'Unknown project'")
    expect(sessionList).not.toContain("defaultValue: 'No project'")
    expect(sessionList).not.toContain("defaultValue: 'No label'")
    expect(grouping).not.toContain("defaultValue: 'No project'")
    expect(grouping).not.toContain("defaultValue: 'No label'")
  })

  it('keeps t() callsites on the existing grouping keys', () => {
    expect(sessionList).toContain("t('sidebar.unknownProject')")
    expect(sessionList).toContain("t('sidebar.noProject')")
    expect(sessionList).toContain("t('collection.display.labelNone')")
    expect(grouping).toContain("t('sidebar.noProject')")
    expect(grouping).toContain("t('collection.display.labelNone')")
    expect(grouping).toContain('t(`status.${status.id}`, { defaultValue: status.label })')
    expect(sessionList).toContain('t(`priority.${priority}`, { defaultValue: priority })')
    expect(grouping).toContain('t(`priority.${priority}`, { defaultValue: priority })')
    expect(sessionList).toContain(
      't(`collection.display.dueBucket.${bucket}`, { defaultValue: bucket })',
    )
    expect(grouping).toContain(
      't(`collection.display.dueBucket.${bucket}`, { defaultValue: bucket })',
    )
  })

  it('English locale matches the previous hardcoded leftovers', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t('sidebar.unknownProject')).toBe('Unknown project')
    expect(i18n.t('sidebar.noProject')).toBe('No project')
    expect(i18n.t('collection.display.labelNone')).toBe('No label')
  })

  it('Russian copy is distinct from English', async () => {
    await setupI18n().changeLanguage('ru')
    expect(i18n.t('sidebar.unknownProject')).toBe('Неизвестный проект')
    expect(i18n.t('sidebar.noProject')).toBe('Без проекта')
    expect(i18n.t('collection.display.labelNone')).toBe('Без метки')
    expect(i18n.t('sidebar.unknownProject')).not.toBe('Unknown project')
    expect(i18n.t('sidebar.noProject')).not.toBe('No project')
    expect(i18n.t('collection.display.labelNone')).not.toBe('No label')
  })

  it('wires static keys in all 12 locales', () => {
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
      for (const key of STATIC_KEYS) {
        expect(locale[key]?.length, `${file} ${key}`).toBeGreaterThan(0)
      }
    }
  })
})
