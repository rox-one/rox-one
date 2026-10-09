/**
 * Unit tests for rox-tg-linkd: pure link primitives, the sqlite state machine,
 * the bot's own-contact rule and the HTTP contract — no network, no Telegram.
 *
 *   bun test services/rox-tg-linkd/test
 */
import { describe, expect, test } from 'bun:test'
import { loadConfig } from '../src/config.ts'
import {
  CODE_ALPHABET,
  CODE_LENGTH,
  LINK_TTL_MS,
  deepLinkHttps,
  deepLinkTg,
  effectiveStatus,
  generateCode,
  isWellFormedCode,
  normalizeCode,
  parseStartPayload,
} from '../src/link.ts'
import { LinkStore, effectiveRegistrationStatus, maskPhone, normalizePhone } from '../src/store.ts'
import { TelegramBot, type FetchLike, type TelegramUpdate } from '../src/telegram.ts'
import { createRequestHandler, jsonResponse } from '../src/server.ts'

const NOW = 1_700_000_000_000

function memoryStore(options: { code?: string; tokens?: string[]; ttlMs?: number } = {}): LinkStore {
  const letters = [...(options.code ?? 'AAAAAAAA')]
  let codeIndex = 0
  const tokens = [...(options.tokens ?? ['tkn-1', 'tkn-2', 'tkn-3'])]
  return new LinkStore(':memory:', {
    randomIndex: () => {
      const char = letters[codeIndex % letters.length] ?? 'A'
      codeIndex += 1
      return CODE_ALPHABET.indexOf(char)
    },
    makeToken: () => tokens.shift() ?? `tkn-${Math.random()}`,
  })
}

interface CapturedCall {
  method: string
  body: Record<string, unknown>
}

