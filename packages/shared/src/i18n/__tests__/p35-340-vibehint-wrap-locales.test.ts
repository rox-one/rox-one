import { describe, expect, it } from 'bun:test'
import { i18n, setupI18n } from '../setupI18n'

const KEY = 'toast.vibeHint'
const RU_WRAPPED = 'Творческий сценарий живёт в Настройках; синтаксис косой черты вторичен'
const EN_VALUE = 'Vibe stays in Settings; slash syntax is secondary'

describe('P35-340 leftover Russian вайб wrapping on toast.vibeHint', () => {
  it('wraps leftover вайб as sibling творческий сценарий, then English stays English', async () => {
    await setupI18n().changeLanguage('ru')
    const ru = i18n.t(KEY)
    expect(ru).toBe(RU_WRAPPED)
    expect(ru.toLowerCase()).toContain('творческий сценарий')
    expect(ru.toLowerCase()).not.toContain('вайб')

    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN_VALUE)
  })

  it('resolves English through setupI18n after changeLanguage(en)', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN_VALUE)
    expect(i18n.t(KEY).toLowerCase()).not.toContain('вайб')
    expect(i18n.t(KEY).toLowerCase()).not.toContain('творческий сценарий')
  })
})
