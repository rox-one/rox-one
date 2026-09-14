import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { setupI18n } from '@craft-agent/shared/i18n/setupI18n'
import i18n from 'i18next'
import { getSessionTitle } from '../session'

const source = readFileSync(join(import.meta.dir, '../session.ts'), 'utf8')
const localesDir = join(import.meta.dir, '../../../../../../packages/shared/src/i18n/locales')

const DEFAULT_TITLE_KEY = 'session.defaultTitle'

describe('P35-67 session default title leftover is i18n', () => {
  it('keeps catalog t() and drops the English second-arg leftover', () => {
    expect(source).toContain("i18next.t('session.defaultTitle')")
    expect(source).not.toContain("i18next.t('session.defaultTitle', 'New chat')")
    expect(source).not.toMatch(/i18next\.t\('session\.defaultTitle',\s*['"]New chat['"]\)/)
  })

  it('English locale matches the previous hardcoded leftover', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t(DEFAULT_TITLE_KEY)).toBe('New chat')
    expect(getSessionTitle({ name: undefined, preview: undefined })).toBe('New chat')
  })

  it('Russian copy is distinct from English', async () => {
    await setupI18n().changeLanguage('ru')
    expect(i18n.t(DEFAULT_TITLE_KEY)).toBe('Новый чат')
    expect(i18n.t(DEFAULT_TITLE_KEY)).not.toBe('New chat')
    expect(getSessionTitle({ name: undefined, preview: undefined })).toBe('Новый чат')
  })

  it('wires the existing key in all 12 locales', () => {
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
      expect(locale[DEFAULT_TITLE_KEY]?.length, `${file} ${DEFAULT_TITLE_KEY}`).toBeGreaterThan(0)
    }
  })
})
