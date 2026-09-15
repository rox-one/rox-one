import { describe, expect, it } from 'bun:test'
import { i18n, setupI18n } from '../setupI18n'

const KEY = 'settings.appearance.kanbanBoard'
const LEFTOVER_CALQUE = 'канбан'
const SIBLING_CHROME = 'доск'

describe('P35-243 leftover Russian канбан wrapping on settings.appearance.kanbanBoard', () => {
  it('wraps leftover Канбан-доска as sibling Доска', async () => {
    await setupI18n().changeLanguage('ru')
    const value = i18n.t(KEY)
    expect(value.toLowerCase()).not.toContain(LEFTOVER_CALQUE)
    expect(value.toLowerCase()).toContain(SIBLING_CHROME)
  })

  it('resolves English through setupI18n after changeLanguage(en)', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe('Kanban board')
    expect(i18n.t(KEY).toLowerCase()).not.toContain(LEFTOVER_CALQUE)
    expect(i18n.t(KEY).toLowerCase()).not.toContain(SIBLING_CHROME)
  })
})
