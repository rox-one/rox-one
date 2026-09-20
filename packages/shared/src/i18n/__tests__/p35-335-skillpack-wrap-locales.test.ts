import { describe, expect, it } from 'bun:test'
import { i18n, setupI18n } from '../setupI18n'

const KEY = 'marketplace.kind.skillpack'
const RU_WRAPPED = 'Пакет навыков'
const EN_VALUE = 'Skill pack'

describe('P35-335 leftover Russian пак wrapping on marketplace.kind.skillpack', () => {
  it('wraps leftover пак as sibling пакет, then English stays English', async () => {
    await setupI18n().changeLanguage('ru')
    const ru = i18n.t(KEY)
    expect(ru).toBe(RU_WRAPPED)
    expect(ru).toContain('Пакет')
    expect(ru.toLowerCase()).not.toContain('пак навыков')

    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN_VALUE)
  })

  it('resolves English through setupI18n after changeLanguage(en)', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN_VALUE)
    expect(i18n.t(KEY).toLowerCase()).not.toContain('пак')
    expect(i18n.t(KEY).toLowerCase()).not.toContain('пакет')
  })
})
