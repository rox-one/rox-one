import { describe, expect, it } from 'bun:test'
import { i18n, setupI18n } from '../setupI18n'

const KEY = 'knowledge.surface.copy.markdown'
const RU_WRAPPED = 'Копировать Markdown'
const EN_VALUE = 'Copy markdown'

describe('P35-365 leftover Russian markdown wrapping on knowledge.surface.copy.markdown', () => {
  it('wraps leftover lowercase markdown as sibling Markdown, then English stays English', async () => {
    await setupI18n().changeLanguage('ru')
    const ru = i18n.t(KEY)
    expect(ru).toBe(RU_WRAPPED)
    expect(ru).toContain('Markdown')
    expect(ru).not.toContain('markdown')

    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN_VALUE)
  })

  it('resolves English through setupI18n after changeLanguage(en)', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN_VALUE)
    expect(i18n.t(KEY)).toBe('Copy markdown')
    expect(i18n.t(KEY)).not.toBe(RU_WRAPPED)
  })
})
