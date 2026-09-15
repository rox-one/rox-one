import { describe, expect, it } from 'bun:test'
import { i18n, setupI18n } from '../setupI18n'

const KEY = 'settings.appearance.workbenchTopChrome'
const LEFTOVER_CALQUE = 'хром'
const SIBLING_CHROME = 'Верхняя панель'

describe('P35-247 leftover Russian хром wrapping on settings.appearance.workbenchTopChrome', () => {
  it('wraps leftover Верхний хром as sibling Верхняя панель and keeps v2', async () => {
    await setupI18n().changeLanguage('ru')
    const value = i18n.t(KEY)
    expect(value.toLowerCase()).not.toContain(LEFTOVER_CALQUE)
    expect(value).toContain(SIBLING_CHROME)
    expect(value).toContain('v2')
  })

  it('resolves English through setupI18n after changeLanguage(en)', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe('Top chrome v2')
  })
})
