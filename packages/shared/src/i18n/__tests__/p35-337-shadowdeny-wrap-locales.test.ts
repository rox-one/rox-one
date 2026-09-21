import { describe, expect, it } from 'bun:test'
import { i18n, setupI18n } from '../setupI18n'

const KEY = 'chat.permissionShadow.deny'
const RU_WRAPPED = 'Теневая проверка: запретить'
const EN_VALUE = 'Shadow review: deny'

describe('P35-337 leftover Russian ревью wrapping on chat.permissionShadow.deny', () => {
  it('wraps leftover ревью as sibling проверка, then English stays English', async () => {
    await setupI18n().changeLanguage('ru')
    const ru = i18n.t(KEY)
    expect(ru).toBe(RU_WRAPPED)
    expect(ru).toContain('проверка')
    expect(ru.toLowerCase()).not.toContain('ревью')

    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN_VALUE)
  })

  it('resolves English through setupI18n after changeLanguage(en)', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN_VALUE)
    expect(i18n.t(KEY).toLowerCase()).not.toContain('ревью')
    expect(i18n.t(KEY).toLowerCase()).not.toContain('проверка')
  })
})
