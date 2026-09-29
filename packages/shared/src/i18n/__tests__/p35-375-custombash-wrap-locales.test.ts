import { describe, expect, it } from 'bun:test'
import { i18n, setupI18n } from '../setupI18n'

const KEY = 'settings.permissions.customBashPattern'
const RU_WRAPPED = 'Пользовательский шаблон Bash'
const EN_VALUE = 'Custom bash pattern'

describe('P35-375 leftover Russian bash wrapping on settings.permissions.customBashPattern', () => {
  it('wraps leftover bash as sibling Bash, then English stays English', async () => {
    await setupI18n().changeLanguage('ru')
    const ru = i18n.t(KEY)
    expect(ru).toBe(RU_WRAPPED)
    expect(ru).toContain('Bash')
    expect(ru).not.toContain('bash')

    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN_VALUE)
  })

  it('resolves English through setupI18n after changeLanguage(en)', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN_VALUE)
    expect(i18n.t(KEY)).not.toContain('Bash')
    expect(i18n.t(KEY)).toContain('bash')
  })
})
