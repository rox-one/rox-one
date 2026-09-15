import { describe, expect, it } from 'bun:test'
import { i18n, setupI18n } from '../setupI18n'

const KEY = 'projectInfo.iconHint'
const LEFTOVER_CALQUE = 'канбан'

describe('P35-244 leftover Russian канбана wrapping on projectInfo.iconHint', () => {
  it('wraps leftover на карточках канбана as sibling на карточках доски', async () => {
    await setupI18n().changeLanguage('ru')
    const value = i18n.t(KEY)
    expect(value.toLowerCase()).not.toContain(LEFTOVER_CALQUE)
    expect(value).toContain('на карточках доски')
  })

  it('resolves English through setupI18n after changeLanguage(en)', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe('Shown in the projects list and on kanban cards.')
    expect(i18n.t(KEY).toLowerCase()).not.toContain(LEFTOVER_CALQUE)
  })
})
