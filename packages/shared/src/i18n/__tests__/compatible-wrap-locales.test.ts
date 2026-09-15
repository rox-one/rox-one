import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import i18n from 'i18next'
import { setupI18n } from '../setupI18n'

const KEY = 'apiSetup.protocolThirdPartyHint'
const localesDir = join(import.meta.dir, '../locales')

const RU =
  'Большинство сторонних API (Ollama, vLLM, DashScope) используют протокол, совместимый с OpenAI.'
const EN = 'Most third-party APIs (Ollama, vLLM, DashScope) use OpenAI Compatible.'
const LEFTOVER_RU =
  'Большинство сторонних API (Ollama, vLLM, DashScope) используют протокол OpenAI Compatible.'

describe('P35-186 leftover Compatible wrapping in apiSetup.protocolThirdPartyHint', () => {
  it('wraps leftover Compatible as совместимый around the OpenAI identifier', () => {
    const ru = JSON.parse(readFileSync(join(localesDir, 'ru.json'), 'utf8')) as Record<string, string>
    expect(ru[KEY]).toBe(RU)
    expect(ru[KEY]).not.toContain('Compatible')
    expect(ru[KEY]).toContain('совместимый')
    expect(ru[KEY]).toContain('OpenAI')
    expect(ru[KEY]).toContain('Ollama')
    expect(ru[KEY]).toContain('vLLM')
    expect(ru[KEY]).toContain('DashScope')
    expect(ru[KEY]).not.toBe(LEFTOVER_RU)
    expect(ru['apiSetup.format.openaiCompatible']).toBe('Совместимый с OpenAI')
  })

  it('keeps English OpenAI Compatible as English', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN)
    expect(i18n.t(KEY)).toContain('Compatible')
    expect(i18n.t(KEY)).not.toContain('совместимый')
    expect(i18n.t(KEY)).not.toContain('протокол')
  })

  it('Russian runtime copy is distinct from leftover English', async () => {
    await setupI18n().changeLanguage('ru')
    expect(i18n.t(KEY)).toBe(RU)
    expect(i18n.t(KEY)).not.toContain('Compatible')
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
