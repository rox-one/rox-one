import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { setupI18n } from '@craft-agent/shared/i18n/setupI18n'
import i18n from 'i18next'

const freeForm = readFileSync(join(import.meta.dir, '../FreeFormInput.tsx'), 'utf8')
const localesDir = join(import.meta.dir, '../../../../../../../../packages/shared/src/i18n/locales')

const VPS_LABEL_KEY = 'browser.vps.label'
const VPS_TOOLTIP_KEY = 'browser.vps.tooltip'

describe('FreeFormInput isWebUI VPS browser badge is i18n', () => {
  it('wires catalog keys and drops hardcoded Chinese leftovers', () => {
    expect(freeForm).toContain('t("browser.vps.label")')
    expect(freeForm).toContain('t("browser.vps.tooltip")')
    expect(freeForm).not.toContain('label="浏览器"')
    expect(freeForm).not.toContain('tooltip="打开 VPS 浏览器"')
    expect(freeForm).not.toMatch(/t\("browser\.vps\.label",\s*\{/)
    expect(freeForm).not.toMatch(/t\("browser\.vps\.tooltip",\s*\{/)
    expect(freeForm).not.toContain("defaultValue: 'Browser'")
    expect(freeForm).not.toContain("defaultValue: 'Open VPS browser'")
  })

  it('English locale matches the original Chinese meaning after setupI18n', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t(VPS_LABEL_KEY)).toBe('Browser')
    expect(i18n.t(VPS_TOOLTIP_KEY)).toBe('Open VPS browser')
    expect(i18n.t(VPS_LABEL_KEY)).not.toBe(VPS_LABEL_KEY)
    expect(i18n.t(VPS_TOOLTIP_KEY)).not.toBe(VPS_TOOLTIP_KEY)
  })

  it('zh-Hans keeps the original Chinese copy', async () => {
    await setupI18n().changeLanguage('zh-Hans')
    expect(i18n.t(VPS_LABEL_KEY)).toBe('浏览器')
    expect(i18n.t(VPS_TOOLTIP_KEY)).toBe('打开 VPS 浏览器')
  })

  it('Russian copy is distinct from English', async () => {
    await setupI18n().changeLanguage('ru')
    expect(i18n.t(VPS_LABEL_KEY)).toBe('Браузер')
    expect(i18n.t(VPS_TOOLTIP_KEY)).toBe('Открыть VPS-браузер')
    expect(i18n.t(VPS_LABEL_KEY)).not.toBe('Browser')
    expect(i18n.t(VPS_TOOLTIP_KEY)).not.toBe('Open VPS browser')
  })

  it('all 12 locales define the wired VPS browser badge keys', () => {
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
      expect(locale[VPS_LABEL_KEY]?.length, `${file} ${VPS_LABEL_KEY}`).toBeGreaterThan(0)
      expect(locale[VPS_TOOLTIP_KEY]?.length, `${file} ${VPS_TOOLTIP_KEY}`).toBeGreaterThan(0)
    }
  })
})
