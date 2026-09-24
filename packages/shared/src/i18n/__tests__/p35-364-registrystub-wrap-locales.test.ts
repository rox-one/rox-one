import { describe, expect, it } from 'bun:test'
import { i18n, setupI18n } from '../setupI18n'

const KEY = 'extensions.registries.stub'
const RU_WRAPPED = 'Заглушка (W6)'
const EN_VALUE = 'stub (W6)'

describe('P35-364 leftover Russian stub wrapping on extensions.registries.stub', () => {
  it('wraps leftover stub as sibling заглушка, then English stays English', async () => {
    await setupI18n().changeLanguage('ru')
    const ru = i18n.t(KEY)
    expect(ru).toBe(RU_WRAPPED)
    expect(ru).toContain('Заглушка')
    expect(ru).toContain('W6')
    expect(ru.toLowerCase()).not.toContain('stub')

    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN_VALUE)
  })

  it('resolves English through setupI18n after changeLanguage(en)', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN_VALUE)
    expect(i18n.t(KEY)).toContain('stub')
    expect(i18n.t(KEY)).toContain('W6')
    expect(i18n.t(KEY).toLowerCase()).not.toContain('заглушк')
  })
})
