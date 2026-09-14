import { describe, expect, it } from 'bun:test'
import { setupI18n } from '../setupI18n'

const KEY = 'dialog.wechat.description'
const RU =
  'Привяжите ваш личный WeChat, чтобы отправлять и получать сообщения из этого рабочего пространства.'
const EN = 'Link your personal WeChat to send and receive messages from this workspace.'

describe('P35-147 leftover workspace wrapping in dialog.wechat.description', () => {
  it('changeLanguage(en) keeps English workspace wrapping', async () => {
    const i18n = setupI18n()
    await i18n.changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN)
    expect(i18n.t(KEY)).toMatch(/workspace/i)
    expect(i18n.t(KEY)).toContain('WeChat')
  })

  it('changeLanguage(ru) drops leftover воркспейс wrapping', async () => {
    const i18n = setupI18n()
    await i18n.changeLanguage('ru')
    const ru = i18n.t(KEY)
    expect(ru).toBe(RU)
    expect(ru).toMatch(/рабоч/i)
    expect(ru).not.toMatch(/[Вв]оркспейс/)
    expect(ru).not.toMatch(/\bworkspace\b/i)
    expect(ru).toContain('WeChat')
    expect(ru).not.toBe(EN)
  })
})
