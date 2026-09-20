import { describe, expect, it } from 'bun:test'
import { i18n, setupI18n } from '../setupI18n'

const KEY = 'entityView.mapComposeLabel'
const RU_WRAPPED = 'Запрос'
const EN_VALUE = 'Prompt'

describe('P35-296 leftover Russian Промпт wrapping on entityView.mapComposeLabel', () => {
  it('wraps leftover Промпт as sibling Запрос, then English stays English', async () => {
    await setupI18n().changeLanguage('ru')
    const ru = i18n.t(KEY)
    expect(ru).toBe(RU_WRAPPED)
    expect(ru).toBe('Запрос')
    expect(ru.toLowerCase()).not.toContain('промпт')

    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN_VALUE)
  })

  it('resolves English through setupI18n after changeLanguage(en)', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN_VALUE)
  })
})
