import { describe, expect, it } from 'bun:test'
import { i18n, setupI18n } from '../setupI18n'

const KEY = 'settings.appearance.workbenchHarnessChatChrome'
const LEFTOVER_CALQUE = 'хром'
const SIBLING_CHROME = 'Панель'

describe('P35-249 leftover Russian хром wrapping on settings.appearance.workbenchHarnessChatChrome', () => {
  it('wraps leftover Хром чата as sibling Панель чата', async () => {
    await setupI18n().changeLanguage('ru')
    const value = i18n.t(KEY)
    expect(value.toLowerCase()).not.toContain(LEFTOVER_CALQUE)
    expect(value).not.toContain('Хром')
    expect(value).toContain(SIBLING_CHROME)
    expect(value).toContain('чата')
  })

  it('resolves English through setupI18n after changeLanguage(en)', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe('Chat chrome')
  })
})
