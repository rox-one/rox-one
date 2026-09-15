import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import i18n from 'i18next'
import { setupI18n } from '../setupI18n'

const localesDir = join(import.meta.dir, '../locales')

const KEY = 'sourcesList.indexEngineNative' as const
const HINT = 'sourcesList.indexStatusHintNative' as const
const TS_ENGINE = 'sourcesList.indexEngineTs' as const

const RU = 'Нативный'
const LEFTOVER_RU = 'Native'
const EN = 'Native'

describe('P35-195 leftover Native wrapping in ru.json', () => {
  it('wraps leftover English Native as Нативный and keeps sidecar Latin', () => {
    const ru = JSON.parse(readFileSync(join(localesDir, 'ru.json'), 'utf8')) as Record<string, string>
    expect(ru[KEY]).toBe(RU)
    expect(ru[KEY]).not.toBe(LEFTOVER_RU)
    expect(ru[KEY]).not.toBe(EN)
    expect(ru[KEY]).not.toMatch(/\bNative\b/)
    expect(ru[HINT]).toContain('sidecar')
    expect(ru[HINT]).toBe('Основной индекс источников — Rust sidecar')
    expect(ru[TS_ENGINE]).toBe('JS')
  })

  it('keeps English Native copy as English', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.resolvedLanguage).toBe('en')
    expect(i18n.t(KEY)).toBe(EN)
    expect(i18n.t(KEY)).toMatch(/\bNative\b/)
    expect(i18n.t(KEY)).not.toContain('Нативный')
    expect(i18n.t(HINT)).toContain('sidecar')
  })

  it('Russian native-engine copy is distinct from leftover English', async () => {
    await setupI18n().changeLanguage('ru')
    expect(i18n.resolvedLanguage).toBe('ru')
    expect(i18n.t(KEY)).toBe(RU)
    expect(i18n.t(KEY)).not.toBe(LEFTOVER_RU)
    expect(i18n.t(KEY)).not.toBe(EN)
    expect(i18n.t(KEY)).not.toBe(i18n.t(KEY, { lng: 'en' }))

    await setupI18n().changeLanguage('en')
    expect(i18n.resolvedLanguage).toBe('en')
    expect(i18n.t(KEY)).toBe(EN)

    await setupI18n().changeLanguage('ru')
  })

  it('defines the keys in all 12 locales', () => {
    const files = readdirSync(localesDir).filter((name) => name.endsWith('.json')).sort()
    expect(files).toHaveLength(12)
    for (const file of files) {
      const locale = JSON.parse(readFileSync(join(localesDir, file), 'utf8')) as Record<string, string>
      expect(locale[KEY]?.length, `${file} ${KEY}`).toBeGreaterThan(0)
      expect(locale[HINT]?.length, `${file} ${HINT}`).toBeGreaterThan(0)
      expect(locale[TS_ENGINE]?.length, `${file} ${TS_ENGINE}`).toBeGreaterThan(0)
    }
  })
})