function fakeFetch(respond: (method: string, body: Record<string, unknown>) => unknown): {
  fetchImpl: FetchLike
  calls: CapturedCall[]
} {
  const calls: CapturedCall[] = []
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
    const method = String(input).split('/').pop() ?? ''
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : {}
    calls.push({ method, body })
    return new Response(JSON.stringify({ ok: true, result: respond(method, body) ?? true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }
  return { fetchImpl, calls }
}

function botFor(store: LinkStore, config = loadConfig({ TG_BOT_TOKEN: 'test-token', TG_BOT_USERNAME: 'rox_bot', LINK_DB_PATH: ':memory:' })) {
  const { fetchImpl, calls } = fakeFetch(() => true)
  const bot = new TelegramBot({ config, store, fetchImpl, now: () => NOW })
  return { bot, calls }
}

type MessageFields = Omit<NonNullable<TelegramUpdate['message']>, 'message_id' | 'chat' | 'from'>

function update(partial: MessageFields & Partial<Pick<NonNullable<TelegramUpdate['message']>, 'chat' | 'from'>> = {}): TelegramUpdate {
  return { update_id: 1, message: { message_id: 1, chat: { id: '42' }, from: { id: '42' }, ...partial } }
}

function callbackUpdate(data: string, partial: { id?: string; messageId?: number; chatId?: string } = {}): TelegramUpdate {
  return {
    update_id: 2,
    callback_query: {
      id: partial.id ?? 'cb-1',
      from: { id: '42' },
      data,
      message: { message_id: partial.messageId ?? 9, chat: { id: partial.chatId ?? '42' } },
    },
  }
}

describe('code primitives', () => {
  test('alphabet is A-Z and 2-9, and codes are 8 characters', () => {
    expect(CODE_ALPHABET).toBe('ABCDEFGHIJKLMNOPQRSTUVWXYZ23456789')
    expect(CODE_ALPHABET).not.toContain('0')
    expect(CODE_ALPHABET).not.toContain('1')
    expect([...CODE_ALPHABET].length).toBe(34)
    expect(CODE_LENGTH).toBe(8)
    expect(CODE_ALPHABET[0]).toBe('A')
    expect(CODE_ALPHABET[CODE_ALPHABET.length - 1]).toBe('9')
  })

  test('generated codes only use the alphabet', () => {
    for (let i = 0; i < 200; i += 1) {
      const code = generateCode()
      expect(code.length).toBe(8)
      for (const char of code) expect(CODE_ALPHABET.includes(char)).toBe(true)
    }
    expect(generateCode(() => 0)).toBe('AAAAAAAA')
    expect(generateCode(max => max - 1)).toBe('99999999')
  })

  test('normalisation accepts lowercase and separated input, and shape checks are strict', () => {
    expect(normalizeCode('abcd-2345')).toBe('ABCD2345')
    expect(normalizeCode(' abcd 2345 ')).toBe('ABCD2345')
    expect(normalizeCode(42)).toBe('')
    expect(isWellFormedCode('abcd-2345')).toBe(true)
    expect(isWellFormedCode('abcd234')).toBe(false)
    expect(isWellFormedCode('abcd0234')).toBe(false) // 0 is not in the alphabet
    expect(isWellFormedCode('АВСD2345')).toBe(false) // Cyrillic lookalikes must not pass
  })

  test('TTL is 30 minutes and effective status expires past it', () => {
    expect(LINK_TTL_MS).toBe(30 * 60 * 1000)
    expect(effectiveStatus('waiting-code', NOW + LINK_TTL_MS, NOW)).toBe('waiting-code')
    expect(effectiveStatus('waiting-code', NOW, NOW)).toBe('expired')
    expect(effectiveStatus('code-sent', NOW - 1, NOW)).toBe('expired')
    expect(effectiveStatus('linked', NOW - 1, NOW)).toBe('linked')
  })

  test('deep links carry the token and /start payloads parse to command+payload', () => {
    expect(deepLinkHttps('rox_bot', 'tkn 1')).toBe('https://t.me/rox_bot?start=tkn%201')
    expect(deepLinkTg('rox_bot', 'tkn1')).toBe('tg://resolve?domain=rox_bot&start=tkn1')
    expect(parseStartPayload('/start tkn1')).toEqual({ command: 'start', payload: 'tkn1' })
    expect(parseStartPayload('/start@rox_bot tkn1')).toEqual({ command: 'start', payload: 'tkn1' })
    expect(parseStartPayload('/start')).toEqual({ command: 'start', payload: null })
    expect(parseStartPayload('hello')).toBe(null)
    expect(parseStartPayload(undefined)).toBe(null)
  })
})

describe('store state machine', () => {
  test('start is idempotent while a link is pending and honours the TTL', () => {
    const store = memoryStore({ tokens: ['tkn-1'] })
    const first = store.createOrGetPending('user-1', NOW, LINK_TTL_MS)
    expect(first.token).toBe('tkn-1')
    expect(first.code).toBe('AAAAAAAA')
    expect(first.expiresAt).toBe(NOW + LINK_TTL_MS)
    const second = store.createOrGetPending('user-1', NOW + 1000, LINK_TTL_MS)
    expect(second.token).toBe(first.token)
    expect(second.code).toBe(first.code)
  })

  test('an expired pending link is replaced by a fresh one', () => {
    const store = memoryStore({ tokens: ['tkn-1', 'tkn-2'] })
    store.createOrGetPending('user-1', NOW, 1000)
    const fresh = store.createOrGetPending('user-1', NOW + 2000, LINK_TTL_MS)
    expect(fresh.token).toBe('tkn-2')
    expect(store.statusFor('user-1', NOW + 2000).status).toBe('waiting-code')
  })

  test('verify is invalid before the phone is shared and after a wrong code', () => {
    const store = memoryStore({ code: 'ABCD2345' })
    store.createOrGetPending('user-1', NOW, LINK_TTL_MS)
    expect(store.verify('user-1', 'ABCD2345', NOW, 10)).toBe('invalid')
    store.bindChat('tkn-1', '42', NOW)
    expect(store.bindPhone('42', '+79990000000', '42', NOW)?.status).toBe('code-sent')
    expect(store.verify('user-1', 'ZZZZZZZZ', NOW, 10)).toBe('invalid')
    expect(store.verify('user-1', 'ABCD2345', NOW, 10)).toBe('linked')
    expect(store.getLinked('user-1')?.phone).toBe('+79990000000')
  })

  test('wrong codes invalidate the link at the attempt limit', () => {
    const store = memoryStore()
    store.createOrGetPending('user-1', NOW, LINK_TTL_MS)
    store.bindChat('tkn-1', '42', NOW)
    store.bindPhone('42', '+79990000000', '42', NOW)
    expect(store.verify('user-1', 'BBBBBBBB', NOW, 2)).toBe('invalid')
    expect(store.verify('user-1', 'BBBBBBBB', NOW, 2)).toBe('invalid')
    // Limit crossed → invalidated, so a later correct code is expired, not accepted.
    expect(store.verify('user-1', 'AAAAAAAA', NOW, 2)).toBe('expired')
    expect(store.getLinked('user-1')).toBe(null)
  })

  test('verify is idempotent once linked and reports expiry past the TTL', () => {
    const store = memoryStore()
    store.createOrGetPending('user-1', NOW, LINK_TTL_MS)
    store.bindChat('tkn-1', '42', NOW)
    store.bindPhone('42', '+79990000000', '42', NOW)
    expect(store.verify('user-1', 'AAAAAAAA', NOW, 10)).toBe('linked')
    expect(store.verify('user-1', 'AAAAAAAA', NOW + 5, 10)).toBe('linked')

    const other = memoryStore()
    other.createOrGetPending('user-2', NOW, 1000)
    expect(other.verify('user-2', 'AAAAAAAA', NOW + 2000, 10)).toBe('expired')
  })

  test('statusFor is honest about none / waiting-code / code-sent / linked', () => {
    const store = memoryStore()
    expect(store.statusFor('user-1', NOW)).toEqual({ status: 'none', expiresAt: null, code: null })
    const pending = store.createOrGetPending('user-1', NOW, LINK_TTL_MS)
    expect(store.statusFor('user-1', NOW).status).toBe('waiting-code')
    store.bindChat(pending.token, '42', NOW)
    store.bindPhone('42', '+79990000000', '42', NOW)
    expect(store.statusFor('user-1', NOW)).toMatchObject({ status: 'code-sent', code: 'AAAAAAAA' })
    store.verify('user-1', 'AAAAAAAA', NOW, 10)
    expect(store.statusFor('user-1', NOW)).toEqual({ status: 'linked', expiresAt: null, code: null })
  })

  test('bindPhone only accepts the chat that ran /start', () => {
    const store = memoryStore()
    store.createOrGetPending('user-1', NOW, LINK_TTL_MS)
    expect(store.bindPhone('999', '+79990000000', '999', NOW)).toBe(null)
    store.bindChat('tkn-1', '42', NOW)
    expect(store.bindPhone('42', '+79990000000', '42', NOW)?.phone).toBe('+79990000000')
  })
})

describe('bot own-contact rule', () => {
  test('/start with a valid token asks for contact and remembers the chat', async () => {
    const store = memoryStore()
    const { bot, calls } = botFor(store)
    const pending = store.createOrGetPending('user-1', NOW, LINK_TTL_MS)
    await bot.handleUpdate(update({ text: `/start ${pending.token}` }))
    expect(calls.at(-1)?.method).toBe('sendMessage')
    expect(calls.at(-1)?.body.reply_markup).toBeDefined()
    expect(store.findByChat('42', NOW)?.token).toBe(pending.token)
  })

  test('/start with an unknown token sends the not-found message and requests nothing', async () => {
    const store = memoryStore()
    const { bot, calls } = botFor(store)
    store.createOrGetPending('user-1', NOW, LINK_TTL_MS)
    await bot.handleUpdate(update({ text: '/start nope' }))
    expect(calls.at(-1)?.body.reply_markup).toBeUndefined()
    expect(String(calls.at(-1)?.body.text)).toContain('не найдена')
  })

  test('a contact that is not the sender is rejected and never binds a phone', async () => {
    const store = memoryStore()
    const { bot, calls } = botFor(store)
    const pending = store.createOrGetPending('user-1', NOW, LINK_TTL_MS)
    await bot.handleUpdate(update({ text: `/start ${pending.token}` }))
    await bot.handleUpdate(update({ from: { id: '42' }, contact: { phone_number: '+79990000000', user_id: '777' } }))
    expect(String(calls.at(-1)?.body.text)).toContain('не контактом другого человека')
    expect(store.byToken(pending.token)?.status).toBe('waiting-code')
    expect(store.getLinked('user-1')).toBe(null)
  })

  test('the sender’s own contact binds the phone and delivers the code', async () => {
    const store = memoryStore({ code: 'ABCD2345' })
    const { bot, calls } = botFor(store)
    const pending = store.createOrGetPending('user-1', NOW, LINK_TTL_MS)
    await bot.handleUpdate(update({ text: `/start ${pending.token}` }))
    await bot.handleUpdate(update({ from: { id: '42' }, contact: { phone_number: '+79990000000', user_id: '42' } }))
    expect(String(calls.at(-1)?.body.text)).toContain('Ваш код: ABCD2345')
    expect(String(calls.at(-1)?.body.text)).toContain('30 минут')
    expect(store.byToken(pending.token)?.status).toBe('code-sent')
    expect(store.verify('user-1', 'ABCD2345', NOW, 10)).toBe('linked')
  })

  test('a contact without a phone number is rejected', async () => {
    const store = memoryStore()
    const { bot } = botFor(store)
    const pending = store.createOrGetPending('user-1', NOW, LINK_TTL_MS)
    await bot.handleUpdate(update({ text: `/start ${pending.token}` }))
    await bot.handleUpdate(update({ contact: { user_id: '42' } }))
    expect(store.byToken(pending.token)?.status).toBe('waiting-code')
  })

  test('runOnce advances the offset and counts a handled update', async () => {
    const store = memoryStore()
    store.createOrGetPending('user-1', NOW, LINK_TTL_MS)
    const { fetchImpl } = fakeFetch(method => {
      if (method === 'getUpdates') {
        return [
          { update_id: 7, message: { message_id: 1, chat: { id: '42' }, from: { id: '42' }, text: '/start nope' } },
          { update_id: 8, message: { message_id: 2, chat: { id: '42' }, from: { id: '42' } } },
        ]
      }
      return true
    })
    const bot = new TelegramBot({
      config: loadConfig({ TG_BOT_TOKEN: 't', TG_BOT_USERNAME: 'rox_bot', LINK_DB_PATH: ':memory:' }),
      store,
      fetchImpl,
      now: () => NOW,
    })
    expect(await bot.runOnce(new AbortController().signal)).toBe(2)
  })
})

describe('HTTP contract', () => {
  const tokenConfig = loadConfig({ TG_BOT_TOKEN: 'tg-token', TG_BOT_USERNAME: 'rox_bot', LINK_DB_PATH: ':memory:', LINK_AUTH_TOKEN: 'api-secret' })
  const store = memoryStore()

  function handler(config = tokenConfig, storeImpl: LinkStore = store) {
    return createRequestHandler({ config, store: storeImpl })
  }

  function post(path: string, body: unknown, headers: Record<string, string> = {}): Request {
    return new Request(`http://127.0.0.1:8095${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer api-secret', ...headers },
      body: JSON.stringify(body),
    })
  }

  test('health never pretends without a bot token', async () => {
    const noToken = loadConfig({ LINK_DB_PATH: ':memory:' })
    const response = await handler(noToken)(new Request('http://127.0.0.1:8095/api/health'))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: false, reason: 'no-token' })

    const withToken = await handler()(new Request('http://127.0.0.1:8095/api/health'))
    expect(await withToken.json()).toEqual({ ok: true, bot: 'rox_bot' })
  })

  test('start refuses without a token and without a bot username', async () => {
    const noToken = loadConfig({ LINK_DB_PATH: ':memory:' })
    const a = await handler(noToken, memoryStore())(post('/api/link/start', { roxUserId: 'user-1' }))
    expect(a.status).toBe(503)
    expect((await a.json() as { error: string }).error).toBe('no_bot_token')

    const noUsername = loadConfig({ TG_BOT_TOKEN: 'tg-token', LINK_DB_PATH: ':memory:' })
    const b = await handler(noUsername, memoryStore())(post('/api/link/start', { roxUserId: 'user-1' }))
    expect(b.status).toBe(503)
    expect((await b.json() as { error: string }).error).toBe('no_bot_username')
  })

  test('link endpoints require the bearer token when configured', async () => {
    const response = await handler()(new Request('http://127.0.0.1:8095/api/link/status?roxUserId=user-1'))
    expect(response.status).toBe(401)
  })

  test('start returns an 8-char code and both deep links, idempotently', async () => {
    const fresh = memoryStore({ code: 'ABCD2345' })
    const h = handler(tokenConfig, fresh)
    const first = await h(post('/api/link/start', { roxUserId: 'user-1' }))
    expect(first.status).toBe(200)
    const body = await first.json() as Record<string, unknown>
    expect(body.code).toBe('ABCD2345')
    expect(body.linkId).toBe('tkn-1')
    expect(body.status).toBe('waiting-code')
    expect(body.deepLink).toBe('https://t.me/rox_bot?start=tkn-1')
    expect(body.tgDeepLink).toBe('tg://resolve?domain=rox_bot&start=tkn-1')
    const second = await h(post('/api/link/start', { roxUserId: 'user-1' }))
    expect((await second.json() as Record<string, unknown>).code).toBe('ABCD2345')
  })

  test('verify walks invalid → linked and status reflects each state', async () => {
    const fresh = memoryStore()
    const h = handler(tokenConfig, fresh)
    await h(post('/api/link/start', { roxUserId: 'user-1' }))
    const early = await h(post('/api/link/verify', { roxUserId: 'user-1', code: 'AAAAAAAA' }))
    expect((await early.json() as { status: string }).status).toBe('invalid')

    fresh.bindChat('tkn-1', '42', NOW)
    fresh.bindPhone('42', '+79990000000', '42', NOW)
    const sentStatus = await h(new Request('http://127.0.0.1:8095/api/link/status?roxUserId=user-1', { headers: { authorization: 'Bearer api-secret' } }))
    expect(await sentStatus.json() as Record<string, unknown>).toMatchObject({ status: 'code-sent', code: 'AAAAAAAA' })
    const wrong = await h(post('/api/link/verify', { roxUserId: 'user-1', code: 'bbbb-9999' }))
    expect((await wrong.json() as { status: string }).status).toBe('invalid')
    const ok = await h(post('/api/link/verify', { roxUserId: 'user-1', code: 'aaaaaaaa' }))
    expect((await ok.json() as { status: string }).status).toBe('linked')

    const status = await h(new Request('http://127.0.0.1:8095/api/link/status?roxUserId=user-1', { headers: { authorization: 'Bearer api-secret' } }))
    expect((await status.json() as { status: string }).status).toBe('linked')
  })

  test('malformed requests are rejected without leaking state', async () => {
    const h = handler()
    expect((await h(post('/api/link/start', {}))).status).toBe(400)
    expect((await h(post('/api/link/verify', { roxUserId: 'user-1' }))).status).toBe(200)
    expect((await h(new Request('http://127.0.0.1:8095/nope'))).status).toBe(404)
    expect((await h(new Request('http://127.0.0.1:8095/api/link/status', { headers: { authorization: 'Bearer api-secret' } }))).status).toBe(400)
  })

  test('jsonResponse sets no-store', async () => {
    const response = jsonResponse(200, { ok: true })
    expect(response.headers.get('cache-control')).toBe('no-store')
  })
})

describe('registration store transitions', () => {
  test('waiting → ready → consumed is single-use and atomic', () => {
    const store = memoryStore({ tokens: ['reg-1'] })
    const reg = store.createRegistration(NOW, LINK_TTL_MS)
    expect(reg.token).toBe('reg-1')
    expect(reg.status).toBe('waiting')
    expect(reg.expiresAt).toBe(NOW + LINK_TTL_MS)
    expect(store.registrationStatusFor('reg-1', NOW)?.status).toBe('waiting')
    expect(store.consumeRegistration('reg-1', NOW)).toBe('waiting') // not ready yet

    store.bindRegistrationChat('reg-1', '42', NOW)
    const ready = store.confirmRegistration('42', '+79991234512', '42', 'nick', NOW)
    expect(ready?.status).toBe('ready')
    expect(ready?.phone).toBe('+79991234512')
    expect(ready?.telegramUsername).toBe('nick')
    expect(ready?.confirmedAt).toBe(NOW)

    expect(store.consumeRegistration('reg-1', NOW + 1)).toBe('consumed')
    expect(store.consumeRegistration('reg-1', NOW + 2)).toBe('already_consumed')
    expect(store.registrationStatusFor('reg-1', NOW + 2)?.status).toBe('consumed')
    expect(store.consumeRegistration('nope', NOW)).toBe('not_found')
  })

  test('«Это не я» cancels a ready registration idempotently', () => {
    const store = memoryStore({ tokens: ['reg-2'] })
    store.createRegistration(NOW, LINK_TTL_MS)
    store.bindRegistrationChat('reg-2', '42', NOW)
    store.confirmRegistration('42', '+79991234512', '42', 'nick', NOW)
    expect(store.cancelRegistration('reg-2', NOW)).toBe(true)
    expect(store.registrationStatusFor('reg-2', NOW)?.status).toBe('cancelled')
    expect(store.cancelRegistration('reg-2', NOW)).toBe(false) // second press is a no-op
    expect(store.consumeRegistration('reg-2', NOW)).toBe('cancelled')
  })

  test('past the TTL the registration is expired and cannot be consumed', () => {
    const store = memoryStore({ tokens: ['reg-3'] })
    store.createRegistration(NOW, 1000)
    store.bindRegistrationChat('reg-3', '42', NOW)
    store.confirmRegistration('42', '+79991234512', '42', null, NOW)
    expect(store.registrationStatusFor('reg-3', NOW + 2000)?.status).toBe('expired')
    expect(store.consumeRegistration('reg-3', NOW + 2000)).toBe('expired')
  })

  test('phone normalisation and masking', () => {
    expect(normalizePhone('+7 (999) 123-45-12')).toBe('+79991234512')
    expect(normalizePhone('  +7 999 123 45 12 ')).toBe('+79991234512')
    expect(normalizePhone('')).toBe('')
    expect(normalizePhone(42)).toBe('')
    expect(maskPhone('+79991234512')).toBe('+7 999 ***-**-12')
    expect(effectiveRegistrationStatus('waiting', NOW, NOW)).toBe('expired')
    expect(effectiveRegistrationStatus('consumed', NOW - 1, NOW)).toBe('consumed')
  })
})

describe('registration HTTP contract', () => {
  const regConfig = loadConfig({
    TG_BOT_TOKEN: 'tg-token',
    TG_BOT_USERNAME: 'rox_bot',
    LINK_DB_PATH: ':memory:',
    LINK_AUTH_TOKEN: 'api-secret',
  })

  function handler(storeImpl: LinkStore) {
    return createRequestHandler({ config: regConfig, store: storeImpl })
  }

  function post(path: string, body: unknown, headers: Record<string, string> = {}): Request {
    return new Request(`http://127.0.0.1:8095${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer api-secret', ...headers },
      body: JSON.stringify(body),
    })
  }

  function get(path: string, headers: Record<string, string> = {}): Request {
    return new Request(`http://127.0.0.1:8095${path}`, { headers: { authorization: 'Bearer api-secret', ...headers } })
  }

  test('registration endpoints require the bearer token', async () => {
    const h = handler(memoryStore())
    const response = await h(new Request('http://127.0.0.1:8095/api/register/status?token=x'))
    expect(response.status).toBe(401)
  })

  test('start returns 201 with the token and both deep links', async () => {
    const h = handler(memoryStore({ tokens: ['reg-1'] }))
    const response = await h(post('/api/register/start', {}))
    expect(response.status).toBe(201)
    const body = await response.json() as Record<string, unknown>
    expect(body.ok).toBe(true)
    expect(body.token).toBe('reg-1')
    expect(body.deepLink).toBe('https://t.me/rox_bot?start=reg-1')
    expect(body.tgDeepLink).toBe('tg://resolve?domain=rox_bot&start=reg-1')
    expect(typeof body.expiresAt).toBe('number')
  })

  test('status walks waiting → ready and unknown tokens are 404', async () => {
    const store = memoryStore({ tokens: ['reg-2'] })
    const h = handler(store)
    await h(post('/api/register/start', {}))

    const waiting = await h(get('/api/register/status?token=reg-2'))
    expect(waiting.status).toBe(200)
    expect(await waiting.json()).toMatchObject({ ok: true, status: 'waiting' })

    store.bindRegistrationChat('reg-2', '42', Date.now())
    store.confirmRegistration('42', '+79991234512', '42', 'nick', Date.now())
    const ready = await h(get('/api/register/status?token=reg-2'))
    expect(await ready.json()).toMatchObject({
      status: 'ready',
      phone: '+79991234512',
      phoneMasked: '+7 999 ***-**-12',
      telegramUserId: '42',
      telegramUsername: 'nick',
    })

    const missing = await h(get('/api/register/status?token=nope'))
    expect(missing.status).toBe(404)
    expect((await missing.json() as { error: string }).error).toBe('not_found')
  })

  test('consume is single-use: 200, then 409; unknown 404; expired 410', async () => {
    const store = memoryStore({ tokens: ['reg-3', 'reg-4'] })
    const h = handler(store)
    await h(post('/api/register/start', {})) // reg-3
    store.bindRegistrationChat('reg-3', '42', Date.now())
    store.confirmRegistration('42', '+79991234512', '42', 'nick', Date.now())

    const first = await h(post('/api/register/consume', { token: 'reg-3' }))
    expect(first.status).toBe(200)
    expect(await first.json()).toEqual({ ok: true, status: 'consumed' })
    const second = await h(post('/api/register/consume', { token: 'reg-3' }))
    expect(second.status).toBe(409)
    expect(await second.json()).toEqual({ ok: false, error: 'already_consumed' })

    const missing = await h(post('/api/register/consume', { token: 'nope' }))
    expect(missing.status).toBe(404)

    // reg-4 is minted already past its TTL.
    store.createRegistration(Date.now() - 2 * LINK_TTL_MS, LINK_TTL_MS)
    const expired = await h(post('/api/register/consume', { token: 'reg-4' }))
    expect(expired.status).toBe(410)
    expect((await expired.json() as { error: string }).error).toBe('expired')
  })

  test('consume refuses a token that is not ready and rejects malformed requests', async () => {
    const store = memoryStore({ tokens: ['reg-5'] })
    const h = handler(store)
    await h(post('/api/register/start', {}))
    const notReady = await h(post('/api/register/consume', { token: 'reg-5' }))
    expect(notReady.status).toBe(409)
    expect(await notReady.json()).toEqual({ ok: false, error: 'not_ready' })

    expect((await h(post('/api/register/consume', {}))).status).toBe(400)
    expect((await h(get('/api/register/status'))).status).toBe(400)
    expect((await h(post('/api/register/start', {}, { authorization: 'Bearer wrong' }))).status).toBe(401)
  })
})

describe('registration bot conversation', () => {
  test('getUpdates subscribes to message and callback_query', async () => {
    const { bot, calls } = botFor(memoryStore())
    await bot.getUpdates(new AbortController().signal)
    expect(calls.at(-1)?.method).toBe('getUpdates')
    expect(calls.at(-1)?.body.allowed_updates).toEqual(['message', 'callback_query'])
  })

  test('/start on a registration token greets and shows the phone keyboard', async () => {
    const store = memoryStore({ tokens: ['reg-1'] })
    const { bot, calls } = botFor(store)
    const reg = store.createRegistration(NOW, LINK_TTL_MS)
    await bot.handleUpdate(update({ text: `/start ${reg.token}` }))
    const call = calls.at(-1)
    expect(call?.method).toBe('sendMessage')
    expect(String(call?.body.text)).toContain('регистрация в Rox')
    const markup = call?.body.reply_markup as { keyboard: { text: string; request_contact?: boolean }[][] }
    expect(markup.keyboard[0]?.[0]?.request_contact).toBe(true)
    expect(markup.keyboard[0]?.[0]?.text).toContain('📱')
    expect(store.findRegistrationByChat('42', NOW)?.token).toBe(reg.token)
  })

  test('own contact binds the phone and confirms with a cancel button', async () => {
    const store = memoryStore({ tokens: ['reg-1'] })
    const { bot, calls } = botFor(store)
    const reg = store.createRegistration(NOW, LINK_TTL_MS)
    await bot.handleUpdate(update({ text: `/start ${reg.token}` }))
    await bot.handleUpdate(update({ from: { id: '42', username: 'nick' }, contact: { phone_number: '+7 (999) 123-45-12', user_id: '42' } }))
    const call = calls.at(-1)
    expect(String(call?.body.text)).toContain('+7 999 ***-**-12')
    expect(String(call?.body.text)).toContain('браузер')
    const markup = call?.body.reply_markup as { inline_keyboard: { text: string; callback_data: string }[][] }
    expect(markup.inline_keyboard[0]?.[0]).toEqual({ text: 'Это не я', callback_data: `rx-cancel:${reg.token}` })
    const stored = store.registrationByToken(reg.token)
    expect(stored?.status).toBe('ready')
    expect(stored?.phone).toBe('+79991234512')
    expect(stored?.telegramUsername).toBe('nick')
  })

  test('foreign contact and empty phone are refused without binding', async () => {
    const store = memoryStore({ tokens: ['reg-1'] })
    const { bot, calls } = botFor(store)
    const reg = store.createRegistration(NOW, LINK_TTL_MS)
    await bot.handleUpdate(update({ text: `/start ${reg.token}` }))
    await bot.handleUpdate(update({ contact: { phone_number: '+79990000000', user_id: '777' } }))
    expect(String(calls.at(-1)?.body.text)).toContain('не контактом другого человека')
    expect(store.registrationByToken(reg.token)?.status).toBe('waiting')

    await bot.handleUpdate(update({ contact: { user_id: '42' } }))
    expect(store.registrationByToken(reg.token)?.status).toBe('waiting')
  })

  test('«Это не я» cancels once and answers the callback on every press', async () => {
    const store = memoryStore({ tokens: ['reg-1'] })
    const { bot, calls } = botFor(store)
    const reg = store.createRegistration(NOW, LINK_TTL_MS)
    store.bindRegistrationChat(reg.token, '42', NOW)
    store.confirmRegistration('42', '+79991234512', '42', 'nick', NOW)

    await bot.handleUpdate(callbackUpdate(`rx-cancel:${reg.token}`))
    expect(calls.some(c => c.method === 'answerCallbackQuery')).toBe(true)
    expect(calls.some(c => c.method === 'editMessageReplyMarkup')).toBe(true)
    expect(store.registrationByToken(reg.token)?.status).toBe('cancelled')

    const editsAfterFirst = calls.filter(c => c.method === 'editMessageReplyMarkup').length
    await bot.handleUpdate(callbackUpdate(`rx-cancel:${reg.token}`, { id: 'cb-2' }))
    expect(store.registrationByToken(reg.token)?.status).toBe('cancelled')
    expect(calls.filter(c => c.method === 'answerCallbackQuery').length).toBe(2)
    expect(calls.filter(c => c.method === 'editMessageReplyMarkup').length).toBe(editsAfterFirst)
  })

  test('/start with an unknown token keeps the not-found behaviour', async () => {
    const { bot, calls } = botFor(memoryStore())
    await bot.handleUpdate(update({ text: '/start nope' }))
    expect(String(calls.at(-1)?.body.text)).toContain('не найдена')
    expect(calls.at(-1)?.body.reply_markup).toBeUndefined()
  })
})