import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { setupI18n } from '@craft-agent/shared/i18n/setupI18n'
import i18n from 'i18next'

const page = readFileSync(join(import.meta.dir, '../ConnectionsPage.tsx'), 'utf8')
const localesDir = join(import.meta.dir, '../../../../../../packages/shared/src/i18n/locales')

const WIRED_EXISTING = [
  'connections.imports.commit',
  'connections.imports.discover',
  'connections.convert',
  'connections.convertCancel',
  'connections.convertConfirm',
  'connections.unbind',
  'connections.unbindCancel',
  'connections.unbindConfirm',
] as const

const INSERTED_KEYS = [
  'connections.connect',
  'connections.import.adcPath',
  'connections.import.awsConfigPath',
  'connections.import.awsCredentialsPath',
  'connections.import.discoverAdc',
  'connections.import.discoverAws',
  'connections.import.discoverDocker',
  'connections.import.discoverGitHelper',
  'connections.import.discoverKeychain',
  'connections.import.discoverSshAgent',
  'connections.import.dockerConfigPath',
  'connections.import.envPath',
  'connections.import.gitConfigPath',
  'connections.repair',
  'connections.revoke',
  'connections.revokeCancel',
  'connections.revokeConfirm',
  'connections.rotate',
  'connections.rotateCancel',
  'connections.rotateConfirm',
  'connections.test',
] as const

describe('P35-72 ConnectionsPage leftover chrome is i18n', () => {
  it('wires existing catalog keys and keeps singular import path labels', () => {
    expect(page).toContain('t(`connections.tabs.${id}`)')
    expect(page).toContain('t(`connections.${tab}.empty`)')
    expect(page).toContain("t('connections.imports.discover')")
    expect(page).toContain("t('connections.imports.commit')")
    expect(page).not.toContain('t(`connections.tab.${id}`)')
    expect(page).not.toContain("t('connections.empty')")
    expect(page).not.toContain("t('connections.import.discover')")
    expect(page).not.toContain("t('connections.import.commit')")
    for (const key of WIRED_EXISTING) {
      expect(page).toContain(`t('${key}')`)
    }
    expect(page).toContain("t('connections.connect')")
    expect(page).toContain("t('connections.repair')")
    expect(page).toContain("t('connections.revoke')")
    expect(page).toContain("t('connections.rotate')")
    expect(page).toContain("t('connections.test')")
    expect(page).toContain("t('connections.import.envPath')")
    expect(page).not.toMatch(/defaultValue:\s*['"]/)
  })

  it('English locale matches the leftover chrome labels', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t('connections.connect')).toBe('Connect')
    expect(i18n.t('connections.test')).toBe('Test')
    expect(i18n.t('connections.repair')).toBe('Repair')
    expect(i18n.t('connections.revoke')).toBe('Revoke')
    expect(i18n.t('connections.revokeConfirm')).toBe('Confirm revoke')
    expect(i18n.t('connections.rotate')).toBe('Rotate')
    expect(i18n.t('connections.imports.discover')).toBe('Discover')
    expect(i18n.t('connections.imports.commit')).toBe('Commit')
    expect(i18n.t('connections.import.envPath')).toBe('.env path')
    expect(i18n.t('connections.services.empty')).toBe('No connections yet.')
    expect(i18n.t('connections.tabs.services')).toBe('Services')
  })

  it('Russian copy is distinct from English', async () => {
    await setupI18n().changeLanguage('ru')
    expect(i18n.t('connections.connect')).toBe('Подключить')
    expect(i18n.t('connections.test')).toBe('Проверить')
    expect(i18n.t('connections.repair')).toBe('Исправить')
    expect(i18n.t('connections.revoke')).toBe('Отозвать')
    expect(i18n.t('connections.rotate')).toBe('Ротировать')
    expect(i18n.t('connections.import.envPath')).toBe('Путь к .env')
    expect(i18n.t('connections.connect')).not.toBe('Connect')
    expect(i18n.t('connections.test')).not.toBe('Test')
    expect(i18n.t('connections.revoke')).not.toBe('Revoke')
  })

  it('wires inserted and existing keys in all 12 locales', () => {
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
      for (const key of [...WIRED_EXISTING, ...INSERTED_KEYS]) {
        expect(locale[key]?.length, `${file} ${key}`).toBeGreaterThan(0)
      }
      expect(locale['connections.services.empty']?.length, `${file} services.empty`).toBeGreaterThan(0)
      expect(locale['connections.tabs.services']?.length, `${file} tabs.services`).toBeGreaterThan(0)
    }
  })
})
