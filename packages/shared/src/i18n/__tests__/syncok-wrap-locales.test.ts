import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import i18n from 'i18next'
import { setupI18n } from '../setupI18n'

const KEY = 'workbench.status.syncOk'
const localesDir = join(import.meta.dir, '../locales')

const RU = 'Синхронизация в порядке'
const EN = 'Sync OK'
const LEFTOVER_RU = 'Синхронизация OK'

describe('P35-185 leftover OK wrapping in workbench.status.syncOk', () => {
  it('wraps leftover OK as в порядке in otherwise-Russian status copy', () => {
    const ru = JSON.parse(readFileSync(join(localesDir, 'ru.json'), 'utf8')) as Record<string, string>
    expect(ru[KEY]).toBe(RU)
    expect(ru[KEY]).not.toMatch(/\bOK\b/)
    expect(ru[KEY]).toContain('Синхронизация')
    expect(ru[KEY]).toContain('в порядке')
    expect(ru[KEY]).not.toBe(LEFTOVER_RU)
  })

  it('keeps English Sync OK as English', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN)
    expect(i18n.t(KEY)).toContain('OK')
    expect(i18n.t(KEY)).not.toContain('в порядке')
    expect(i18n.t(KEY)).not.toContain('Синхронизация')
  })

  it('Russian runtime copy is distinct from leftover English', async () => {
    await setupI18n().changeLanguage('ru')
    expect(i18n.t(KEY)).toBe(RU)
    expect(i18n.t(KEY)).not.toMatch(/\bOK\b/)
    expect(i18n.t(KEY)).not.toBe(i18n.t(KEY, { lng: 'en' }))
    expect(i18n.t(KEY)).not.toBe(EN)
    expect(i18n.t(KEY)).not.toBe(LEFTOVER_RU)

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
