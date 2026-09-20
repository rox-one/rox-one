import { describe, expect, it } from 'bun:test'
import { i18n, setupI18n } from '../setupI18n'

const KEY = 'cloudRuns.fork'
const RU_WRAPPED = 'Ветка (углубление)'
const EN_VALUE = 'Fork (deeper dive)'

describe('P35-346 leftover Russian форк wrapping on cloudRuns.fork', () => {
  it('wraps leftover форк as sibling ветка, then English stays English', async () => {
    await setupI18n().changeLanguage('ru')
    const ru = i18n.t(KEY)
    expect(ru).toBe(RU_WRAPPED)
    expect(ru.toLowerCase()).toContain('ветка')
    expect(ru.toLowerCase()).not.toContain('форк')
    expect(ru).toContain('(углубление)')

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
