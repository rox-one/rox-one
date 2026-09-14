import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { i18n, setupI18n } from '../setupI18n'

const localesDir = join(import.meta.dir, '../locales')
const en = JSON.parse(readFileSync(join(localesDir, 'en.json'), 'utf8')) as Record<string, string>
const ru = JSON.parse(readFileSync(join(localesDir, 'ru.json'), 'utf8')) as Record<string, string>

/** P35-85 leftover English values that must now be Russian. */
const UPDATED_KEYS = [
  'accountMenu.account',
  'accountMenu.connectionsSummary',
  'accountMenu.credentialHealth',
  'accountMenu.healthIssues',
  'accountMenu.healthOk',
  'accountMenu.healthUnknown',
  'accountMenu.licenseStatus',
  'accountMenu.localProfile',
  'accountMenu.openMenu',
  'accountMenu.profileMode',
  'accountMenu.resetDone',
  'accountMenu.resetFailed',
] as const

/** Product name kept in Latin script on purpose. */
const BRAND_KEYS = ['accountMenu.siyuanCloudStatus'] as const

const HONESTY_KEYS = [
  'meetings.grantRequired',
  'meetings.createProposal',
  'meetings.capabilityDenied',
  'settings.privacy.deletionNotLive',
  'settings.rox2.grantRequired',
  'settings.account.analyticsConsent',
  'settings.account.emailHint',
] as const

const HONESTY_RU: Record<(typeof HONESTY_KEYS)[number], string> = {
  'meetings.grantRequired': 'Применение заблокировано: нужен грант',
  'meetings.createProposal': 'Создать предложение',
  'meetings.capabilityDenied': 'Захват заблокирован: нужен грант микрофона',
  'settings.privacy.deletionNotLive': 'Удалённое удаление в очереди, не завершено',
  'settings.rox2.grantRequired': 'Для этого действия нужно явное разрешение',
  'settings.account.analyticsConsent': 'Аналитика продукта',
  'settings.account.emailHint': 'Необязательно. Хранится локально, это не вход в аккаунт.',
}

describe('P35-85 accountMenu leftover Russian copy', () => {
  it('keeps Russian locale values distinct from English for leftover keys', () => {
    for (const key of UPDATED_KEYS) {
      expect(en[key], key).toBeTruthy()
      expect(ru[key], key).toBeTruthy()
      expect(ru[key], key).not.toBe(en[key])
    }
    expect(ru['accountMenu.account']).toBe('Аккаунт')
    expect(ru['accountMenu.connectionsSummary']).toBe('{connected} подключено · {expired} истекло')
    expect(ru['accountMenu.credentialHealth']).toBe('Состояние учётных данных: {status}')
    expect(ru['accountMenu.healthIssues']).toBe('{count} проблем')
    expect(ru['accountMenu.healthOk']).toBe('норма')
    expect(ru['accountMenu.healthUnknown']).toBe('неизвестно')
    expect(ru['accountMenu.licenseStatus']).toBe('Лицензия: {status}')
    expect(ru['accountMenu.localProfile']).toBe('Локальный профиль')
    expect(ru['accountMenu.openMenu']).toBe('Меню аккаунта')
    expect(ru['accountMenu.profileMode']).toBe('Профиль: {mode}')
    expect(ru['accountMenu.resetDone']).toBe('Данные приложения сброшены')
    expect(ru['accountMenu.resetFailed']).toBe('Не удалось сбросить: {message}')
  })

  it('keeps the SiYuan Cloud product label in Latin script', () => {
    for (const key of BRAND_KEYS) {
      expect(ru[key], key).toBe(en[key])
    }
    expect(ru['accountMenu.siyuanCloudStatus']).toBe('SiYuan Cloud: {status}')
  })

  it('does not rewrite honesty keys', () => {
    for (const key of HONESTY_KEYS) {
      expect(ru[key], key).toBe(HONESTY_RU[key])
    }
  })

  it('resolves Russian strings after changeLanguage(ru)', async () => {
    await setupI18n().changeLanguage('ru')
    for (const key of UPDATED_KEYS) {
      expect(i18n.t(key), key).toBe(ru[key])
      expect(i18n.t(key), key).not.toBe(en[key])
    }
    expect(i18n.t('accountMenu.account')).toBe('Аккаунт')
    expect(i18n.t('accountMenu.openMenu')).toBe('Меню аккаунта')
    expect(i18n.t('accountMenu.resetDone')).toBe('Данные приложения сброшены')
  })

  it('still resolves English strings after changeLanguage(en)', async () => {
    await setupI18n().changeLanguage('en')
    for (const key of UPDATED_KEYS) {
      expect(i18n.t(key), key).toBe(en[key])
    }
    expect(i18n.t('accountMenu.account')).toBe('Account')
    expect(i18n.t('accountMenu.openMenu')).toBe('Account menu')
    expect(i18n.t('accountMenu.resetDone')).toBe('App data reset')
  })
})
