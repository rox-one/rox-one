import { describe, expect, it } from 'bun:test'
import { i18n, setupI18n } from '../setupI18n'

const KEY = 'browser.noInstanceSelected'
const LEFTOVER_CALQUE = 'инстанс'
const SIBLING_CHROME = 'экземпляр'

describe('P35-240 leftover Russian инстанс wrapping on browser.noInstanceSelected', () => {
  it('wraps leftover инстанс as sibling экземпляр', async () => {
    await setupI18n().changeLanguage('ru')
    const value = i18n.t(KEY)
    expect(value).not.toContain(LEFTOVER_CALQUE)
    expect(value).toContain(SIBLING_CHROME)
  })

  it('resolves English through setupI18n after changeLanguage(en)', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe('No browser instance selected')
    expect(i18n.t(KEY)).not.toContain(LEFTOVER_CALQUE)
    expect(i18n.t(KEY)).not.toContain(SIBLING_CHROME)
  })
})
