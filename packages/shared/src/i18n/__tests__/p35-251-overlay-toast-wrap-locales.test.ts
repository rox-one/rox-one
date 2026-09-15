import { describe, expect, it } from 'bun:test'
import { i18n, setupI18n } from '../setupI18n'

const KEY = 'toast.terminalOverlayNotAvailable'
const LEFTOVER_CALQUE = 'оверлей'
const SIBLING_OVERLAY_CHROME = 'предпросмотр'

describe('P35-251 leftover Russian оверлей wrapping on toast.terminalOverlayNotAvailable', () => {
  it('wraps leftover оверлей as sibling предпросмотр from overlay chrome', async () => {
    await setupI18n().changeLanguage('ru')
    const value = i18n.t(KEY)
    expect(value.toLowerCase()).not.toContain(LEFTOVER_CALQUE)
    expect(value.toLowerCase()).toContain(SIBLING_OVERLAY_CHROME)
    expect(value).toContain('терминала')
    expect(value).toContain('недоступен')
  })

  it('resolves English through setupI18n after changeLanguage(en)', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe('Terminal overlay not available')
    expect(i18n.t(KEY).toLowerCase()).not.toContain(LEFTOVER_CALQUE)
    expect(i18n.t(KEY).toLowerCase()).not.toContain(SIBLING_OVERLAY_CHROME)
  })
})
