import { describe, expect, it } from 'bun:test'
import { setupI18n } from '../setupI18n'

const KEY = 'apiSetup.sessionTokenOptional'
const LEFTOVER_ENGLISH = 'Session Token'

describe('apiSetup.sessionTokenOptional leftover English (P35-112)', () => {
  it('Russian copy is not leftover mixed English Session Token', async () => {
    const i18n = setupI18n()
    await i18n.changeLanguage('ru')
    const ru = i18n.t(KEY)
    expect(ru).toBe('Токен сессии · необязательно')
    expect(ru).not.toContain(LEFTOVER_ENGLISH)
    expect(ru).not.toBe('Session Token · необязательно')
  })

  it('English locale still uses Session Token', async () => {
    const i18n = setupI18n()
    await i18n.changeLanguage('en')
    expect(i18n.t(KEY)).toBe('Session Token · optional')
    expect(i18n.t(KEY)).toContain(LEFTOVER_ENGLISH)
  })
})
