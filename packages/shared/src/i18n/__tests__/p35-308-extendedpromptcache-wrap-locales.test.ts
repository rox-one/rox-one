import { describe, expect, it } from 'bun:test'
import { i18n, setupI18n } from '../setupI18n'

const KEY = 'settings.ai.extendedPromptCache'
const RU_WRAPPED = 'Расширенный кэш запросов (1 час)'
const EN_VALUE = 'Extended prompt cache (1 hour)'

describe('P35-308 leftover Russian промпт wrapping on settings.ai.extendedPromptCache', () => {
  it('wraps leftover промпт as sibling запрос, then English stays English', async () => {
    await setupI18n().changeLanguage('ru')
    const ru = i18n.t(KEY)
    expect(ru).toBe(RU_WRAPPED)
    expect(ru.toLowerCase()).not.toContain('промпт')

    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN_VALUE)
  })

  it('resolves English through setupI18n after changeLanguage(en)', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN_VALUE)
  })
})
