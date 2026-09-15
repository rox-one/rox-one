import { describe, expect, it } from 'bun:test'
import { i18n, setupI18n } from '../setupI18n'

const KEY = 'automations.telegramTopicHintBound'
const LEFTOVER_CALQUE = 'топик'

describe('P35-257 leftover Russian топике wrapping on automations.telegramTopicHintBound', () => {
  it('wraps leftover в этом топике as в этой теме', async () => {
    await setupI18n().changeLanguage('ru')
    const value = i18n.t(KEY)
    expect(value.toLowerCase()).not.toContain(LEFTOVER_CALQUE)
    expect(value).toContain('в этой теме')
    expect(value).toContain('Telegram')
    expect(value).toBe(
      'Сессии этой автоматизации публикуются в этой теме привязанной супергруппы Telegram.',
    )
  })

  it('resolves English through setupI18n after changeLanguage(en)', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(
      'Sessions from this automation post into this topic in the paired Telegram supergroup.',
    )
    expect(i18n.t(KEY).toLowerCase()).not.toContain(LEFTOVER_CALQUE)
  })
})
