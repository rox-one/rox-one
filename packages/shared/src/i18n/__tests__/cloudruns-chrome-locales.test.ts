import { describe, expect, it } from 'bun:test'
import { i18n, setupI18n } from '../setupI18n'

const KEYS = [
  'settings.cloudRuns.gatewayUrl',
  'settings.cloudRuns.gatewayUrlHint',
  'settings.cloudRuns.maxLlmTokensHint',
  'settings.cloudRuns.projectHint',
  'settings.cloudRuns.sandbox',
  'settings.cloudRuns.sandboxHint',
  'settings.cloudRuns.snapshotHint',
  'settings.cloudRuns.ttl',
  'settings.cloudRuns.ttlHint',
] as const

const ENGLISH: Record<(typeof KEYS)[number], string> = {
  'settings.cloudRuns.gatewayUrl': 'Gateway URL',
  'settings.cloudRuns.gatewayUrlHint': 'Base URL of the deployed cloud-gateway worker',
  'settings.cloudRuns.maxLlmTokensHint': 'Hard cap on prompt+completion tokens per run',
  'settings.cloudRuns.projectHint': 'Daytona project id bound to this workspace',
  'settings.cloudRuns.sandbox': 'Sandbox name prefix',
  'settings.cloudRuns.sandboxHint': 'Prefix for sandbox names; the run id is appended',
  'settings.cloudRuns.snapshotHint': 'Snapshot used to create the sandbox',
  'settings.cloudRuns.ttl': 'Sandbox TTL (sec)',
  'settings.cloudRuns.ttlHint': 'Destroy the sandbox after this many seconds',
}

describe('P35-125 settings.cloudRuns leftover chrome wrapping', () => {
  it('Russian wrapping is translated; identifiers stay; English is unchanged', async () => {
    const instance = setupI18n()

    await instance.changeLanguage('ru')
    expect(i18n.t('settings.cloudRuns.gatewayUrl')).toBe('URL шлюза')
    expect(i18n.t('settings.cloudRuns.gatewayUrlHint')).toBe(
      'Базовый URL развёрнутого cloud-gateway',
    )
    expect(i18n.t('settings.cloudRuns.maxLlmTokensHint')).toBe(
      'Жёсткий потолок токенов ввода и вывода (prompt+completion) на ран',
    )
    expect(i18n.t('settings.cloudRuns.projectHint')).toBe(
      'Идентификатор проекта Daytona для этого рабочего пространства',
    )
    expect(i18n.t('settings.cloudRuns.sandbox')).toBe('Префикс имени песочницы')
    expect(i18n.t('settings.cloudRuns.sandboxHint')).toBe(
      'Префикс имени песочницы; id рана добавляется',
    )
    expect(i18n.t('settings.cloudRuns.snapshotHint')).toBe(
      'Снимок, из которого создаётся песочница',
    )
    expect(i18n.t('settings.cloudRuns.ttl')).toBe('TTL песочницы (сек)')
    expect(i18n.t('settings.cloudRuns.ttlHint')).toBe(
      'Уничтожить песочницу через столько секунд',
    )

    for (const key of KEYS) {
      const ru = String(i18n.t(key))
      expect(ru, key).not.toBe(ENGLISH[key])
      expect(ru, key).not.toMatch(/\bsandbox\b/i)
      expect(ru, key).not.toMatch(/воркспейс/i)
      expect(ru, key).not.toMatch(/задеплоенн/i)
      expect(ru, key).not.toMatch(/\bворкер/i)
      expect(ru, key).not.toMatch(/prompt\+completion токенов/)
    }
    expect(String(i18n.t('settings.cloudRuns.gatewayUrl'))).not.toMatch(/\bgateway\b/i)
    expect(String(i18n.t('settings.cloudRuns.gatewayUrlHint'))).toContain('cloud-gateway')
    expect(String(i18n.t('settings.cloudRuns.maxLlmTokensHint'))).toContain('prompt+completion')

    await instance.changeLanguage('en')
    for (const key of KEYS) {
      expect(i18n.t(key), key).toBe(ENGLISH[key])
    }
  })
})
