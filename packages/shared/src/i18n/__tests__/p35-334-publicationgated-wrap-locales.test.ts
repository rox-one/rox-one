import { describe, expect, it } from 'bun:test'
import { i18n, setupI18n } from '../setupI18n'

const KEY = 'collaboration.publicationGated'
const RU_WRAPPED = 'Публикация недоступна, пока не утверждена политика общего доступа'
const EN_VALUE = 'Public publication is unavailable until sharing policy is decided'

describe('P35-334 leftover Russian шаринг wrapping on collaboration.publicationGated', () => {
  it('wraps leftover шаринг as sibling общий доступ, then English stays English', async () => {
    await setupI18n().changeLanguage('ru')
    const ru = i18n.t(KEY)
    expect(ru).toBe(RU_WRAPPED)
    expect(ru).toContain('общего доступа')
    expect(ru.toLowerCase()).not.toContain('шаринг')

    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN_VALUE)
  })

  it('resolves English through setupI18n after changeLanguage(en)', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN_VALUE)
    expect(i18n.t(KEY).toLowerCase()).not.toContain('шаринг')
    expect(i18n.t(KEY).toLowerCase()).not.toContain('общего доступа')
  })
})
