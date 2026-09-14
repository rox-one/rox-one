import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { setupI18n } from '../setupI18n'
import i18n from 'i18next'

const KEY = 'settings.orgs.inviteTarget'
const localesDir = join(import.meta.dir, '../locales')

describe('P35-177 leftover Email wrapping in settings.orgs.inviteTarget', () => {
  it('wraps leftover Email as lowercase email in Russian, matching inviteDesc', () => {
    const ru = JSON.parse(readFileSync(join(localesDir, 'ru.json'), 'utf8')) as Record<string, string>
    expect(ru[KEY]).toBe('email или имя пользователя')
    expect(ru[KEY]).not.toMatch(/\bEmail\b/)
    expect(ru['settings.orgs.inviteDesc']).toContain('по email или имени пользователя')
    expect(ru['settings.orgs.inviteDesc']).not.toMatch(/\bEmail\b/)
  })

  it('keeps English Email as English', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe('Email or username')
  })

  it('Russian runtime copy is distinct from leftover English', async () => {
    await setupI18n().changeLanguage('ru')
    expect(i18n.t(KEY)).toBe('email или имя пользователя')
    expect(i18n.t(KEY)).not.toBe('Email or username')
    expect(i18n.t(KEY)).not.toMatch(/\bEmail\b/)
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
