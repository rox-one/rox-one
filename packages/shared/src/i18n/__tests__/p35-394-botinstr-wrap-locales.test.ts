import { describe, expect, it } from 'bun:test'
import { i18n, setupI18n } from '../setupI18n'

const KEY = 'settings.messaging.discord.instructions'
const EN_VALUE =
  '1. Open the Discord Developer Portal and create an Application, then add a Bot\n2. Under Bot → Privileged Gateway Intents, enable the Message Content Intent\n3. Copy the Bot Token (Reset Token if needed)\n4. Invite the bot to your server with the bot scope and Send Messages permission\n5. DM the bot, or @mention it in a channel, to start'

describe('P35-394 leftover English Bot Token wrapping on settings.messaging.discord.instructions', () => {
  it('wraps leftover Bot Token as токен бота, then English stays English', async () => {
    await setupI18n().changeLanguage('ru')
    const ru = i18n.t(KEY)
    expect(ru).toContain('Скопируйте токен бота')
    expect(ru).not.toContain('Bot Token')
    expect(ru).toContain('Reset Token')
    expect(ru).toContain('Developer Portal')

    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN_VALUE)
  })

  it('resolves English through setupI18n after changeLanguage(en)', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t(KEY)).toBe(EN_VALUE)
  })
})
