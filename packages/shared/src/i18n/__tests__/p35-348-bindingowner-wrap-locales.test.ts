import { describe, expect, it } from 'bun:test'
import { i18n, setupI18n } from '../setupI18n'

const KEY = 'settings.messaging.telegram.access.bindingPopover.mode.ownerControl.description'
const RU_WRAPPED = 'Только явно разрешённые пользователи могут использовать эту привязку.'
const EN_VALUE = 'Only explicitly allowed users can use this binding.'

describe('P35-348 leftover Russian биндинг wrapping on telegram bindingPopover ownerControl.description', () => {
  it('wraps leftover биндинг as sibling привязка, then English stays English', async () => {
    await setupI18n().changeLanguage('ru')
    const ru = i18n.t(KEY)
    expect(ru).toBe(RU_WRAPPED)
    expect(ru.toLowerCase()).toContain('привязку')
    expect(ru.toLowerCase()).not.toContain('биндинг')
    expect(ru).toContain('эту привязку')

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
