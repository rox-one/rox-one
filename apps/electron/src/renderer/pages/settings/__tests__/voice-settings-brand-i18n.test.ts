import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { setupI18n } from '@craft-agent/shared/i18n/setupI18n'
import i18n from 'i18next'

const section = readFileSync(join(import.meta.dir, '../VoiceSettingsSection.tsx'), 'utf8')
const localesDir = join(import.meta.dir, '../../../../../../../packages/shared/src/i18n/locales')

const BRAND_KEY = 'settings.input.voiceRocksT1'
const BRAND_EN = 'rocks transcription (rocks t1)'

describe('P35-71 VoiceSettingsSection brand fallback leftover is i18n', () => {
  it('does not hardcode the rocks t1 brand fallback', () => {
    expect(section).not.toContain("'rocks transcription (rocks t1)'")
    expect(section).not.toContain('"rocks transcription (rocks t1)"')
    expect(section).not.toContain('ROCKS_T1_DISPLAY_NAME')
    expect(section).not.toContain('oh-my-pi')
    expect(section).not.toContain('Craft Agents')
    expect(section).toContain("t('settings.input.voiceRocksT1')")
    expect(section).toContain('brand || t(')
  })

  it('English locale matches the previous hardcoded leftover', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t(BRAND_KEY)).toBe(BRAND_EN)
  })

  it('catalog brand stays product-facing rocks, not OMP', async () => {
    await setupI18n().changeLanguage('en')
    const en = i18n.t(BRAND_KEY)
    expect(en).toContain('rocks')
    expect(en.toLowerCase()).not.toContain('omp')
    expect(en.toLowerCase()).not.toContain('oh-my-pi')
    expect(en).not.toContain('Craft Agents')
    await setupI18n().changeLanguage('ru')
    const ru = i18n.t(BRAND_KEY)
    expect(ru.length).toBeGreaterThan(0)
    expect(ru.toLowerCase()).not.toContain('omp')
    expect(ru.toLowerCase()).not.toContain('oh-my-pi')
    expect(ru).not.toContain('Craft Agents')
  })

  it('wires the brand key in all 12 locales', () => {
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
      expect(locale[BRAND_KEY]?.length, `${file} ${BRAND_KEY}`).toBeGreaterThan(0)
      expect(locale[BRAND_KEY]!.toLowerCase(), `${file} ${BRAND_KEY}`).not.toContain('omp')
      expect(locale[BRAND_KEY]!.toLowerCase(), `${file} ${BRAND_KEY}`).not.toContain('oh-my-pi')
      expect(locale[BRAND_KEY], `${file} ${BRAND_KEY}`).not.toContain('Craft Agents')
    }
  })
})
