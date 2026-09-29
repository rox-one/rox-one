import { describe, expect, it } from 'bun:test'
import { i18n, setupI18n } from '../setupI18n'

const KEY = 'security.infisical.hint'
const RU_WRAPPED =
  'Rox читает Infisical из переменных окружения этой машины. Вход по почте и токену здесь не нужен.'
const EN_VALUE =
  "Rox reads Infisical from this machine's environment variables. Email and token login is not used here."

describe('P35-398 leftover Russian email wrapping on security.infisical.hint', () => {
  it('wraps leftover email as sibling почте, then English stays English', async () => {
    await setupI18n().changeLanguage('ru')
    const ru = i18n.t(KEY)
    expect(ru).toBe(RU_WRAPPED)
    expect(ru).toContain('по почте')
    expect(ru).toContain('Infisical')
    expect(ru).not.toContain('email')

    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN_VALUE)
  })

  it('resolves English through setupI18n after changeLanguage(en)', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN_VALUE)
  })
})
