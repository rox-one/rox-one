import { describe, expect, it } from 'bun:test'
import { i18n, setupI18n } from '../setupI18n'

const KEY = 'settings.orgs.inviteTarget'
const RU_WRAPPED = 'почта или имя пользователя'
const EN_VALUE = 'Email or username'

describe('P35-396 leftover Russian email wrapping on settings.orgs.inviteTarget', () => {
  it('wraps leftover email as sibling почта, then English stays English', async () => {
    await setupI18n().changeLanguage('ru')
    const ru = i18n.t(KEY)
    expect(ru).toBe(RU_WRAPPED)
    expect(ru).toContain('почта')
    expect(ru).not.toContain('email')

    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN_VALUE)
  })

  it('resolves English through setupI18n after changeLanguage(en)', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN_VALUE)
  })
})
