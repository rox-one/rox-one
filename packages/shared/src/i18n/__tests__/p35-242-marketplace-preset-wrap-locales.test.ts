import { describe, expect, it } from 'bun:test'
import { i18n, setupI18n } from '../setupI18n'

const KEY = 'settings.marketplace.description'
const LEFTOVER_CALQUE = 'пресет'
const SIBLING_CHROME = 'шаблон'

describe('P35-242 leftover Russian пресет wrapping on settings.marketplace.description', () => {
  it('wraps leftover пресетов as sibling шаблонов', async () => {
    await setupI18n().changeLanguage('ru')
    const value = i18n.t(KEY)
    expect(value.toLowerCase()).not.toContain(LEFTOVER_CALQUE)
    expect(value.toLowerCase()).toContain(SIBLING_CHROME)
  })

  it('resolves English through setupI18n after changeLanguage(en)', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe('Browse and install skills, presets, and packs')
    expect(i18n.t(KEY).toLowerCase()).not.toContain(LEFTOVER_CALQUE)
    expect(i18n.t(KEY).toLowerCase()).not.toContain(SIBLING_CHROME)
  })
})
