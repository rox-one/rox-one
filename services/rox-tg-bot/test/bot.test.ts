import { describe, expect, test } from 'bun:test'
import { TelegramBot } from '../src/bot.ts'
import { LINK_TTL_MS } from '../src/link.ts'
import { codeMessage } from '../src/bot.ts'
import { command, contactMessage, FakeBotTransport, memoryState, message, NOW } from './helpers.ts'

function setup() {
  const state = memoryState({ code: 'ABCDEFGH', linkIds: ['link-1'] })
  const transport = new FakeBotTransport()
  const bot = new TelegramBot({ transport, state, now: () => NOW })
  const link = state.createLink('acc-1', 'Work', NOW, LINK_TTL_MS)
  return { state, transport, bot, link }
}

function isContactKeyboard(markup: unknown): boolean {
  if (typeof markup !== 'object' || markup === null || !('keyboard' in markup)) return false
  const keyboard = markup.keyboard
  return Array.isArray(keyboard) && Array.isArray(keyboard[0]) && keyboard[0][0]?.request_contact === true
}

describe('telegram bot', () => {
  test('/start <linkId> asks the user to share their own phone', async () => {
    const { bot, transport, link } = setup()
    await bot.handleUpdate(command(`/start ${link.linkId}`))

    expect(transport.sent).toHaveLength(1)
    expect(transport.lastText('42')).toContain('поделитесь')
    expect(isContactKeyboard(transport.lastMarkup('42'))).toBe(true)
  })

  test('sharing an own contact issues an 8-letter code and the 30-minute notice', async () => {
    const { bot, transport, state, link } = setup()
    await bot.handleUpdate(command(`/start ${link.linkId}`))
    await bot.handleUpdate(contactMessage('+79991234567'))

    const text = transport.lastText('42') ?? ''
    expect(text).toContain('ABCDEFGH')
    expect(text).toContain('У вас 30 минут, чтобы ввести код в приложении')
    expect(text).toBe(codeMessage('ABCDEFGH'))

    const view = state.status(link.linkId, NOW)
    expect(view?.status).toBe('code_issued')
    expect(view?.code).toMatch(/^[A-Z]{8}$/)
    expect(view?.phoneMasked).toBe('+7********67')
  })

  test('a foreign contact is rejected and leaves the link waiting', async () => {
    const { bot, transport, state, link } = setup()
    await bot.handleUpdate(command(`/start ${link.linkId}`))
    await bot.handleUpdate(contactMessage('+79991234567', { contactUserId: '99' }))

    expect(transport.lastText('42')).toContain('Нужен именно ваш номер')
    expect(isContactKeyboard(transport.lastMarkup('42'))).toBe(true)
    expect(state.status(link.linkId, NOW)).toEqual({ status: 'waiting' })
    expect(state.byId(link.linkId)?.phone).toBeNull()
  })

  test('a contact without user_id is rejected', async () => {
    const { bot, transport, state, link } = setup()
    await bot.handleUpdate(command(`/start ${link.linkId}`))
    await bot.handleUpdate(contactMessage('+79991234567', { contactUserId: null }))
    expect(state.status(link.linkId, NOW)).toEqual({ status: 'waiting' })
    expect(transport.lastText('42')).toContain('Нужен именно ваш номер')
  })

  test('a repeated identical contact keeps the same code', async () => {
    const { bot, transport, state, link } = setup()
    await bot.handleUpdate(command(`/start ${link.linkId}`))
    await bot.handleUpdate(contactMessage('+79991234567'))
    const first = state.byId(link.linkId)?.code
    await bot.handleUpdate(contactMessage('+79991234567'))
    expect(state.byId(link.linkId)?.code).toBe(first)
    expect(transport.lastText('42')).toContain(first ?? '')
  })

  test('an unknown link id is handled gracefully', async () => {
    const { bot, transport } = setup()
    await bot.handleUpdate(command('/start does-not-exist'))
    expect(transport.lastText('42')).toContain('Ссылка не найдена')
  })

  test('/start without a payload is handled gracefully', async () => {
    const { bot, transport } = setup()
    await bot.handleUpdate(command('/start'))
    expect(transport.lastText('42')).toContain('Ссылка не найдена')
  })

  test('/status re-sends the code once issued and reports an unbound chat', async () => {
    const { bot, transport, link } = setup()
    await bot.handleUpdate(command(`/start ${link.linkId}`))
    await bot.handleUpdate(contactMessage('+79991234567'))
    await bot.handleUpdate(command('/status'))
    expect(transport.lastText('42')).toContain('ABCDEFGH')

    await bot.handleUpdate(command('/status', { chat: { id: '99' }, from: { id: '99' } }))
    expect(transport.lastText('99')).toContain('Ссылка не найдена')
  })

  test('updates without text or contact are ignored', async () => {
    const { bot, transport } = setup()
    await bot.handleUpdate(message({ text: 'привет' }))
    expect(transport.sent).toHaveLength(0)
    await bot.handleUpdate({ update_id: 5 })
    expect(transport.sent).toHaveLength(0)
  })

  test('resolveUsername learns the bot username from getMe', async () => {
    const { bot } = setup()
    expect(bot.botUsername).toBe('')
    expect(await bot.resolveUsername()).toBe('rox_test_bot')
    expect(bot.botUsername).toBe('rox_test_bot')
  })
})