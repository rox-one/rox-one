import { describe, expect, it } from 'bun:test'
import { i18n, setupI18n } from '../setupI18n'

const KEY = 'settings.appearance.workbenchTopChromeDesc'
const LEFTOVER_CALQUE = 'рейк'
const WRAPPED_PHRASE = 'утилитарная панель'
const RU_WRAPPED = 'Панель режимов и утилитарная панель (поиск, новая сессия, настройки)'
const EN_VALUE = 'Mode bar plus a utility rail (search, new session, settings)'

describe('P35-280 leftover Russian рейка wrapping on settings.appearance.workbenchTopChromeDesc', () => {
  it('wraps leftover утилитарная рейка as sibling утилитарная панель, then English stays English', async () => {
    await setupI18n().changeLanguage('ru')
    const ru = i18n.t(KEY)
    expect(ru).toBe(RU_WRAPPED)
    expect(ru).toContain(WRAPPED_PHRASE)
    expect(ru.toLowerCase()).not.toContain(LEFTOVER_CALQUE)

    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN_VALUE)
  })

  it('resolves English through setupI18n after changeLanguage(en)', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN_VALUE)
  })
})
