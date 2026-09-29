import { describe, expect, it } from 'bun:test'
import { i18n, setupI18n } from '../setupI18n'

const KEY = 'settings.messaging.discord.tokenLabel'
const RU_WRAPPED = 'Токен бота'
const EN_VALUE = 'Bot Token'
const SIBLING_KEY = 'settings.messaging.telegram.tokenLabel'

describe('P35-393 leftover English Bot Token wrapping on settings.messaging.discord.tokenLabel', () => {
  it('wraps leftover Bot Token as sibling Токен бота, then English stays English', async () => {
    await setupI18n().changeLanguage('ru')
    const ru = i18n.t(KEY)
    expect(ru).toBe(RU_WRAPPED)
    expect(ru).toBe(i18n.t(SIBLING_KEY))
    expect(ru).not.toContain('Bot Token')

    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN_VALUE)
  })

  it('resolves English through setupI18n after changeLanguage(en)', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN_VALUE)
  })
})
