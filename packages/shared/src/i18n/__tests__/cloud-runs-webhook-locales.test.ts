import { describe, expect, it } from 'bun:test'
import { setupI18n } from '../setupI18n'

const KEY = 'settings.cloudRuns.webhook'

describe('P35-126 cloudRuns webhook leftover wrapping', () => {
  it("changeLanguage('ru') drops leftover English Webhook wrapping", async () => {
    const i18n = setupI18n()
    await i18n.changeLanguage('ru')
    const ru = i18n.t(KEY)
    expect(ru).toBe('Вебхук по завершению')
    expect(ru).not.toMatch(/\bWebhook\b/)
    expect(ru).not.toBe('Completion webhook')
  })

  it("changeLanguage('en') still English", async () => {
    const i18n = setupI18n()
    await i18n.changeLanguage('en')
    expect(i18n.t(KEY)).toBe('Completion webhook')
  })
})
