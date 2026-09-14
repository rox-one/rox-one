import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { i18n, setupI18n } from '../setupI18n'

const localesDir = join(import.meta.dir, '../locales')
const en = JSON.parse(readFileSync(join(localesDir, 'en.json'), 'utf8')) as Record<string, string>
const ru = JSON.parse(readFileSync(join(localesDir, 'ru.json'), 'utf8')) as Record<string, string>

/** P35-82 leftover English values that must now be Russian. */
const UPDATED_KEYS = [
  'settings.accounts.account',
  'settings.accounts.accountLabelPlaceholder',
  'settings.accounts.connectCloud',
  'settings.accounts.connectFailed',
  'settings.accounts.connected',
  'settings.accounts.credentialHealth',
  'settings.accounts.devices',
  'settings.accounts.devicesPlaceholder',
  'settings.accounts.disconnectFailed',
  'settings.accounts.disconnected',
  'settings.accounts.displayName',
  'settings.accounts.entitlement.active',
  'settings.accounts.entitlement.expired',
  'settings.accounts.entitlement.none',
  'settings.accounts.entitlement.trial',
  'settings.accounts.entitlementExpiredBanner',
  'settings.accounts.healthFailed',
  'settings.accounts.healthIssues',
  'settings.accounts.healthOk',
  'settings.accounts.healthSummary',
  'settings.accounts.healthUnknown',
  'settings.accounts.loadFailed',
  'settings.accounts.managedInAi',
  'settings.accounts.noConnections',
  'settings.accounts.noWorkspace',
  'settings.accounts.notConnected',
  'settings.accounts.openAiSettings',
  'settings.accounts.profileMeta',
  'settings.accounts.profileSaveFailed',
  'settings.accounts.profileSaved',
  'settings.accounts.provider.custom',
  'settings.accounts.provider.siyuan-local',
  'settings.accounts.refresh',
  'settings.accounts.refreshFailed',
  'settings.accounts.resetAppDataDesc',
  'settings.accounts.resetDone',
  'settings.accounts.resetFailed',
  'settings.accounts.roxServerUrl',
  'settings.accounts.runHealthCheck',
  'settings.accounts.siyuanCloudDesc',
  'settings.accounts.status.connected',
  'settings.accounts.status.disconnected',
  'settings.accounts.status.error',
  'settings.accounts.status.expired',
  'settings.accounts.status.syncing',
  'settings.accounts.subscription',
  'settings.accounts.syncStatus',
] as const

/** Product names kept in Latin script on purpose. */
const BRAND_KEYS = [
  'settings.accounts.provider.anthropic',
  'settings.accounts.provider.github',
  'settings.accounts.provider.google',
  'settings.accounts.provider.openai',
  'settings.accounts.provider.siyuan-cloud',
  'settings.accounts.provider.slack',
  'settings.accounts.siyuanCloud',
] as const

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

describe('P35-82 settings.accounts leftover Russian copy', () => {
  it('keeps Russian locale values distinct from English for leftover keys', () => {
    for (const key of UPDATED_KEYS) {
      expect(en[key], key).toBeTruthy()
      expect(ru[key], key).toBeTruthy()
      expect(ru[key], key).not.toBe(en[key])
    }
    expect(ru['settings.accounts.title']).toBe('Аккаунты и подключения')
    expect(ru['settings.accounts.displayName']).toBe('Отображаемое имя')
    expect(ru['settings.accounts.notConnected']).toBe('Не подключено')
    expect(ru['settings.accounts.noConnections']).toBe(
      'Сервисных подключений пока нет. Подключите SiYuan Cloud ниже или добавьте сервисы позже.',
    )
    expect(ru['settings.accounts.resetAppDataDesc']).toBe(
      'Выйти из всех сессий — очищает учётные данные и конфигурацию. Переписки будут удалены.',
    )
  })

  it('keeps provider brand labels in Latin script', () => {
    for (const key of BRAND_KEYS) {
      expect(ru[key], key).toBe(en[key])
    }
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
    expect(i18n.t('settings.accounts.connected')).toBe('Подключено')
    expect(i18n.t('settings.accounts.openAiSettings')).toBe('Открыть настройки ИИ')
    expect(i18n.t('settings.accounts.roxServerUrl')).toBe('URL сервера Rox')
  })

  it('still resolves English strings after changeLanguage(en)', async () => {
    await setupI18n().changeLanguage('en')
    for (const key of UPDATED_KEYS) {
      expect(i18n.t(key), key).toBe(en[key])
    }
    expect(i18n.t('settings.accounts.connected')).toBe('Connected')
    expect(i18n.t('settings.accounts.openAiSettings')).toBe('Open AI Settings')
    expect(i18n.t('settings.accounts.roxServerUrl')).toBe('Rox Server URL')
  })
})
