import { describe, expect, it } from 'bun:test'
import { i18n, setupI18n } from '../setupI18n'

const KEY = 'onboarding.apiSetup.craftAgentsBackend'
const RU_WRAPPED = 'Бэкенд Rox'
const EN_VALUE = 'Rox Backend'

describe('P35-390 leftover Russian Backend wrapping on onboarding.apiSetup.craftAgentsBackend', () => {
  it('wraps leftover Backend as sibling бэкенд Rox, then English stays English', async () => {
    await setupI18n().changeLanguage('ru')
    const ru = i18n.t(KEY)
    expect(ru).toBe(RU_WRAPPED)
    expect(ru).toContain('Бэкенд Rox')
    expect(ru).not.toContain('Backend')
    expect(ru).not.toContain('Rox Backend')

    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN_VALUE)
  })

  it('resolves English through setupI18n after changeLanguage(en)', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN_VALUE)
    expect(i18n.t(KEY)).toContain('Rox Backend')
    expect(i18n.t(KEY)).not.toContain('Бэкенд Rox')
  })
})
