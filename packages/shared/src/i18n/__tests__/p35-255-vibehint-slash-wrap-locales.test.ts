import { describe, expect, it } from 'bun:test'
import { i18n, setupI18n } from '../setupI18n'

const KEY = 'toast.vibeHint'
const LEFTOVER_CALQUE = 'слэш'

describe('P35-255 leftover Russian слэш wrapping on toast.vibeHint', () => {
  it('wraps leftover слэш-синтаксис as синтаксис косой черты', async () => {
    await setupI18n().changeLanguage('ru')
    const value = i18n.t(KEY)
    expect(value.toLowerCase()).not.toContain(LEFTOVER_CALQUE)
    expect(value).toBe('Вайб живёт в Настройках; синтаксис косой черты вторичен')
  })

  it('resolves English through setupI18n after changeLanguage(en)', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe('Vibe stays in Settings; slash syntax is secondary')
    expect(i18n.t(KEY).toLowerCase()).not.toContain(LEFTOVER_CALQUE)
  })
})
