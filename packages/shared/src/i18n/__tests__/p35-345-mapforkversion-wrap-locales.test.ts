import { describe, expect, it } from 'bun:test'
import { i18n, setupI18n } from '../setupI18n'

const KEY = 'entityView.mapForkVersion'
const RU_WRAPPED = 'Ветка версии'
const EN_VALUE = 'Fork version'

describe('P35-345 leftover Russian форк wrapping on entityView.mapForkVersion', () => {
  it('wraps leftover форк as sibling ветка, then English stays English', async () => {
    await setupI18n().changeLanguage('ru')
    const ru = i18n.t(KEY)
    expect(ru).toBe(RU_WRAPPED)
    expect(ru.toLowerCase()).toContain('ветка')
    expect(ru.toLowerCase()).not.toContain('форк')

    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN_VALUE)
  })

  it('resolves English through setupI18n after changeLanguage(en)', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN_VALUE)
    expect(i18n.t(KEY).toLowerCase()).not.toContain('форк')
    expect(i18n.t(KEY).toLowerCase()).not.toContain('ветка')
  })
})
