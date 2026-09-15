import { describe, expect, it } from 'bun:test'
import { i18n, setupI18n } from '../setupI18n'

const KEY = 'settings.unifiedShell.enableDesc'
const RU_WRAPPED = 'Панель активности, вкладки поверхностей и инспектор. Волна W1 единой оболочки.'
const EN_VALUE = 'Activity rail, surface tabs and inspector. Wave W1 of the unified shell.'

describe('P35-282 leftover Russian Рейка wrapping on settings.unifiedShell.enableDesc', () => {
  it('wraps leftover Рейка as sibling Панель, keeps leftover инспектор and Latin W1, then English stays English', async () => {
    await setupI18n().changeLanguage('ru')
    const ru = i18n.t(KEY)
    expect(ru).toBe(RU_WRAPPED)
    expect(ru).toContain('Панель')
    expect(ru).toContain('инспектор')
    expect(ru).toContain('W1')
    expect(ru).not.toContain('Рейка')
    expect(ru.toLowerCase()).not.toContain('рейк')

    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN_VALUE)
  })

  it('resolves English through setupI18n after changeLanguage(en)', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN_VALUE)
  })
})
