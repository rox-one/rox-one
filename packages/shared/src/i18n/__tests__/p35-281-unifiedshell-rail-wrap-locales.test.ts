import { describe, expect, it } from 'bun:test'
import { i18n, setupI18n } from '../setupI18n'

const KEY = 'settings.appearance.workbenchUnifiedShell'
const RU_WRAPPED = 'Панель, вкладки, инспектор'
const EN_VALUE = 'Activity rail, tabs, inspector'

describe('P35-281 leftover Russian Рейка wrapping on settings.appearance.workbenchUnifiedShell', () => {
  it('wraps leftover Рейка as sibling Панель, keeps leftover инспектор, then English stays English', async () => {
    await setupI18n().changeLanguage('ru')
    const ru = i18n.t(KEY)
    expect(ru).toBe(RU_WRAPPED)
    expect(ru).toContain('Панель')
    expect(ru).toContain('инспектор')
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
