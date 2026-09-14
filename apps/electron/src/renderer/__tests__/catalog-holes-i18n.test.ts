import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { setupI18n } from '@craft-agent/shared/i18n/setupI18n'
import i18n from 'i18next'

const renderer = join(import.meta.dir, '..')
const localesDir = join(import.meta.dir, '../../../../../packages/shared/src/i18n/locales')

const STATIC_KEYS = ['browser.open', 'chat.improvePromptTooltip', 'mindmap.overview'] as const

function read(rel: string): string {
  return readFileSync(join(renderer, rel), 'utf8')
}

describe('P35-76 catalog leftover chrome is i18n', () => {
  it('wires the leftover keys through t() at the UI call sites', () => {
    const badges = read('components/app-shell/ActiveOptionBadges.tsx')
    const input = read('components/app-shell/input/FreeFormInput.tsx')
    const minimap = read('mindmap/engine/minimap.tsx')

    expect(badges).toContain("t('chat.improvePromptTooltip')")
    expect(input).toContain('t("browser.open")')
    expect(minimap).toContain("t('mindmap.overview')")
    expect(badges).not.toMatch(/defaultValue:\s*['"]/)
    expect(input).not.toContain("defaultValue: 'Open'")
    expect(minimap).not.toContain("defaultValue: 'Overview'")
  })

  it('English locale matches leftover chrome labels', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t('chat.improvePromptTooltip')).toBe('Improve prompt')
    expect(i18n.t('browser.open')).toBe('Open')
    expect(i18n.t('mindmap.overview')).toBe('Overview')
  })

  it('Russian copy is distinct from English', async () => {
    await setupI18n().changeLanguage('ru')
    expect(i18n.t('chat.improvePromptTooltip')).toBe('Улучшить промпт')
    expect(i18n.t('browser.open')).toBe('Открыть')
    expect(i18n.t('mindmap.overview')).toBe('Обзор')
    expect(i18n.t('chat.improvePromptTooltip')).not.toBe('Improve prompt')
    expect(i18n.t('browser.open')).not.toBe('Open')
    expect(i18n.t('mindmap.overview')).not.toBe('Overview')
  })

  it('wires leftover keys in all 12 locales', () => {
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
