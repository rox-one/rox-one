import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { setupI18n } from '@craft-agent/shared/i18n/setupI18n'
import i18n from 'i18next'

const page = readFileSync(join(import.meta.dir, '../MessagingSettingsPage.tsx'), 'utf8')
const localesDir = join(import.meta.dir, '../../../../../../../packages/shared/src/i18n/locales')

const STATIC_KEYS = [
  'dialog.whatsapp.starting',
  'settings.messaging.lark.notConnected',
  'settings.messaging.telegram.directSessionSubtitle',
  'settings.messaging.telegram.notConnected',
  'settings.messaging.telegram.supergroup.disconnected',
  'settings.messaging.telegram.supergroup.label',
  'settings.messaging.telegram.supergroup.noTopicsHint',
  'settings.messaging.telegram.supergroup.notConfigured',
  'settings.messaging.telegram.supergroup.pair',
  'settings.messaging.wechat.directSessionSubtitle',
  'settings.messaging.whatsapp.notConnected',
] as const

describe('P35-52 MessagingSettingsPage leftover chrome is i18n', () => {
  it('does not inject English string defaultValue leftovers', () => {
    expect(page).not.toMatch(/defaultValue:\s*['"]/)
    expect(page).not.toContain("defaultValue: 'Disconnected'")
    expect(page).not.toContain("defaultValue: 'Supergroup disconnected'")
    expect(page).not.toContain("defaultValue: 'Direct message session'")
    expect(page).not.toContain("defaultValue: 'Supergroup'")
    expect(page).not.toContain("defaultValue: 'Not configured'")
    expect(page).not.toContain("defaultValue: 'Pair Supergroup'")
    expect(page).not.toContain("defaultValue: '{{count}} topics bound'")
    expect(page).not.toContain("defaultValue: 'Connected'")
    expect(page).not.toContain("defaultValue: 'Connecting…'")
    expect(page).not.toContain("defaultValue: 'Not connected'")
    expect(page).not.toContain(
      'No topics bound yet — automations with `telegramTopic` will create them.',
    )
  })

  it('keeps t() callsites on the existing messaging keys', () => {
    expect(page).toContain('t(`settings.messaging.${platform}.disconnected`)')
    expect(page).toContain("t('settings.messaging.telegram.supergroup.disconnected')")
    expect(page).toContain("t('settings.messaging.wechat.directSessionSubtitle')")
    expect(page).toContain("t('settings.messaging.telegram.directSessionSubtitle')")
    expect(page).toContain("t('settings.messaging.telegram.supergroup.label')")
    expect(page).toContain("t('settings.messaging.telegram.supergroup.notConfigured')")
    expect(page).toContain("t('settings.messaging.telegram.supergroup.pair')")
    expect(page).toContain("t('settings.messaging.telegram.supergroup.topicsBound'")
    expect(page).toContain("t('settings.messaging.telegram.supergroup.noTopicsHint')")
    expect(page).toContain('t(`settings.messaging.${platform}.connected`)')
    expect(page).toContain("t('dialog.whatsapp.starting')")
    expect(page).toContain('t(`settings.messaging.${platform}.notConnected`)')
  })

  it('English locale matches the previous hardcoded leftovers', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t('settings.messaging.telegram.disconnected')).toBe('Telegram disconnected')
    expect(i18n.t('settings.messaging.telegram.supergroup.disconnected')).toBe(
      'Supergroup disconnected',
    )
    expect(i18n.t('settings.messaging.telegram.directSessionSubtitle')).toBe(
      'Direct message session',
    )
    expect(i18n.t('settings.messaging.wechat.directSessionSubtitle')).toBe(
      'Direct message session',
    )
    expect(i18n.t('settings.messaging.telegram.supergroup.label')).toBe('Supergroup')
    expect(i18n.t('settings.messaging.telegram.supergroup.notConfigured')).toBe('Not configured')
    expect(i18n.t('settings.messaging.telegram.supergroup.pair')).toBe('Pair Supergroup')
    expect(
      i18n.t('settings.messaging.telegram.supergroup.topicsBound', { count: 2 }),
    ).toBe('2 topics bound')
    expect(i18n.t('settings.messaging.telegram.supergroup.noTopicsHint')).toBe(
      'No topics bound yet — automations with `telegramTopic` will create them.',
    )
    expect(i18n.t('settings.messaging.telegram.connected')).toBe('Connected')
    expect(i18n.t('dialog.whatsapp.starting')).toBe('Starting WhatsApp service…')
    expect(i18n.t('settings.messaging.telegram.notConnected')).toBe('Not connected')
    expect(i18n.t('settings.messaging.lark.notConnected')).toBe('Not connected')
    expect(i18n.t('settings.messaging.whatsapp.notConnected')).toBe('Not connected')
  })

  it('Russian copy is distinct from English', async () => {
    await setupI18n().changeLanguage('ru')
    expect(i18n.t('settings.messaging.telegram.supergroup.disconnected')).toBe(
      'Супергруппа отключена',
    )
    expect(i18n.t('settings.messaging.telegram.notConnected')).toBe('Не подключено')
    expect(i18n.t('dialog.whatsapp.starting')).toBe('Запуск службы WhatsApp…')
    expect(i18n.t('settings.messaging.telegram.notConnected')).not.toBe('Not connected')
  })

  it('wires static keys in all 12 locales', () => {
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
