import { describe, expect, it } from 'bun:test'
import { setupI18n } from '../setupI18n'

const OFF = 'conation.board.off'
const OPEN = 'conation.board.open'
const TITLE = 'conation.board.title'

describe('P35-129 leftover Board wrapping in ru conation.board copy', () => {
  it("changeLanguage('ru') drops leftover English Board wrapping", async () => {
    const i18n = setupI18n()
    await i18n.changeLanguage('ru')
    const off = i18n.t(OFF)
    const open = i18n.t(OPEN)
    const title = i18n.t(TITLE)
    expect(off).toBe('Панель доски Conation отключена.')
    expect(open).toBe('Открыть доску в Conation')
    expect(title).toBe('Доска Conation')
    expect(off).not.toMatch(/\bBoard\b/)
    expect(open).not.toMatch(/\bBoard\b/)
    expect(title).not.toMatch(/\bBoard\b/)
    expect(off).not.toBe('Панель Conation Board отключена.')
    expect(open).not.toBe('Открыть Board в Conation')
    expect(title).not.toBe('Conation Board')
  })

  it("changeLanguage('en') still English", async () => {
    const i18n = setupI18n()
    await i18n.changeLanguage('en')
    expect(i18n.t(OFF)).toBe('Conation Board is off.')
    expect(i18n.t(OPEN)).toBe('Open Board in Conation')
    expect(i18n.t(TITLE)).toBe('Conation Board')
  })
})
