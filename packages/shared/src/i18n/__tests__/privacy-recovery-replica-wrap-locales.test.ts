import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import i18n from 'i18next'
import { setupI18n } from '../setupI18n'

const KEY = 'settings.privacy.recovery'
const localesDir = join(import.meta.dir, '../locales')

describe('P35-272 leftover реплика wrapping on settings.privacy.recovery', () => {
  it('wraps leftover реплика as копия in Russian, matching accountReplica sibling', () => {
    const ru = JSON.parse(readFileSync(join(localesDir, 'ru.json'), 'utf8')) as Record<string, string>
    expect(ru[KEY]).toBe('Копия восстановления аккаунта')
    expect(ru[KEY]).not.toMatch(/реплик/i)
    expect(ru['accountReplica.deletionComplete']).toContain('копия')
  })

  it('keeps English replica as English', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe('Account recovery replica')
  })

  it('Russian runtime copy is distinct from leftover English', async () => {
    await setupI18n().changeLanguage('ru')
    expect(i18n.t(KEY)).toBe('Копия восстановления аккаунта')
    expect(i18n.t(KEY)).not.toBe('Account recovery replica')
    expect(i18n.t(KEY)).not.toMatch(/реплик/i)
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
