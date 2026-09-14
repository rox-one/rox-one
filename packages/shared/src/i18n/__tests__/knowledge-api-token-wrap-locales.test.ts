import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { setupI18n } from '../setupI18n'
import i18n from 'i18next'

const KEY = 'settings.knowledge.connectionEmptyBody'
const TOKEN_KEY = 'settings.knowledge.token'
const localesDir = join(import.meta.dir, '../locales')

describe('P35-178 leftover API token wrapping in settings.knowledge.connectionEmptyBody', () => {
  it('wraps leftover API token as API-токен in Russian, matching settings.knowledge.token', () => {
    const ru = JSON.parse(readFileSync(join(localesDir, 'ru.json'), 'utf8')) as Record<string, string>
    expect(ru[TOKEN_KEY]).toBe('API-токен')
    expect(ru[KEY]).toContain('API-токен')
    expect(ru[KEY]).not.toMatch(/API token/)
    expect(ru[KEY]).toContain('SiYuan')
  })

  it('keeps English API token as English', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toContain('API token')
    expect(i18n.t(KEY)).not.toContain('API-токен')
    expect(i18n.t(KEY)).toBe(
      'To connect SiYuan:\n1. Start SiYuan on this device.\n2. In SiYuan, open Settings → About → API token and copy the token.\n3. The local connection (http://localhost:6806) appears here once configured on the server side.\n4. Paste the token above and press “Test connection”.',
    )
  })

  it('Russian runtime copy is distinct from leftover English', async () => {
    await setupI18n().changeLanguage('ru')
    expect(i18n.t(KEY)).toContain('API-токен')
    expect(i18n.t(KEY)).not.toMatch(/API token/)
    expect(i18n.t(KEY)).not.toBe(i18n.t(KEY, { lng: 'en' }))
    expect(i18n.t(KEY)).not.toBe(
      'To connect SiYuan:\n1. Start SiYuan on this device.\n2. In SiYuan, open Settings → About → API token and copy the token.\n3. The local connection (http://localhost:6806) appears here once configured on the server side.\n4. Paste the token above and press “Test connection”.',
    )
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
