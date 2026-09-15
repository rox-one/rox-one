import { describe, expect, it } from 'bun:test'
import { i18n, setupI18n } from '../setupI18n'

const KEY = 'knowledge.diff.patch'
const LEFTOVER_CALQUE = 'патч'
const SIBLING_DIFF_EDIT = 'правка'

describe('P35-253 leftover Russian патч wrapping on knowledge.diff.patch', () => {
  it('wraps leftover патч as sibling правка from knowledge.diff copy', async () => {
    await setupI18n().changeLanguage('ru')
    const value = i18n.t(KEY)
    expect(value.toLowerCase()).not.toContain(LEFTOVER_CALQUE)
    expect(value.toLowerCase()).toContain(SIBLING_DIFF_EDIT)
    expect(value).toBe('Правка')
  })

  it('resolves English through setupI18n after changeLanguage(en)', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe('Patch')
    expect(i18n.t(KEY).toLowerCase()).not.toContain(LEFTOVER_CALQUE)
    expect(i18n.t(KEY).toLowerCase()).not.toContain(SIBLING_DIFF_EDIT)
  })
})
