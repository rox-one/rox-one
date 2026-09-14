import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import i18n from 'i18next'
import { setupI18n } from '../setupI18n'

const KEY = 'editor.failedToReadFileAsDataUrl'
const localesDir = join(import.meta.dir, '../locales')

describe('P35-180 leftover data URL wrapping in editor.failedToReadFileAsDataUrl', () => {
  it('wraps leftover data URL as hyphenated data-URL in Russian', () => {
    const ru = JSON.parse(readFileSync(join(localesDir, 'ru.json'), 'utf8')) as Record<string, string>
    expect(ru[KEY]).toBe('Не удалось прочитать файл как data-URL')
    expect(ru[KEY]).not.toMatch(/data URL/)
    expect(ru[KEY]).toContain('data-URL')
    expect(ru[KEY]).not.toContain('URL данных')
  })

  it('keeps English data URL as English', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe('Failed to read file as data URL')
    expect(i18n.t(KEY)).toContain('data URL')
    expect(i18n.t(KEY)).not.toContain('data-URL')
  })

  it('Russian runtime copy is distinct from leftover English', async () => {
    await setupI18n().changeLanguage('ru')
    expect(i18n.t(KEY)).toBe('Не удалось прочитать файл как data-URL')
    expect(i18n.t(KEY)).not.toMatch(/data URL/)
    expect(i18n.t(KEY)).not.toBe(i18n.t(KEY, { lng: 'en' }))
    expect(i18n.t(KEY)).not.toBe('Failed to read file as data URL')
    expect(i18n.t(KEY)).not.toBe('Не удалось прочитать файл как data URL')
  })

  it('defines the key in all 12 locales', () => {
    const files = readdirSync(localesDir).filter((name) => name.endsWith('.json')).sort()
    expect(files).toHaveLength(12)
    for (const file of files) {
      const locale = JSON.parse(readFileSync(join(localesDir, file), 'utf8')) as Record<string, string>
      expect(locale[KEY]?.length, file).toBeGreaterThan(0)
    }
  })
})
