import { describe, expect, it } from 'bun:test'
import { i18n, setupI18n } from '../setupI18n'

const KEY = 'settings.ai.extendedPromptCacheDesc'
const RU_WRAPPED =
  'Кэшировать запросы на 1 час вместо 5 минут. Применяется только к моделям Claude через Anthropic API. Снижает стоимость длинных сессий, но увеличивает стоимость записи в кэш.'
const EN_VALUE =
  'Cache prompts for 1 hour instead of 5 minutes. Only applies to Claude models via Anthropic API. Reduces cost for long sessions but increases cache write cost.'

describe('P35-309 leftover Russian промпт wrapping on settings.ai.extendedPromptCacheDesc', () => {
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
