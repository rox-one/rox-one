import { describe, expect, it } from 'bun:test'
import { setupI18n } from '../setupI18n'

const KEYS = ['settings.accounts.noWorkspace', 'settings.import.scanHint'] as const

describe('P35-123 leftover workspace wrapping in settings ru.json', () => {
  it('changeLanguage(en) keeps English workspace wrapping', async () => {
    const i18n = setupI18n()
    await i18n.changeLanguage('en')
    expect(i18n.t('settings.accounts.noWorkspace')).toBe('Select a workspace first')
    expect(i18n.t('settings.import.scanHint')).toBe(
      'Scan is not import. Persist writes Rox chats in this workspace.',
    )
    for (const key of KEYS) {
      expect(i18n.t(key)).toMatch(/workspace/i)
    }
  })

  it('changeLanguage(ru) drops leftover English workspace wrapping', async () => {
    const i18n = setupI18n()
    await i18n.changeLanguage('ru')
    expect(i18n.t('settings.accounts.noWorkspace')).toBe(
      'Сначала выберите рабочее пространство',
    )
    expect(i18n.t('settings.import.scanHint')).toBe(
      'Скан ≠ импорт. Persist пишет чаты Rox в это рабочее пространство.',
    )
    for (const key of KEYS) {
      const ru = i18n.t(key)
      expect(ru).not.toMatch(/\bworkspace\b/i)
      expect(ru).not.toBe(i18n.t(key, { lng: 'en' }))
    }
  })
})
