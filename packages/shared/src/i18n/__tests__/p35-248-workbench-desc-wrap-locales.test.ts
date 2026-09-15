import { describe, expect, it } from 'bun:test'
import { i18n, setupI18n } from '../setupI18n'

const KEY = 'settings.appearance.workbenchDesc'
const LEFTOVER_CALQUE = 'хром'
const SIBLING_CHROME = 'панел'

describe('P35-248 leftover Russian хрома wrapping on settings.appearance.workbenchDesc', () => {
  it('wraps leftover хрома as sibling панели and keeps оболочки', async () => {
    await setupI18n().changeLanguage('ru')
    const value = i18n.t(KEY)
    expect(value.toLowerCase()).not.toContain(LEFTOVER_CALQUE)
    expect(value).toContain(SIBLING_CHROME)
    expect(value).toContain('оболочки')
    expect(value).toContain('Предпросмотр')
  })

  it('resolves English through setupI18n after changeLanguage(en)', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(
      'Preview the next shell chrome. Experimental flags default on; the unified-shell master stays off.',
    )
  })
})
