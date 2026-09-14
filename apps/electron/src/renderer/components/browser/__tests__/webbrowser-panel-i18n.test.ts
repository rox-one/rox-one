import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { setupI18n } from '@craft-agent/shared/i18n/setupI18n'
import i18n from 'i18next'

const panel = readFileSync(join(import.meta.dir, '../WebBrowserPanel.tsx'), 'utf8')
const localesDir = join(import.meta.dir, '../../../../../../../packages/shared/src/i18n/locales')

const CHROME_KEYS = [
  'browser.back',
  'browser.close',
  'browser.forward',
  'browser.openInNewTab',
  'browser.page',
  'browser.refresh',
  'browser.urlPlaceholder',
  'common.url',
] as const

describe('WebBrowserPanel nav chrome is i18n', () => {
  it('wires catalog keys and skips hardcoded Chinese leftover chrome', () => {
    expect(panel).toContain("t('browser.back')")
    expect(panel).toContain("t('browser.forward')")
    expect(panel).toContain("t('browser.refresh')")
    expect(panel).toContain("t('browser.close')")
    expect(panel).toContain("t('browser.page')")
    expect(panel).toContain("t('browser.openInNewTab')")
    expect(panel).toContain("t('browser.urlPlaceholder')")
    expect(panel).toContain("t('common.url')")
    expect(panel).toContain('resolveBrowserChromeLabel')
    expect(panel).not.toContain('后退')
    expect(panel).not.toContain('前进')
    expect(panel).not.toContain('刷新')
    expect(panel).not.toContain('关闭浏览器')
    expect(panel).not.toContain('浏览器页面')
    expect(panel).not.toContain('输入网址或搜索内容')
    expect(panel).not.toContain('在新标签页打开')
    expect(panel).not.toContain('aria-label="网址"')
    expect(panel).not.toMatch(/defaultValue:\s*['"]/)
  })

  it('hides a catalog miss instead of showing the raw key id', () => {
    expect(panel).toContain('translated === key ? undefined : translated')
    expect(panel).toContain('resolveBrowserChromeLabel(t(\'browser.back\'), \'browser.back\')')
  })

  it('English locale keeps the previous leftover chrome copy', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t('browser.back')).toBe('Back')
    expect(i18n.t('browser.forward')).toBe('Forward')
    expect(i18n.t('browser.refresh')).toBe('Refresh')
    expect(i18n.t('browser.close')).toBe('Close browser')
    expect(i18n.t('browser.page')).toBe('Browser page')
    expect(i18n.t('browser.openInNewTab')).toBe('Open in new tab')
    expect(i18n.t('browser.urlPlaceholder')).toBe('Enter URL or search…')
    expect(i18n.t('common.url')).toBe('URL')
  })

  it('zh-Hans keeps the original Chinese chrome copy', async () => {
    await setupI18n().changeLanguage('zh-Hans')
    expect(i18n.t('browser.back')).toBe('后退')
    expect(i18n.t('browser.forward')).toBe('前进')
    expect(i18n.t('browser.refresh')).toBe('刷新')
    expect(i18n.t('browser.close')).toBe('关闭浏览器')
    expect(i18n.t('browser.page')).toBe('浏览器页面')
    expect(i18n.t('browser.openInNewTab')).toBe('在新标签页打开')
  })

  it('Russian copy is distinct from English', async () => {
    await setupI18n().changeLanguage('ru')
    expect(i18n.t('browser.close')).toBe('Закрыть браузер')
    expect(i18n.t('browser.page')).toBe('Страница браузера')
    expect(i18n.t('browser.close')).not.toBe('Close browser')
    expect(i18n.t('browser.page')).not.toBe('Browser page')
  })

  it('all 12 locales define the wired browser chrome keys', () => {
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
      for (const key of CHROME_KEYS) {
        expect(locale[key]?.length, `${file} ${key}`).toBeGreaterThan(0)
      }
    }
  })
})
