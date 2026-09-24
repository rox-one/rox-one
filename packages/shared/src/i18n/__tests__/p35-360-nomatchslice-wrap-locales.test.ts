import { describe, expect, it } from 'bun:test'
import { i18n, setupI18n } from '../setupI18n'

const KEY = 'session.noMatchingSessionsDesc'
const RU_WRAPPED = 'Выберите другой срез или сбросьте фильтры.'
const EN_VALUE = 'Try a different slice or clear filters.'

describe('P35-360 leftover Russian слайс wrapping on session.noMatchingSessionsDesc', () => {
  it('wraps leftover слайс as sibling срез, then English stays English', async () => {
    await setupI18n().changeLanguage('ru')
    const ru = i18n.t(KEY)
    expect(ru).toBe(RU_WRAPPED)
    expect(ru.toLowerCase()).toContain('срез')
    expect(ru.toLowerCase()).not.toContain('слайс')

    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN_VALUE)
  })

  it('resolves English through setupI18n after changeLanguage(en)', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN_VALUE)
    expect(i18n.t(KEY).toLowerCase()).not.toContain('слайс')
    expect(i18n.t(KEY).toLowerCase()).not.toContain('срез')
  })
})
