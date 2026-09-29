import { describe, expect, it } from 'bun:test'
import { i18n, setupI18n } from '../setupI18n'

const KEY = 'collection.slice.flagged'
const RU_WRAPPED = 'С пометкой'
const EN_VALUE = 'Flagged'

describe('P35-356 leftover Russian флаг wrapping on collection.slice.flagged', () => {
  it('wraps leftover флажком as sibling пометкой, then English stays English', async () => {
    await setupI18n().changeLanguage('ru')
    const ru = i18n.t(KEY)
    expect(ru).toBe(RU_WRAPPED)
    expect(ru.toLowerCase()).toContain('пометк')
    expect(ru.toLowerCase()).not.toContain('флаг')

    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN_VALUE)
  })

  it('resolves English through setupI18n after changeLanguage(en)', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN_VALUE)
    expect(i18n.t(KEY).toLowerCase()).not.toContain('флаг')
    expect(i18n.t(KEY).toLowerCase()).not.toContain('пометк')
  })
})
