import { describe, expect, it } from 'bun:test'
import { setupI18n } from '../setupI18n'

const MANAGED = 'settings.accounts.managedInAi'
const OPEN = 'settings.accounts.openAiSettings'

describe('P35-128 leftover Settings wrapping in ru accounts copy', () => {
  it("changeLanguage('ru') drops leftover English Settings wrapping", async () => {
    const i18n = setupI18n()
    await i18n.changeLanguage('ru')
    const managed = i18n.t(MANAGED)
    const open = i18n.t(OPEN)
    expect(managed).toBe('Управляется в настройках ИИ')
    expect(open).toBe('Открыть настройки ИИ')
    expect(managed).not.toMatch(/\bSettings\b/)
    expect(open).not.toMatch(/\bSettings\b/)
    expect(managed).not.toBe('Managed in AI Settings')
    expect(open).not.toBe('Open AI Settings')
  })

  it("changeLanguage('en') still English", async () => {
    const i18n = setupI18n()
    await i18n.changeLanguage('en')
    expect(i18n.t(MANAGED)).toBe('Managed in AI Settings')
    expect(i18n.t(OPEN)).toBe('Open AI Settings')
  })
})
