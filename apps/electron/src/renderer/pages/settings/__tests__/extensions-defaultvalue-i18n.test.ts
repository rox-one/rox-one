import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const page = readFileSync(join(import.meta.dir, '../ExtensionsSettingsPage.tsx'), 'utf8')
const localesDir = join(import.meta.dir, '../../../../../../../packages/shared/src/i18n/locales')

const STATIC_KEYS = [
  'settings.extensions.title',
  'extensions.search',
  'extensions.refresh',
  'extensions.loading',
  'extensions.center.empty',
  'extensions.center.skills',
  'extensions.action.openBrowser',
  'extensions.developer.title',
] as const

describe('ROX2-047 Extensions leftover chrome is i18n', () => {
  it('does not inject English string defaultValue leftovers', () => {
    expect(page).not.toMatch(/defaultValue:\s*['"]/)
    expect(page).not.toContain("defaultValue: 'Extensions'")
    expect(page).not.toContain("defaultValue: 'Search extensions")
    expect(page).not.toContain("defaultValue: 'Open browser'")
    expect(page).not.toContain('CENTER_GROUP_DEFAULTS')
    expect(page).toContain("t('settings.extensions.title')")
    expect(page).toContain("t('extensions.search')")
    expect(page).toContain("t(`extensions.center.${groupId}`)")
  })

  it('keeps dynamic key fallbacks and no native select', () => {
    expect(page).toContain('defaultValue: status')
    expect(page).toContain('defaultValue: category')
    expect(page).toContain('defaultValue: RUNTIME_PLACEMENT[runtime]')
    expect(page).not.toContain('<select')
  })

  it('wires static keys in all 12 locales with distinct Russian copy', () => {
    const files = readdirSync(localesDir).filter((name) => name.endsWith('.json')).sort()
    expect(files).toHaveLength(12)
    const en = JSON.parse(readFileSync(join(localesDir, 'en.json'), 'utf8')) as Record<string, string>
    const ru = JSON.parse(readFileSync(join(localesDir, 'ru.json'), 'utf8')) as Record<string, string>
    for (const file of files) {
      const locale = JSON.parse(readFileSync(join(localesDir, file), 'utf8')) as Record<string, string>
      for (const key of STATIC_KEYS) {
        expect(locale[key]?.length, `${file} ${key}`).toBeGreaterThan(0)
      }
    }
    for (const key of STATIC_KEYS) {
      expect(ru[key], key).not.toBe(en[key])
    }
  })
})
