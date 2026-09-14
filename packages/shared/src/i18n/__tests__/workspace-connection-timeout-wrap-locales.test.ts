import { describe, expect, it } from 'bun:test'
import { setupI18n } from '../setupI18n'

const KEY = 'workspace.connectionTimeout'
const RU = 'Не удалось дождаться подключения к рабочему пространству за {{ms}} мс'
const EN = 'Timed out waiting for workspace connection after {{ms}}ms'

describe('P35-144 leftover workspace wrapping in workspace.connectionTimeout', () => {
  it('changeLanguage(en) keeps English workspace wrapping', async () => {
    const i18n = setupI18n()
    await i18n.changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN)
    expect(i18n.t(KEY)).toMatch(/workspace/i)
    expect(i18n.t(KEY)).toContain('{{ms}}')
  })

  it('changeLanguage(ru) drops leftover воркспейс wrapping', async () => {
    const i18n = setupI18n()
    await i18n.changeLanguage('ru')
    const ru = i18n.t(KEY)
    expect(ru).toBe(RU)
    expect(ru).toMatch(/рабоч/i)
    expect(ru).toContain('{{ms}}')
    expect(ru).not.toMatch(/[Вв]оркспейс/)
    expect(ru).not.toMatch(/\bworkspace\b/i)
    expect(ru).not.toBe(EN)
  })
})
