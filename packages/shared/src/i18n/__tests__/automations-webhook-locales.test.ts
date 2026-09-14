import { describe, expect, it } from 'bun:test'
import { setupI18n } from '../setupI18n'

const KEY = 'automations.badgeWebhook'

describe('P35-127 automations webhook leftover wrapping', () => {
  it("changeLanguage('ru') drops leftover English Webhook wrapping", async () => {
    const i18n = setupI18n()
    await i18n.changeLanguage('ru')
    const ru = i18n.t(KEY)
    expect(ru).toBe('Вебхук')
    expect(ru).not.toMatch(/\bWebhook\b/)
    expect(ru).not.toBe('Webhook')
  })

  it("changeLanguage('en') still English", async () => {
    const i18n = setupI18n()
    await i18n.changeLanguage('en')
    expect(i18n.t(KEY)).toBe('Webhook')
  })
})
