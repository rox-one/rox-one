import { describe, expect, it } from 'bun:test'
import { i18n, setupI18n } from '../setupI18n'

const KEY = 'extensions.developer.urlAllowlistExtensionId'
const RU_WRAPPED = 'ID расширения'
const EN_VALUE = 'Extension id'

describe('P35-380 leftover Russian Id wrapping on extensions.developer.urlAllowlistExtensionId', () => {
  it('wraps leftover field-label Id as Latin ID, then English stays English', async () => {
    await setupI18n().changeLanguage('ru')
    const ru = i18n.t(KEY)
    expect(ru).toBe(RU_WRAPPED)
    expect(ru).toContain('ID')
    expect(ru).not.toMatch(/\bId\b/)
    expect(ru).not.toContain('идентификатор')

    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN_VALUE)
  })

  it('resolves English through setupI18n after changeLanguage(en)', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN_VALUE)
  })
})
