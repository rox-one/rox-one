import { describe, expect, it } from 'bun:test'
import { setupI18n, i18n } from '../setupI18n'

const KEYS = [
  'settings.accounts.managedInKnowledge',
  'settings.accounts.openKnowledgeSettings',
  'settings.knowledge.metrics.surfaceOpens',
] as const

describe('P35-120 leftover Knowledge wrapping in accounts/metrics', () => {
  it('Russian copy drops leftover English Knowledge wrapping', async () => {
    await setupI18n().changeLanguage('ru')

    for (const key of KEYS) {
      const value = i18n.t(key)
      expect(value, key).not.toBe(key)
      expect(value, key).toContain('База знаний')
      expect(value, key).not.toMatch(/\bKnowledge\b/)
    }

    expect(i18n.t('settings.accounts.managedInKnowledge')).toBe(
      'Управляется в настройках «База знаний»',
    )
    expect(i18n.t('settings.accounts.openKnowledgeSettings')).toBe(
      'Открыть настройки «База знаний»',
    )
    expect(i18n.t('settings.knowledge.metrics.surfaceOpens')).toBe(
      'Открытия поверхности «База знаний»',
    )
  })

  it('English copy still uses Knowledge wrapping', async () => {
    await setupI18n().changeLanguage('en')

    for (const key of KEYS) {
      const value = i18n.t(key)
      expect(value, key).not.toBe(key)
      expect(value, key).toMatch(/\bKnowledge\b/)
      expect(value, key).not.toContain('База знаний')
    }

    expect(i18n.t('settings.accounts.managedInKnowledge')).toBe(
      'Managed in Knowledge settings',
    )
    expect(i18n.t('settings.accounts.openKnowledgeSettings')).toBe(
      'Open Knowledge Settings',
    )
    expect(i18n.t('settings.knowledge.metrics.surfaceOpens')).toBe(
      'Knowledge surface opens',
    )
  })
})
