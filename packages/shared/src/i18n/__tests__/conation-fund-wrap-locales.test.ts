import { describe, expect, it } from 'bun:test'
import { setupI18n } from '../setupI18n'

const DESCRIPTION = 'conation.fund.description'
const OFF = 'conation.fund.off'
const OPEN = 'conation.fund.open'
const TITLE = 'conation.fund.title'

describe('P35-130 leftover Fund wrapping in ru conation.fund copy', () => {
  it("changeLanguage('ru') keeps product name Fund with Russian wrapping", async () => {
    const i18n = setupI18n()
    await i18n.changeLanguage('ru')
    const description = i18n.t(DESCRIPTION)
    const off = i18n.t(OFF)
    const open = i18n.t(OPEN)
    const title = i18n.t(TITLE)
    expect(description).toBe(
      'Холст Fund открывается в Conation по глубокой ссылке. Встроенный интерактивный холст остаётся отключённым до проверки производительности.',
    )
    expect(off).toBe('Conation Fund отключён.')
    expect(open).toBe('Открыть Fund в Conation')
    expect(title).toBe('Conation Fund')
    expect(description).toMatch(/\bFund\b/)
    expect(off).toMatch(/\bFund\b/)
    expect(open).toMatch(/\bFund\b/)
    expect(title).toMatch(/\bFund\b/)
    expect(description).toMatch(/\bConation\b/)
    expect(off).toMatch(/\bConation\b/)
    expect(open).toMatch(/\bConation\b/)
    expect(title).toMatch(/\bConation\b/)
    expect(description).not.toMatch(/фонд/i)
    expect(off).not.toMatch(/фонд/i)
    expect(open).not.toMatch(/фонд/i)
    expect(title).not.toMatch(/фонд/i)
    expect(description).not.toBe(
      'The Fund canvas opens in Conation via a deep link. The live in-app canvas remains off pending performance validation.',
    )
    expect(off).not.toBe('Conation Fund is off.')
    expect(open).not.toBe('Open Fund in Conation')
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
