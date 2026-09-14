import { describe, expect, it } from 'bun:test'
import { setupI18n } from '../setupI18n'

const DESCRIPTION = 'conation.fund.description'
const OFF = 'conation.fund.off'
const OPEN = 'conation.fund.open'
const TITLE = 'conation.fund.title'

describe('P35-130 leftover Fund wrapping in ru conation.fund copy', () => {
  it("changeLanguage('ru') drops leftover English Fund wrapping", async () => {
    const i18n = setupI18n()
    await i18n.changeLanguage('ru')
    const description = i18n.t(DESCRIPTION)
    const off = i18n.t(OFF)
    const open = i18n.t(OPEN)
    const title = i18n.t(TITLE)
    expect(description).toBe(
      'Холст фонда открывается в Conation по глубокой ссылке. Встроенный интерактивный холст остаётся отключённым до проверки производительности.',
    )
    expect(off).toBe('Фонд Conation отключён.')
    expect(open).toBe('Открыть фонд в Conation')
    expect(title).toBe('Фонд Conation')
    expect(description).not.toMatch(/\bFund\b/)
    expect(off).not.toMatch(/\bFund\b/)
    expect(open).not.toMatch(/\bFund\b/)
    expect(title).not.toMatch(/\bFund\b/)
    expect(description).not.toBe(
      'Холст Fund открывается в Conation по глубокой ссылке. Встроенный интерактивный холст остаётся отключённым до проверки производительности.',
    )
    expect(off).not.toBe('Conation Fund отключён.')
    expect(open).not.toBe('Открыть Fund в Conation')
    expect(title).not.toBe('Conation Fund')
  })

  it("changeLanguage('en') still English", async () => {
    const i18n = setupI18n()
    await i18n.changeLanguage('en')
    expect(i18n.t(DESCRIPTION)).toBe(
      'The Fund canvas opens in Conation via a deep link. The live in-app canvas remains off pending performance validation.',
    )
    expect(i18n.t(OFF)).toBe('Conation Fund is off.')
    expect(i18n.t(OPEN)).toBe('Open Fund in Conation')
    expect(i18n.t(TITLE)).toBe('Conation Fund')
  })
})
