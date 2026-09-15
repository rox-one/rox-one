import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import i18n from 'i18next'
import { setupI18n } from '../setupI18n'

const KEY = 'settings.workspace.localMcpServersDesc'
const localesDir = join(import.meta.dir, '../locales')

const RU = 'Включить серверы подпроцессов с транспортом stdio'
const EN = 'Enable stdio subprocess servers'
const LEFTOVER_RU = 'Включить серверы подпроцессов stdio'

describe('P35-188 leftover stdio wrapping in settings.workspace.localMcpServersDesc', () => {
  it('wraps leftover stdio as транспортом around the stdio identifier', () => {
    const ru = JSON.parse(readFileSync(join(localesDir, 'ru.json'), 'utf8')) as Record<string, string>
    expect(ru[KEY]).toBe(RU)
    expect(ru[KEY]).toContain('транспортом')
    expect(ru[KEY]).toContain('stdio')
    expect(ru[KEY]).not.toBe(LEFTOVER_RU)
  })

  it('keeps English stdio as English', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN)
    expect(i18n.t(KEY)).toContain('stdio')
    expect(i18n.t(KEY)).not.toContain('транспортом')
    expect(i18n.t(KEY)).not.toContain('подпроцессов')
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
