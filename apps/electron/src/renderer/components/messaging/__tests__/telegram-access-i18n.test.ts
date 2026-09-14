import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { setupI18n } from '@craft-agent/shared/i18n/setupI18n'
import i18n from 'i18next'

const messaging = join(import.meta.dir, '..')
const localesDir = join(import.meta.dir, '../../../../../../../packages/shared/src/i18n/locales')

const WIRED_KEYS = [
  'common.loading',
  'settings.messaging.telegram.access.allowedUsersSubtitleInbox',
  'settings.messaging.telegram.access.banner.description',
  'settings.messaging.telegram.access.banner.lockDown',
  'settings.messaging.telegram.access.banner.title',
  'settings.messaging.telegram.access.bindingPopover.mode.disabled.description',
  'settings.messaging.telegram.access.bindingPopover.mode.disabled.label',
  'settings.messaging.telegram.access.bindingPopover.mode.ownerControl.description',
  'settings.messaging.telegram.access.bindingPopover.mode.ownerControl.label',
  'settings.messaging.telegram.access.bindingPopover.mode.publicInbox.description',
  'settings.messaging.telegram.access.bindingPopover.mode.publicInbox.label',
  'settings.messaging.telegram.access.bindingPopover.saveDisabledHint',
  'settings.messaging.telegram.access.bindingPopover.trigger.ownerControlCount',
  'settings.messaging.telegram.supergroup.dialogDescription',
  'settings.messaging.telegram.supergroup.dialogSendHint',
  'settings.messaging.telegram.supergroup.dialogTitle',
  'settings.messaging.telegram.supergroup.pairedToast',
] as const

function read(rel: string): string {
  return readFileSync(join(messaging, rel), 'utf8')
}

describe('Telegram / access leftover English chrome is i18n', () => {
  it('TelegramSupergroupPairingDialog uses catalog keys and skips English defaultValue', () => {
    const dialog = read('TelegramSupergroupPairingDialog.tsx')

    expect(dialog).toContain("t('settings.messaging.telegram.supergroup.pairedToast')")
    expect(dialog).toContain("t('settings.messaging.telegram.supergroup.dialogTitle')")
    expect(dialog).toContain("t('settings.messaging.telegram.supergroup.dialogDescription')")
    expect(dialog).toContain("t('settings.messaging.telegram.supergroup.dialogSendHint')")
    expect(dialog).toContain("t('common.loading')")
    expect(dialog).not.toMatch(/defaultValue:\s*['"]/)
    expect(dialog).not.toContain("defaultValue: 'Supergroup paired'")
    expect(dialog).not.toContain("defaultValue: 'Pair Telegram supergroup'")
    expect(dialog).not.toContain("defaultValue: 'Loading…'")
  })

  it('TelegramAccessSection wires the public-inbox allowed-users subtitle', () => {
    const telegram = read('access/TelegramAccessSection.tsx')

    expect(telegram).toContain("t('settings.messaging.telegram.access.allowedUsersSubtitleInbox')")
    expect(telegram).toContain("accessMode === 'public-inbox'")
    expect(telegram).not.toMatch(/defaultValue:\s*['"]/)
  })

  it('AccessModeBanner uses catalog keys and skips English defaultValue', () => {
    const banner = read('access/AccessModeBanner.tsx')

    expect(banner).toContain("t('settings.messaging.telegram.access.banner.title')")
    expect(banner).toContain("t('settings.messaging.telegram.access.banner.description')")
    expect(banner).toContain("t('settings.messaging.telegram.access.banner.lockDown')")
    expect(banner).not.toMatch(/defaultValue:\s*['"]/)
    expect(banner).not.toContain("defaultValue: 'Public inbox'")
    expect(banner).not.toContain("defaultValue: 'Switch to owner control'")
  })

  it('BindingAllowListPopover reuses mode keys and skips English defaultValue leftovers', () => {
    const popover = read('access/BindingAllowListPopover.tsx')

    expect(popover).toContain('t(MODE_LABEL_KEYS[mode])')
    expect(popover).toContain('t(MODE_DESCRIPTION_KEYS[mode])')
    expect(popover).toContain("t('settings.messaging.telegram.access.bindingPopover.saveDisabledHint')")
    expect(popover).toContain("t(MODE_LABEL_KEYS['public-inbox'])")
    expect(popover).toContain("t(MODE_LABEL_KEYS['disabled'])")
    expect(popover).toContain(
      "t('settings.messaging.telegram.access.bindingPopover.trigger.ownerControlCount'",
    )
    expect(popover).not.toContain('MODE_LABEL_DEFAULTS')
    expect(popover).not.toContain('MODE_DESCRIPTION_DEFAULTS')
    expect(popover).not.toMatch(/defaultValue:\s*['"]/)
    expect(popover).not.toContain("defaultValue: 'Public inbox'")
    expect(popover).not.toContain("defaultValue: 'Disabled'")
    expect(popover).not.toContain("defaultValue: 'Owner control · {{count}}'")
  })

  it('English locale keeps the existing telegram/access copy', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t('settings.messaging.telegram.supergroup.pairedToast')).toBe('Supergroup paired')
    expect(i18n.t('settings.messaging.telegram.supergroup.dialogTitle')).toBe(
      'Pair Telegram supergroup',
    )
    expect(i18n.t('common.loading')).toBe('Loading…')
    expect(i18n.t('settings.messaging.telegram.access.banner.title')).toBe(
      'This bot is publicly accessible',
    )
    expect(i18n.t('settings.messaging.telegram.access.banner.lockDown')).toBe('Lock down')
    expect(i18n.t('settings.messaging.telegram.access.allowedUsersSubtitleInbox')).toBe(
      'Public inbox — messages do not start an agent session.',
    )
    expect(i18n.t('settings.messaging.telegram.access.bindingPopover.mode.publicInbox.label')).toBe(
      'Public inbox',
    )
    expect(i18n.t('settings.messaging.telegram.access.bindingPopover.mode.disabled.label')).toBe(
      'Disabled',
    )
    expect(
      i18n.t('settings.messaging.telegram.access.bindingPopover.trigger.ownerControlCount', {
        count: 3,
      }),
    ).toBe('Owner control · 3')
  })

  it('Russian copy is distinct from English', async () => {
    await setupI18n().changeLanguage('ru')
    expect(i18n.t('settings.messaging.telegram.supergroup.pairedToast')).toBe('Супергруппа привязана')
    expect(i18n.t('settings.messaging.telegram.access.banner.lockDown')).toBe('Ограничить доступ')
    expect(i18n.t('settings.messaging.telegram.access.allowedUsersSubtitleInbox')).toBe(
      'Публичный inbox — сообщения не запускают сессию агента.',
    )
    expect(i18n.t('settings.messaging.telegram.access.allowedUsersSubtitleInbox')).not.toBe(
      'Public inbox — messages do not start an agent session.',
    )
    expect(
      i18n.t('settings.messaging.telegram.access.bindingPopover.trigger.ownerControlCount', {
        count: 3,
      }),
    ).toBe('Контроль владельца · 3')
    expect(i18n.t('settings.messaging.telegram.supergroup.pairedToast')).not.toBe('Supergroup paired')
  })

  it('all 12 locales define the wired telegram/access keys', () => {
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
      for (const key of WIRED_KEYS) {
        expect(locale[key]?.length, `${file} ${key}`).toBeGreaterThan(0)
      }
    }
  })
})
