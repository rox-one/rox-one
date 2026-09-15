import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import i18n from 'i18next'
import { setupI18n } from '../setupI18n'

const KEY = 'workbench.status.fallbackUnverified'
const SIBLING_KEY = 'settings.appearance.usingBundledFallback'
const localesDir = join(import.meta.dir, '../locales')

const RU = 'Резервный вариант вживую не проверен'
const EN = 'Fallback live not verified'

describe('P35-184 leftover Fallback/live wrapping in workbench.status.fallbackUnverified', () => {
  it('wraps leftover Fallback to match sibling резервный вариант; wraps live as вживую', () => {
    const ru = JSON.parse(readFileSync(join(localesDir, 'ru.json'), 'utf8')) as Record<string, string>
    expect(ru[SIBLING_KEY]).toBe('используется встроенный резервный вариант')
    expect(ru[KEY]).toBe(RU)
    expect(ru[KEY]).not.toMatch(/\bFallback\b/)
    expect(ru[KEY]).not.toMatch(/\blive\b/i)
    expect(ru[KEY]).toContain('Резервный вариант')
    expect(ru[KEY]).toContain('вживую')
  })

  it('keeps English Fallback live as English', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN)
    expect(i18n.t(KEY)).toContain('Fallback')
    expect(i18n.t(KEY)).toContain('live')
    expect(i18n.t(KEY)).not.toContain('резервный')
    expect(i18n.t(KEY)).not.toContain('вживую')
  })

  it('Russian runtime copy is distinct from leftover English', async () => {
    await setupI18n().changeLanguage('ru')
    expect(i18n.t(KEY)).toBe(RU)
    expect(i18n.t(KEY)).not.toMatch(/\bFallback\b/)
    expect(i18n.t(KEY)).not.toMatch(/\blive\b/i)
    expect(i18n.t(KEY)).not.toBe(i18n.t(KEY, { lng: 'en' }))
    expect(i18n.t(KEY)).not.toBe(EN)
    expect(i18n.t(KEY)).not.toBe('Fallback live не проверено')

    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN)

    await setupI18n().changeLanguage('ru')
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
