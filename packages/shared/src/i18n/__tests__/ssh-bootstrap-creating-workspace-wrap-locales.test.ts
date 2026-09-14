import { describe, expect, it } from 'bun:test'
import { setupI18n } from '../setupI18n'

const KEY = 'ssh.bootstrap.phase.creating-workspace'
const RU = 'Создание рабочего пространства'
const EN = 'Creating workspace'

describe('P35-145 leftover workspace wrapping in ssh.bootstrap.phase.creating-workspace', () => {
  it('changeLanguage(en) keeps English workspace wrapping', async () => {
    const i18n = setupI18n()
    await i18n.changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN)
    expect(i18n.t(KEY)).toMatch(/workspace/i)
  })

  it('changeLanguage(ru) drops leftover воркспейс wrapping', async () => {
    const i18n = setupI18n()
    await i18n.changeLanguage('ru')
    const ru = i18n.t(KEY)
    expect(ru).toBe(RU)
    expect(ru).toMatch(/рабоч/i)
    expect(ru).not.toMatch(/[Вв]оркспейс/)
    expect(ru).not.toMatch(/\bworkspace\b/i)
    expect(ru).not.toBe(EN)
  })
})
