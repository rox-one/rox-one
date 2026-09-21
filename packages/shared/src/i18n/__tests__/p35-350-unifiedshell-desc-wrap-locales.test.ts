import { describe, expect, it } from 'bun:test'
import { i18n, setupI18n } from '../setupI18n'

const KEY = 'settings.appearance.workbenchUnifiedShellDesc'
const RU_WRAPPED = 'Макет единой оболочки W1 вокруг стека панелей'
const EN_VALUE = 'W1 unified shell layout around the panel stack'

describe('P35-350 leftover Russian unified shell wrapping on settings.appearance.workbenchUnifiedShellDesc', () => {
  it('wraps leftover unified shell as sibling единая оболочка, then English stays English', async () => {
    await setupI18n().changeLanguage('ru')
    const ru = i18n.t(KEY)
    expect(ru).toBe(RU_WRAPPED)
    expect(ru.toLowerCase()).toContain('единой оболочки')
    expect(ru.toLowerCase()).not.toContain('unified shell')
    expect(ru).toContain('W1')

    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN_VALUE)
  })

  it('resolves English through setupI18n after changeLanguage(en)', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN_VALUE)
    expect(i18n.t(KEY)).toContain('unified shell')
    expect(i18n.t(KEY).toLowerCase()).not.toContain('единой оболоч')
  })
})
