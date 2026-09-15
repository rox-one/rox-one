import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import i18n from 'i18next'
import { setupI18n } from '../setupI18n'

const localesDir = join(import.meta.dir, '../locales')

const KEY = 'extensions.surface.loadUrlHint' as const

const RU = 'Загрузить URL интерфейса расширения'
const EN = 'Load extension UI URL'
const LEFTOVER_RU = 'Загрузить URL UI расширения'

describe('P35-193 leftover URL UI wrapping in extension loadUrlHint', () => {
  it('wraps leftover UI as интерфейса around the Latin URL identifier', () => {
    const ru = JSON.parse(readFileSync(join(localesDir, 'ru.json'), 'utf8')) as Record<string, string>
    expect(ru[KEY]).toBe(RU)
    expect(ru[KEY]).toContain('URL')
    expect(ru[KEY]).toContain('интерфейса')
    expect(ru[KEY]).not.toContain(' UI ')
    expect(ru[KEY]).not.toBe(LEFTOVER_RU)
    expect(ru[KEY]).not.toBe(EN)
  })

  it('keeps English URL UI copy as English', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.resolvedLanguage).toBe('en')
    expect(i18n.t(KEY)).toBe(EN)
    expect(i18n.t(KEY)).toContain('UI URL')
    expect(i18n.t(KEY)).not.toContain('интерфейса')
  })

  it('Russian runtime copy is distinct from leftover English', async () => {
    await setupI18n().changeLanguage('ru')
    expect(i18n.resolvedLanguage).toBe('ru')
    expect(i18n.t(KEY)).toBe(RU)
    expect(i18n.t(KEY)).not.toBe(LEFTOVER_RU)
    expect(i18n.t(KEY)).not.toBe(EN)
    expect(i18n.t(KEY)).not.toBe(i18n.t(KEY, { lng: 'en' }))
    expect(i18n.t(KEY)).not.toMatch(/\bUI\b/)

    await setupI18n().changeLanguage('en')
    expect(i18n.resolvedLanguage).toBe('en')
    expect(i18n.t(KEY)).toBe(EN)

    await setupI18n().changeLanguage('ru')
  })

  it('defines the key in all 12 locales', () => {
    const files = readdirSync(localesDir).filter((name) => name.endsWith('.json')).sort()
    expect(files).toHaveLength(12)
    for (const file of files) {
      const locale = JSON.parse(readFileSync(join(localesDir, file), 'utf8')) as Record<string, string>
      expect(locale[KEY]?.length, `${file} ${KEY}`).toBeGreaterThan(0)
    }
  })
})
