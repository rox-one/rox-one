import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { i18n, setupI18n } from '../setupI18n'

const KEYS = [
  'onboarding.errors.roxConnectFailed',
  'onboarding.errors.roxConnectIncomplete',
  'onboarding.roxConnect.expired',
  'onboarding.roxConnect.pollFailed',
] as const

const SIBLING = 'onboarding.roxConnect.connect'

const EN: Record<(typeof KEYS)[number], string> = {
  'onboarding.errors.roxConnectFailed': 'Failed to start Rox Connect',
  'onboarding.errors.roxConnectIncomplete': 'Rox Connect returned an incomplete device payload',
  'onboarding.roxConnect.expired': 'This Rox Connect code expired. Start again.',
  'onboarding.roxConnect.pollFailed': 'Could not check Rox Connect status.',
}

const RU: Record<(typeof KEYS)[number], string> = {
  'onboarding.errors.roxConnectFailed': 'Не удалось запустить подключение Rox',
  'onboarding.errors.roxConnectIncomplete': 'Подключение Rox вернуло неполный ответ устройства',
  'onboarding.roxConnect.expired': 'Код подключения Rox истёк. Начните заново.',
  'onboarding.roxConnect.pollFailed': 'Не удалось проверить статус подключения Rox.',
}

const en = JSON.parse(readFileSync(join(import.meta.dir, '../locales/en.json'), 'utf8')) as Record<string, string>
const ru = JSON.parse(readFileSync(join(import.meta.dir, '../locales/ru.json'), 'utf8')) as Record<string, string>

describe('leftover Rox Connect wrapping in onboarding copy', () => {
  it('keeps English catalog copy unchanged', () => {
    for (const key of KEYS) {
      expect(en[key]).toBe(EN[key])
      expect(en[key]).toContain('Rox Connect')
    }
    expect(en[SIBLING]).toBe('Connect with Rox')
  })

  it('wraps leftover Connect as подключение and keeps Rox', () => {
    for (const key of KEYS) {
      expect(ru[key]).toBe(RU[key])
      expect(ru[key]).not.toContain('Rox Connect')
      expect(ru[key]).not.toContain('Connect')
      expect(ru[key]).toContain('Rox')
      expect(ru[key]).toMatch(/подключен/i)
      expect(ru[key]).not.toBe(en[key])
    }
    expect(ru[SIBLING]).toBe('Подключить Rox')
  })

  it('resolves Russian through setupI18n without leftover English', async () => {
    await setupI18n().changeLanguage('ru')
    for (const key of KEYS) {
      expect(i18n.t(key)).toBe(RU[key])
      expect(i18n.t(key)).not.toBe(EN[key])
      expect(i18n.t(key)).not.toContain('Rox Connect')
      expect(i18n.t(key)).not.toContain('Connect')
    }
    expect(i18n.t(SIBLING)).toBe('Подключить Rox')
  })

  it('resolves English through setupI18n as the original leftover string', async () => {
    await setupI18n().changeLanguage('en')
    for (const key of KEYS) {
      expect(i18n.t(key)).toBe(EN[key])
      expect(i18n.t(key)).toContain('Rox Connect')
    }
    expect(i18n.t(SIBLING)).toBe('Connect with Rox')
  })
})
