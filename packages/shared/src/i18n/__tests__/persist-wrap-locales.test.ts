import { describe, expect, it } from 'bun:test'
import { setupI18n } from '../setupI18n'
import i18n from 'i18next'

const KEYS = [
  'settings.import.empty',
  'meetings.openFailed',
  'meetings.persistMiss',
  'meetings.revisionRequired',
] as const

const CYRILLIC = /[А-Яа-яЁё]/

describe('P35-137 leftover persist wrapping', () => {
  it('Russian wrapping is Russian; Persist stays the identifier', async () => {
    await setupI18n().changeLanguage('ru')
    expect(i18n.t('settings.import.empty')).toBe(
      'Сканирование только список. Импорт — только после Persist.',
    )
    expect(i18n.t('meetings.openFailed')).toBe('Не удалось открыть цель Persist')
    expect(i18n.t('meetings.persistMiss')).toBe(
      'Цель Persist отсутствует или ревизия не совпадает',
    )
    expect(i18n.t('meetings.revisionRequired')).toBe(
      'Открытие заблокировано: нужна Persist-ревизия',
    )
    for (const key of KEYS) {
      const value = i18n.t(key)
      expect(value, key).toMatch(CYRILLIC)
      expect(value, key).toContain('Persist')
      expect(value, key).not.toMatch(/(^|[^A-Za-z])persist([^A-Za-z]|$)/)
    }
  })

  it('English copy stays English', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t('settings.import.empty')).toBe(
      'Scan to list local chats. Nothing is imported until you persist.',
    )
    expect(i18n.t('meetings.openFailed')).toBe('Could not open the persist target')
    expect(i18n.t('meetings.persistMiss')).toBe(
      'Persist target is missing or revision does not match',
    )
    expect(i18n.t('meetings.revisionRequired')).toBe(
      'Open blocked: persist revision is required',
    )
  })
})
