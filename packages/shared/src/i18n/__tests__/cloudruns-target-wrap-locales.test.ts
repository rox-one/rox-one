import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { setupI18n } from '../setupI18n'
import i18n from 'i18next'

const KEY = 'settings.cloudRuns.regionHint'
const REGION_KEY = 'settings.cloudRuns.region'
const localesDir = join(import.meta.dir, '../locales')

describe('P35-179 leftover target wrapping in settings.cloudRuns.regionHint', () => {
  it('wraps leftover target as цель in Russian, matching settings.cloudRuns.region sibling', () => {
    const ru = JSON.parse(readFileSync(join(localesDir, 'ru.json'), 'utf8')) as Record<string, string>
    expect(ru[REGION_KEY]).toBe('Регион')
    expect(ru[KEY]).toBe('Регион или цель Daytona')
    expect(ru[KEY]).not.toMatch(/\btarget\b/)
    expect(ru[KEY]).toContain('Daytona')
  })

  it('keeps English target as English', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe('Daytona region or target')
    expect(i18n.t(KEY)).toContain('target')
    expect(i18n.t(KEY)).not.toContain('цель')
  })

  it('Russian runtime copy is distinct from leftover English', async () => {
    await setupI18n().changeLanguage('ru')
    expect(i18n.t(KEY)).toBe('Регион или цель Daytona')
    expect(i18n.t(KEY)).not.toMatch(/\btarget\b/)
    expect(i18n.t(KEY)).not.toBe(i18n.t(KEY, { lng: 'en' }))
    expect(i18n.t(KEY)).not.toBe('Daytona region or target')
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
