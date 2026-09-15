import { describe, expect, it } from 'bun:test'
import { i18n, setupI18n } from '../setupI18n'

const KEY = 'settings.appearance.workbenchBrowserSurfaceDesc'
const LEFTOVER_CALQUE = 'бейдж'
const SIBLING_CHROME = 'значками'

describe('P35-236 leftover Russian бейдж wrapping on settings.appearance.workbenchBrowserSurfaceDesc', () => {
  it('wraps leftover бейджами as sibling значками', async () => {
    await setupI18n().changeLanguage('ru')
    expect(i18n.t(KEY)).not.toContain(LEFTOVER_CALQUE)
    expect(i18n.t(KEY)).toContain(SIBLING_CHROME)
  })

  it('resolves English through setupI18n after changeLanguage(en)', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe('Show OS browser windows in the surface tab strip instead of the top-bar badges')
    expect(i18n.t(KEY)).toContain('badges')
    expect(i18n.t(KEY)).not.toContain(LEFTOVER_CALQUE)
    expect(i18n.t(KEY)).not.toContain(SIBLING_CHROME)
  })
})
