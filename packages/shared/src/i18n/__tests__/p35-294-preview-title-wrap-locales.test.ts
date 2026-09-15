import { describe, expect, it } from 'bun:test'
import { i18n, setupI18n } from '../setupI18n'

const KEY = 'sideThread.previewTitle'
const RU_WRAPPED = 'Запрос побочного треда'
const EN_VALUE = 'Side thread prompt'

describe('P35-294 leftover Russian Промпт wrapping on sideThread.previewTitle', () => {
  it('wraps leftover Промпт as sibling Запрос, then English stays English', async () => {
    await setupI18n().changeLanguage('ru')
    const ru = i18n.t(KEY)
    expect(ru).toBe(RU_WRAPPED)
    expect(ru).toContain('Запрос')
    expect(ru.toLowerCase()).not.toContain('промпт')

    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN_VALUE)
  })

  it('resolves English through setupI18n after changeLanguage(en)', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN_VALUE)
  })
})
