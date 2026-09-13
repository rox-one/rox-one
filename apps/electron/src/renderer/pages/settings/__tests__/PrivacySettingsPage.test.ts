import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { SETTINGS_ITEMS } from '../../../../shared/menu-schema'
import { buildCompoundRoute, parseCompoundRoute } from '../../../../shared/route-parser'
import { getSettingsPage, isValidSettingsSubpage, SETTINGS_PAGES } from '../../../../shared/settings-registry'

const source = readFileSync(join(import.meta.dir, '..', 'PrivacySettingsPage.tsx'), 'utf8')
const settingsPagesSource = readFileSync(join(import.meta.dir, '../settings-pages.ts'), 'utf8')
const settingsIconsSource = readFileSync(
  join(import.meta.dir, '../../../components/icons/SettingsIcons.tsx'),
  'utf8',
)

describe('PrivacySettingsPage', () => {
  it('registers the privacy subpage through the canonical registry', () => {
    expect(SETTINGS_PAGES.find((page) => page.id === 'privacy')).toEqual({
      id: 'privacy',
      labelKey: 'settings.privacy.title',
      descriptionKey: 'settings.privacy.description',
    })
    expect(isValidSettingsSubpage('privacy')).toBe(true)
    expect(getSettingsPage('privacy').id).toBe('privacy')
  })

  it('loads consent, export and deletion RPCs without claiming legal copy is signed', () => {
    expect(source).toContain('window.electronAPI.getPrivacyState()')
    expect(source).toContain('window.electronAPI.setPrivacyPurpose')
    expect(source).toContain('window.electronAPI.requestPrivacyExport()')
    expect(source).toContain('window.electronAPI.requestPrivacyDeletion()')
    expect(source).toContain("t('settings.privacy.legalNote')")
    expect(source).not.toContain('GDPR signed')
    expect(source).not.toContain('training dataset')
  })

  it('derives the deep link and menu/component/icon integration from the registry', () => {
    const parsed = parseCompoundRoute('settings/privacy')
    expect(parsed).toEqual({ navigator: 'settings', details: { type: 'privacy', id: 'privacy' } })
    expect(buildCompoundRoute(parsed!)).toBe('settings/privacy')
    expect(settingsPagesSource).toContain('privacy: PrivacySettingsPage')
    expect(settingsIconsSource).toContain('privacy: PrivacySettingsIcon')
    expect(SETTINGS_ITEMS.filter((item) => item.id === 'privacy')).toEqual([
      expect.objectContaining({
        id: 'privacy',
        labelKey: 'settings.privacy.title',
        descriptionKey: 'settings.privacy.description',
        icon: 'Shield',
      }),
    ])
  })
})
