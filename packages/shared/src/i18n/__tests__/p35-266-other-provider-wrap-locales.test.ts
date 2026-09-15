import { describe, expect, it } from 'bun:test'
import { i18n, setupI18n } from '../setupI18n'

const KEY = 'onboarding.providerSelect.otherProvider'
const LEFTOVER_CALQUE = 'провайдер'

describe('P35-266 leftover Russian провайдера wrapping on onboarding.providerSelect.otherProvider', () => {
  it('wraps leftover Я использую другого провайдера as Я использую другого поставщика', async () => {
    await setupI18n().changeLanguage('ru')
    const value = i18n.t(KEY)
    expect(value.toLowerCase()).not.toContain(LEFTOVER_CALQUE)
    expect(value).toBe('Я использую другого поставщика')
    expect(value).not.toContain(KEY)
  })

  it('resolves English through setupI18n after changeLanguage(en)', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe('I use other provider')
    expect(i18n.t(KEY).toLowerCase()).not.toContain(LEFTOVER_CALQUE)
  })
})
