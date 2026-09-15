import { describe, expect, it } from 'bun:test'
import { i18n, setupI18n } from '../setupI18n'

const KEY = 'automations.telegramTopicHintNoSupergroup'
const LEFTOVER_CALQUE = 'топик'

describe('P35-258 leftover Russian топикам wrapping on automations.telegramTopicHintNoSupergroup', () => {
  it('wraps leftover по топикам as по темам', async () => {
    await setupI18n().changeLanguage('ru')
    const value = i18n.t(KEY)
    expect(value.toLowerCase()).not.toContain(LEFTOVER_CALQUE)
    expect(value).toContain('по темам')
    expect(value).toContain('Telegram')
    expect(value).not.toContain('telegramTopic')
    expect(value).toBe(
      'Привяжите супергруппу Telegram в Настройки → Сообщения, чтобы включить маршрутизацию по темам.',
    )
  })

  it('resolves English through setupI18n after changeLanguage(en)', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(
      'Pair a Telegram supergroup in Settings → Messaging to enable topic routing.',
    )
    expect(i18n.t(KEY).toLowerCase()).not.toContain(LEFTOVER_CALQUE)
  })
})
