import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import i18n from 'i18next'
import { setupI18n } from '../setupI18n'

const KEY = 'pendingSkills.riskFsOutside'
const localesDir = join(import.meta.dir, '../locales')

const RU = 'Файловая система вне текущей рабочей директории cwd'
const EN = 'Filesystem outside cwd'
const LEFTOVER_RU = 'Файловая система вне cwd'

describe('P35-187 leftover cwd wrapping in pendingSkills.riskFsOutside', () => {
  it('wraps leftover cwd as рабочей директории around the cwd identifier', () => {
    const ru = JSON.parse(readFileSync(join(localesDir, 'ru.json'), 'utf8')) as Record<string, string>
    expect(ru[KEY]).toBe(RU)
    expect(ru[KEY]).toContain('рабочей директории')
    expect(ru[KEY]).toContain('cwd')
    expect(ru[KEY]).not.toBe(LEFTOVER_RU)
  })

  it('keeps English cwd as English', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN)
    expect(i18n.t(KEY)).toContain('cwd')
    expect(i18n.t(KEY)).not.toContain('рабочей директории')
    expect(i18n.t(KEY)).not.toContain('Файловая система')
  })

  it('Russian runtime copy is distinct from leftover English', async () => {
    await setupI18n().changeLanguage('ru')
    expect(i18n.t(KEY)).toBe(RU)
    expect(i18n.t(KEY)).not.toBe(LEFTOVER_RU)
    expect(i18n.t(KEY)).not.toBe(i18n.t(KEY, { lng: 'en' }))
    expect(i18n.t(KEY)).not.toBe(EN)

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
