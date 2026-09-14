import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { setupI18n } from '@craft-agent/shared/i18n/setupI18n'
import i18n from 'i18next'

const host = readFileSync(join(import.meta.dir, '../InspectorHost.tsx'), 'utf8')
const localesDir = join(import.meta.dir, '../../../../../../packages/shared/src/i18n/locales')

const STATIC_KEYS = [
  'inspector.empty.connections.body',
  'inspector.empty.connections.title',
  'inspector.field.consumers',
  'inspector.field.credentialRef',
  'inspector.field.provider',
  'inspector.field.scopes',
  'inspector.field.storageMode',
  'inspector.field.testLogin',
] as const

describe('P35-74 InspectorHost leftover chrome is i18n', () => {
  it('wires catalog t() keys and does not inject English defaultValue leftovers', () => {
    expect(host).not.toMatch(/defaultValue:\s*['"]/)
    expect(host).toContain("t('inspector.empty.connections.title')")
    expect(host).toContain("t('inspector.empty.connections.body')")
    expect(host).toContain("t('inspector.field.provider')")
    expect(host).toContain("t('inspector.field.storageMode')")
    expect(host).toContain("t('inspector.field.credentialRef')")
    expect(host).toContain("t('inspector.field.scopes')")
    expect(host).toContain("t('inspector.field.testLogin')")
    expect(host).toContain("t('inspector.field.consumers')")
    expect(host).toContain("t('inspector.field.title')")
    expect(host).toContain("t('inspector.field.kind')")
    expect(host).toContain("t('inspector.field.navigator')")
    expect(host).toContain("t('inspector.field.session')")
    expect(host).toContain("t('inspector.field.panel')")
    expect(host).toContain("t('inspector.field.route')")
    expect(host).not.toContain('No connection selected')
    expect(host).not.toContain('Select a connection from the list')
  })

  it('English locale matches the leftover chrome labels', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t('inspector.empty.connections.title')).toBe('Connections')
    expect(i18n.t('inspector.empty.connections.body')).toBe(
      'Select a connection from the list to inspect its metadata.',
    )
    expect(i18n.t('inspector.field.provider')).toBe('Provider')
    expect(i18n.t('inspector.field.storageMode')).toBe('Storage mode')
    expect(i18n.t('inspector.field.credentialRef')).toBe('Credential')
    expect(i18n.t('inspector.field.scopes')).toBe('Scopes')
    expect(i18n.t('inspector.field.testLogin')).toBe('Test login')
    expect(i18n.t('inspector.field.consumers')).toBe('Consumers')
    expect(i18n.t('inspector.field.title')).toBe('Title')
    expect(i18n.t('inspector.field.kind')).toBe('Surface kind')
  })

  it('Russian copy is distinct from English', async () => {
    await setupI18n().changeLanguage('ru')
    expect(i18n.t('inspector.empty.connections.title')).toBe('Соединения')
    expect(i18n.t('inspector.empty.connections.body')).toBe(
      'Выберите соединение в списке, чтобы посмотреть его метаданные.',
    )
    expect(i18n.t('inspector.field.provider')).toBe('Провайдер')
    expect(i18n.t('inspector.field.storageMode')).toBe('Режим хранения')
    expect(i18n.t('inspector.field.credentialRef')).toBe('Учётные данные')
    expect(i18n.t('inspector.field.scopes')).toBe('Области')
    expect(i18n.t('inspector.field.testLogin')).toBe('Тестовый логин')
    expect(i18n.t('inspector.field.consumers')).toBe('Потребители')
    expect(i18n.t('inspector.empty.connections.title')).not.toBe('Connections')
    expect(i18n.t('inspector.field.provider')).not.toBe('Provider')
    expect(i18n.t('inspector.field.storageMode')).not.toBe('Storage mode')
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
