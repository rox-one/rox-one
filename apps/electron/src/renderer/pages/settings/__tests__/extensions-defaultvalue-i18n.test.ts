import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { setupI18n } from '@craft-agent/shared/i18n/setupI18n'
import i18n from 'i18next'
import {
  EXTENSION_RUNTIMES,
  RUNTIME_PLACEMENT,
  resolveRuntimePlacementHint,
} from '@craft-agent/shared/extensions/browser'

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
    expect(page).not.toContain('defaultValue: RUNTIME_PLACEMENT[runtime]')
    expect(page).toContain('resolveRuntimePlacementHint(t, runtime)')
    expect(page).not.toContain('First-party Craft code')
    expect(page).not.toContain('<select')
  })

  it('English locale keeps the existing runtime placement copy', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t(RUNTIME_PLACEMENT['craft-native'])).toBe(
      'First-party Craft code (main/renderer)',
    )
    expect(i18n.t(RUNTIME_PLACEMENT['agent-runtime'])).toBe(
      'External agent process supervisor',
    )
    expect(i18n.t(RUNTIME_PLACEMENT['web-widget'])).toBe('Sandboxed webContents only')
    expect(
      resolveRuntimePlacementHint((key) => String(i18n.t(key)), 'craft-sandbox'),
    ).toBe('Extension Host utilityProcess (sandboxed)')
    expect(resolveRuntimePlacementHint((key) => key, 'mcp-source')).toBeUndefined()
  })

  it('RUNTIME_PLACEMENT is catalog keys for every runtime', () => {
    for (const runtime of EXTENSION_RUNTIMES) {
      expect(RUNTIME_PLACEMENT[runtime]).toBe(`extensions.runtime.${runtime}.hint`)
    }
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
