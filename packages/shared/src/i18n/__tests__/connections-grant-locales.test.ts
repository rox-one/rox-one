import { describe, expect, it } from 'bun:test'
import { setupI18n } from '../setupI18n'

const SLICE_KEYS = [
  'connections.policies.add',
  'connections.policies.empty',
  'connections.unbind',
] as const

const HONESTY_KEYS = ['meetings.grantRequired', 'settings.rox2.grantRequired'] as const

describe('P35-162 leftover grant wrapping in connections.policies / unbind', () => {
  it('Russian wrapping has no leftover Latin grant / Grant\'ов', async () => {
    const i18n = setupI18n()
    await i18n.changeLanguage('ru')

    expect(i18n.t('connections.policies.add')).toBe('Добавить разрешение')
    expect(i18n.t('connections.policies.empty')).toBe('Разрешений пока нет.')
    expect(i18n.t('connections.unbind')).toBe('Снять разрешение')

    for (const key of SLICE_KEYS) {
      const value = i18n.t(key)
      expect(value, key).not.toMatch(/grant/i)
      expect(value, key).not.toMatch(/Grant'ов/)
      expect(value, key).not.toBe(key)
    }

    expect(i18n.t('meetings.grantRequired')).toBe('Применение заблокировано: нужен грант')
    expect(i18n.t('settings.rox2.grantRequired')).toBe('Для этого действия нужно явное разрешение')
  })

  it('English catalog still uses grant as the common noun', async () => {
    const i18n = setupI18n()
    await i18n.changeLanguage('en')

    expect(i18n.t('connections.policies.add')).toBe('Add grant')
    expect(i18n.t('connections.policies.empty')).toBe('No grants yet.')
    expect(i18n.t('connections.unbind')).toBe('Remove grant')

    for (const key of HONESTY_KEYS) {
      expect(i18n.t(key), key).toBeTruthy()
      expect(i18n.t(key), key).not.toBe(key)
    }
  })
})
