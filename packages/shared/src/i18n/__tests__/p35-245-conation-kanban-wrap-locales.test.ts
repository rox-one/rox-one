import { describe, expect, it } from 'bun:test'
import { i18n, setupI18n } from '../setupI18n'

const KEY = 'conation.board.description'
const LEFTOVER_CALQUE = 'канбан'

describe('P35-245 leftover Russian канбан wrapping on conation.board.description', () => {
  it('wraps leftover вторая канбан-доска as sibling вторая доска and keeps Conation', async () => {
    await setupI18n().changeLanguage('ru')
    const value = i18n.t(KEY)
    expect(value.toLowerCase()).not.toContain(LEFTOVER_CALQUE)
    expect(value).toContain('вторая доска')
    expect(value).toContain('Conation')
  })

  it('resolves English through setupI18n after changeLanguage(en)', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe('Board opens in Conation via a deep link. No second in-app kanban.')
    expect(i18n.t(KEY)).toContain('Conation')
  })
})
