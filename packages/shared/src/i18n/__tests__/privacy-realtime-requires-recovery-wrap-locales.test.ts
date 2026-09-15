import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import i18n from 'i18next'
import { setupI18n } from '../setupI18n'

const KEY = 'settings.privacy.realtimeRequiresRecovery'
const localesDir = join(import.meta.dir, '../locales')

describe('P35-275 leftover реплику wrapping on settings.privacy.realtimeRequiresRecovery', () => {
  it('wraps leftover реплику as копию in Russian, matching accountReplica sibling', () => {
    const ru = JSON.parse(readFileSync(join(localesDir, 'ru.json'), 'utf8')) as Record<string, string>
    expect(ru[KEY]).toBe('Синхронизация в реальном времени требует согласия на копию восстановления.')
    expect(ru[KEY]).not.toMatch(/реплик/i)
    expect(ru['accountReplica.deletionQueued']).toContain('копию')
  })

  it('keeps English replica as English', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe('Realtime sync requires account recovery replica consent.')
  })

  it('Russian runtime copy is distinct from leftover English', async () => {
    await setupI18n().changeLanguage('ru')
    expect(i18n.t(KEY)).toBe('Синхронизация в реальном времени требует согласия на копию восстановления.')
    expect(i18n.t(KEY)).not.toBe('Realtime sync requires account recovery replica consent.')
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
