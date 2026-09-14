import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { setupI18n } from '@craft-agent/shared/i18n/setupI18n'
import i18n from 'i18next'

const platformDir = join(import.meta.dir, '..')
const localesDir = join(import.meta.dir, '../../../../../../packages/shared/src/i18n/locales')

const HOST_KEYS = [
  'conation.board.open',
  'conation.fund.open',
  'settings.account.description',
  'settings.account.title',
  'settings.appearance.conationShell',
  'settings.appearance.title',
] as const

function source(): string {
  return readFileSync(join(platformDir, 'OmniboxHost.tsx'), 'utf8')
}

describe('OmniboxHost label helper is catalog-backed', () => {
  it('fails closed to t(key) and skips leftover defaultValue', () => {
    const text = source()

    expect(text).toContain('t: (key, fallback) => {')
    expect(text).toContain('const value = t(key)')
    expect(text).toContain("return typeof value === 'string' ? value : fallback")

    expect(text).not.toContain('t(key, { defaultValue: fallback })')
    expect(text).not.toContain('t(key,{ defaultValue: fallback })')
    expect(text).not.toContain("t(key, { defaultValue: fallback })")
    expect(text).not.toContain("t(key, { defaultValue: '")
    expect(text).not.toContain('t(key, { defaultValue: "')
    expect(text).not.toContain('defaultValue: fallback')
    expect(text).not.toContain('defaultValue:')
    expect(text).not.toMatch(/defaultValue:\s*['"`]/)
    expect(text).not.toMatch(/t\(key,\s*\{\s*defaultValue:\s*fallback\s*\}\)/)
  })

  it('English locale keeps the wired helper keys', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t('conation.fund.open')).toBe('Open Fund in Conation')
    expect(i18n.t('conation.board.open')).toBe('Open Board in Conation')
    expect(i18n.t('settings.appearance.conationShell')).toBe('Conation')
    expect(i18n.t('settings.account.title')).toBe('Account')
    expect(i18n.t('settings.account.description')).toBe('Your name, plan, level, and local credits')
    expect(i18n.t('settings.appearance.title')).toBe('Appearance')
  })

  it('missing keys fail closed to the catalog instead of English defaultValue', async () => {
    await setupI18n().changeLanguage('en')
    const missing = 'omnibox.host.missing.not.in.catalog'
    expect(i18n.t(missing)).toBe(missing)
    expect(i18n.t(missing, { defaultValue: 'Open Fund in Conation' })).toBe(
      'Open Fund in Conation',
    )
    expect(source()).not.toContain("{ defaultValue: fallback }")
    expect(source()).not.toContain('{ defaultValue: fallback }')
    expect(source()).not.toContain("{ defaultValue: 'Open Fund in Conation' }")
    expect(source()).not.toContain('{ defaultValue: "Open Fund in Conation" }')
  })

  it('Russian copy is distinct from English for non-brand keys', async () => {
    await setupI18n().changeLanguage('ru')
    expect(i18n.t('conation.fund.open')).toBe('Открыть Fund в Conation')
    expect(i18n.t('conation.board.open')).toBe('Открыть Board в Conation')
    expect(i18n.t('settings.account.title')).toBe('Аккаунт')
    expect(i18n.t('settings.appearance.title')).toBe('Внешний вид')
    expect(i18n.t('conation.fund.open')).not.toBe('Open Fund in Conation')
    expect(i18n.t('settings.account.title')).not.toBe('Account')
  })

  it('all 12 locales already define the wired helper keys', () => {
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
      for (const key of HOST_KEYS) {
        expect(locale[key]?.length, `${file} ${key}`).toBeGreaterThan(0)
      }
    }
  })
})
