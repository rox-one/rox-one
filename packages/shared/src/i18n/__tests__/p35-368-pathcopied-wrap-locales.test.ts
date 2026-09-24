import { describe, expect, it } from 'bun:test'
import { i18n, setupI18n } from '../setupI18n'

const KEY = 'notes.toast.pathCopied'
const RU_WRAPPED = 'Путь Markdown скопирован'
const EN_VALUE = 'Markdown path copied'

describe('P35-368 leftover Russian markdown wrapping on notes.toast.pathCopied', () => {
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
    expect(i18n.t(KEY)).toBe('Markdown path copied')
    expect(i18n.t(KEY)).not.toBe(RU_WRAPPED)
  })
})
