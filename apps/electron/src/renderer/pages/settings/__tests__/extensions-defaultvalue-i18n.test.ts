import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { setupI18n } from '@craft-agent/shared/i18n/setupI18n'
import i18n from 'i18next'

const page = readFileSync(join(import.meta.dir, '../ExtensionsSettingsPage.tsx'), 'utf8')
const marketplace = readFileSync(join(import.meta.dir, '../MarketplaceSettingsPage.tsx'), 'utf8')
const localesDir = join(import.meta.dir, '../../../../../../../packages/shared/src/i18n/locales')

const LOCALE_FILES = [
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
] as const

const STATIC_KEYS = [
  'extensions.action.openBrowser',
  'extensions.card.runtime',
  'extensions.center.empty',
  'extensions.center.skills',
  'extensions.developer.title',
  'extensions.loading',
  'extensions.permissionGroup.filesystem',
  'extensions.refresh',
  'extensions.registries.provider.craft-curated',
  'extensions.runtime.craft-native',
  'extensions.runtime.craft-native.hint',
  'extensions.search',
  'extensions.section.catalog',
  'extensions.status.enabled',
  'settings.extensions.title',
] as const

describe('P35-69 Extensions/Marketplace identifier defaultValue leftovers', () => {
  it('does not inject English string defaultValue leftovers', () => {
    expect(page).not.toMatch(/defaultValue:\s*['"]/)
    expect(marketplace).not.toMatch(/defaultValue:\s*['"]/)
    expect(page).not.toContain("defaultValue: 'Extensions'")
    expect(page).not.toContain("defaultValue: 'Search extensions")
    expect(page).not.toContain("defaultValue: 'Open browser'")
    expect(page).not.toContain("defaultValue: 'First-party Craft code")
    expect(page).not.toContain('CENTER_GROUP_DEFAULTS')
    expect(page).not.toContain('RUNTIME_PLACEMENT')
    expect(page).not.toContain('defaultValue: RUNTIME_PLACEMENT[runtime]')
    expect(page).not.toContain('defaultValue: p.label')
    expect(page).toContain("t('settings.extensions.title')")
    expect(page).toContain("t('extensions.search')")
    expect(page).toContain("t(`extensions.center.${groupId}`)")
  })

  it('keeps catalog t() with identifier fallbacks, never raw keys or English sentences', () => {
    expect(page).toContain('t(`extensions.status.${status}`, { defaultValue: status })')
    expect(page).toContain('t(`extensions.category.${category}`, { defaultValue: category })')
    expect(page).toContain('t(`extensions.origin.${origin}`, { defaultValue: origin })')
    expect(page).toContain(
      't(`extensions.installTarget.${installTarget}`, { defaultValue: installTarget })',
    )
    expect(page).toContain('t(`extensions.runtime.${runtime}.hint`, {')
    expect(page).toContain('defaultValue: runtime')
    expect(page).toContain('t(`extensions.runtime.${runtime}`, { defaultValue: runtime })')
    expect(page).toContain(
      't(`extensions.permissionGroup.${group.group}`, { defaultValue: group.group })',
    )
    expect(page).toContain('t(`extensions.section.${id}`, { defaultValue: id })')
    expect(page).toContain('t(`extensions.category.${c}`, { defaultValue: c })')
    expect(page).toContain(
      't(`extensions.registries.provider.${p.id}`, { defaultValue: p.id })',
    )
    expect(marketplace).toContain(
      't(`extensions.permissionGroup.${group.group}`, { defaultValue: group.group })',
    )
    expect(page).not.toContain('<select')
    expect(marketplace).not.toContain('<select')
  })

  it('catalog hits win over identifier fallback; miss returns the identifier', async () => {
    await setupI18n().changeLanguage('en')
    expect(
      i18n.t('extensions.runtime.craft-native.hint', { defaultValue: 'craft-native' }),
    ).toBe('First-party Craft code (main/renderer)')
    expect(i18n.t('extensions.runtime.craft-native', { defaultValue: 'craft-native' })).toBe(
      'craft-native',
    )
    expect(i18n.t('extensions.status.enabled', { defaultValue: 'enabled' })).toBe('enabled')
    expect(i18n.t('extensions.category.skills', { defaultValue: 'skills' })).toBe('Skills')
    expect(i18n.t('extensions.section.catalog', { defaultValue: 'catalog' })).toBe('Catalog')
    expect(
      i18n.t('extensions.permissionGroup.filesystem', { defaultValue: 'filesystem' }),
    ).toBe('Filesystem')
    expect(
      i18n.t('extensions.registries.provider.craft-curated', { defaultValue: 'craft-curated' }),
    ).toBe('Rox Kiro')
    expect(
      i18n.t('extensions.origin.unknown-provider-xyz', {
        defaultValue: 'unknown-provider-xyz',
      }),
    ).toBe('unknown-provider-xyz')
    expect(i18n.t('extensions.origin.unknown-provider-xyz')).not.toBe(
      'unknown-provider-xyz',
    )
    expect(i18n.t('extensions.origin.unknown-provider-xyz')).toContain('extensions.origin.')
  })

  it('English locale matches the previous hardcoded leftovers', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t('settings.extensions.title')).toBe('Extensions')
    expect(i18n.t('extensions.search')).toBe('Search extensions…')
    expect(i18n.t('extensions.action.openBrowser')).toBe('Open browser')
    expect(i18n.t('extensions.card.runtime')).toBe('Runtime')
    expect(i18n.t('extensions.runtime.craft-native.hint')).toBe(
      'First-party Craft code (main/renderer)',
    )
    expect(i18n.t('extensions.runtime.craft-sandbox.hint')).toBe(
      'Extension Host utilityProcess (sandboxed)',
    )
  })

  it('Russian copy is distinct from English for translated chrome', async () => {
    await setupI18n().changeLanguage('ru')
    expect(i18n.t('settings.extensions.title')).toBe('Расширения')
    expect(i18n.t('extensions.search')).toBe('Поиск расширений…')
    expect(i18n.t('extensions.section.catalog')).toBe('Каталог')
    expect(i18n.t('extensions.category.skills')).toBe('Навыки')
    expect(i18n.t('extensions.permissionGroup.filesystem')).toBe('Файловая система')
    expect(i18n.t('settings.extensions.title')).not.toBe('Extensions')
    expect(i18n.t('extensions.search')).not.toBe('Search extensions…')
  })

  it('wires static keys in all 12 locales', () => {
    const files = readdirSync(localesDir).filter((name) => name.endsWith('.json')).sort()
    expect(files).toEqual([...LOCALE_FILES])
    for (const file of files) {
      const locale = JSON.parse(readFileSync(join(localesDir, file), 'utf8')) as Record<string, string>
      for (const key of STATIC_KEYS) {
        expect(locale[key]?.length, `${file} ${key}`).toBeGreaterThan(0)
      }
    }
  })
})
