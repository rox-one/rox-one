import { describe, expect, it } from 'bun:test'
import { i18n, setupI18n } from '../setupI18n'

const KEY = 'settings.input.voiceOverlayPosition'
const LEFTOVER_CALQUE = 'оверлей'
const SIBLING_OVERLAY_CHROME = 'предпросмотр'

describe('P35-252 leftover Russian оверлея wrapping on settings.input.voiceOverlayPosition', () => {
  it('wraps leftover оверлея as sibling предпросмотр from overlay chrome', async () => {
    await setupI18n().changeLanguage('ru')
    const value = i18n.t(KEY)
    expect(value.toLowerCase()).not.toContain(LEFTOVER_CALQUE)
    expect(value.toLowerCase()).toContain(SIBLING_OVERLAY_CHROME)
    expect(value).toBe('Положение предпросмотра')
  })

  it('resolves English through setupI18n after changeLanguage(en)', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe('Overlay position')
    expect(i18n.t(KEY).toLowerCase()).not.toContain(LEFTOVER_CALQUE)
    expect(i18n.t(KEY).toLowerCase()).not.toContain(SIBLING_OVERLAY_CHROME)
  })
})
