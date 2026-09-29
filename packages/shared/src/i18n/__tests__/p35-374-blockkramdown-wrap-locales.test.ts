import { describe, expect, it } from 'bun:test'
import { i18n, setupI18n } from '../setupI18n'

const KEY = 'knowledge.surface.copy.blockKramdown'
const RU_WRAPPED = 'Копировать Kramdown блока'
const EN_VALUE = 'Copy block kramdown'

describe('P35-374 leftover Russian kramdown wrapping on knowledge.surface.copy.blockKramdown', () => {
  it('wraps leftover kramdown as sibling Kramdown, then English stays English', async () => {
    await setupI18n().changeLanguage('ru')
    const ru = i18n.t(KEY)
    expect(ru).toBe(RU_WRAPPED)
    expect(ru).toContain('Kramdown')
    expect(ru).not.toContain('kramdown')

    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN_VALUE)
  })

  it('resolves English through setupI18n after changeLanguage(en)', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN_VALUE)
    expect(i18n.t(KEY)).not.toContain('Kramdown')
    expect(i18n.t(KEY)).toContain('kramdown')
  })
})
