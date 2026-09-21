import { describe, expect, it } from 'bun:test'
import { i18n, setupI18n } from '../setupI18n'

const KEY = 'settings.messaging.telegram.access.bindingPopover.mode.disabled.description'
const RU_WRAPPED = 'Бот игнорирует все сообщения этой привязки.'
const EN_VALUE = 'Bot ignores all messages from this binding.'

describe('P35-347 leftover Russian биндинг wrapping on telegram bindingPopover disabled.description', () => {
  it('wraps leftover биндинг as sibling привязка, then English stays English', async () => {
    await setupI18n().changeLanguage('ru')
    const ru = i18n.t(KEY)
    expect(ru).toBe(RU_WRAPPED)
    expect(ru.toLowerCase()).toContain('привязки')
    expect(ru.toLowerCase()).not.toContain('биндинг')
    expect(ru).toContain('этой привязки')

    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN_VALUE)
  })

  it('resolves English through setupI18n after changeLanguage(en)', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN_VALUE)
    expect(i18n.t(KEY).toLowerCase()).not.toContain('биндинг')
    expect(i18n.t(KEY).toLowerCase()).not.toContain('привязк')
  })
})
