import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { setupI18n } from '@craft-agent/shared/i18n/setupI18n'
import i18n from 'i18next'

const panel = readFileSync(join(import.meta.dir, '../MainContentPanel.tsx'), 'utf8')
const localesDir = join(import.meta.dir, '../../../../../../../packages/shared/src/i18n/locales')

const BROWSER_INSTANCE_KEY = 'browser.noInstanceSelected'

describe('MainContentPanel browser empty state is i18n', () => {
  it('uses browser.noInstanceSelected and skips the English defaultValue leftover', () => {
    expect(panel).toContain("t('browser.noInstanceSelected')")
    expect(panel).not.toContain("defaultValue: 'No browser instance selected'")
    expect(panel).not.toContain(
      "t('browser.noInstanceSelected', { defaultValue: 'No browser instance selected' })",
    )
  })

  it('English locale keeps the previous empty-state copy', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t(BROWSER_INSTANCE_KEY)).toBe('No browser instance selected')
  })

  it('Russian copy is distinct from English', async () => {
    await setupI18n().changeLanguage('ru')
    expect(i18n.t(BROWSER_INSTANCE_KEY)).toBe('Браузерный экземпляр не выбран')
    expect(i18n.t(BROWSER_INSTANCE_KEY)).not.toBe('No browser instance selected')
  })

  it('all 12 locales already define the wired browser empty-state key', () => {
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
      expect(locale[BROWSER_INSTANCE_KEY]?.length).toBeGreaterThan(0)
    }
  })
})
