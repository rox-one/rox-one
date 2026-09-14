import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { setupI18n } from '@craft-agent/shared/i18n/setupI18n'
import i18n from 'i18next'

const section = readFileSync(join(import.meta.dir, '../VoiceSettingsSection.tsx'), 'utf8')
const localesDir = join(import.meta.dir, '../../../../../../../packages/shared/src/i18n/locales')

const STATIC_KEYS = [
  'settings.input.voiceLanguageAuto',
  'settings.input.voiceLanguageEn',
  'settings.input.voiceLanguageRu',
] as const

describe('P35-70 VoiceSettingsSection recognition language leftover is i18n', () => {
  it('does not hardcode English or Russian language labels', () => {
    expect(section).not.toContain("label: 'English'")
    expect(section).not.toContain('label: "English"')
    expect(section).not.toContain("label: 'Русский'")
    expect(section).not.toContain('label: "Русский"')
    expect(section).toContain("t('settings.input.voiceLanguageAuto')")
    expect(section).toContain("t('settings.input.voiceLanguageEn')")
    expect(section).toContain("t('settings.input.voiceLanguageRu')")
  })

  it('English locale matches the previous hardcoded leftovers', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t('settings.input.voiceLanguageEn')).toBe('English')
    expect(i18n.t('settings.input.voiceLanguageRu')).toBe('Русский')
    expect(i18n.t('settings.input.voiceLanguageAuto')).toBe('Auto-detect')
  })

  it('Russian copy for English is distinct from the English locale', async () => {
    await setupI18n().changeLanguage('ru')
    expect(i18n.t('settings.input.voiceLanguageEn')).toBe('Английский')
    expect(i18n.t('settings.input.voiceLanguageEn')).not.toBe('English')
    expect(i18n.t('settings.input.voiceLanguageRu')).toBe('Русский')
    expect(i18n.t('settings.input.voiceLanguageAuto')).toBe('Автоопределение')
  })

  it('wires language keys in all 12 locales', () => {
    const files = readdirSync(localesDir).filter((name) => name.endsWith('.json')).sort()
    expect(files).toEqual([
      'ar.json',
      'de.json',
      'en.json',
      'es.json',
      'fr.json',
      'hu.json',
      'ja.json',
      'ko.json',
      'pl.json',
      'ru.json',
      'zh-Hans.json',
      'zh-Hant.json',
    ])
    for (const file of files) {
      const locale = JSON.parse(readFileSync(join(localesDir, file), 'utf8')) as Record<string, string>
      for (const key of STATIC_KEYS) {
        expect(locale[key]?.length, `${file} ${key}`).toBeGreaterThan(0)
      }
    }
  })
})
