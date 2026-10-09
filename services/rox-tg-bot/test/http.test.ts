import { describe, expect, test } from 'bun:test'
import { loadConfig } from '../src/config.ts'
import { createRequestHandler } from '../src/http.ts'
import { LINK_TTL_MS, MAX_ATTEMPTS } from '../src/link.ts'
import { memoryState, NOW } from './helpers.ts'

const SERVICE_TOKEN = 'service-token'

function testConfig(overrides: Record<string, string> = {}) {
  return loadConfig({
    TELEGRAM_BOT_TOKEN: 'test-token',
    TG_LINK_SERVICE_TOKEN: SERVICE_TOKEN,
    BOT_USERNAME: 'rox_test_bot',
    TG_LINK_DB: ':memory:',
    ...overrides,
  })
}

function harness(botUsername = 'rox_test_bot') {
  const state = memoryState({ code: 'ABCDEFGH', linkIds: ['link-1', 'link-2', 'link-3', 'link-4', 'link-5', 'link-6'] })
  const config = testConfig()
  const handler = createRequestHandler({ config, state, botUsername: () => botUsername })
  const call = (method: string, path: string, options: { token?: string | null; body?: unknown } = {}) =>
    handler(
      new Request(`http://local${path}`, {
        method,
        headers: {
          ...(options.token === null ? {} : { authorization: `Bearer ${options.token ?? SERVICE_TOKEN}` }),
          ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      }),
    )
  return { state, config, handler, call }
}

type HandlerCall = (method: string, path: string, options?: { token?: string | null; body?: unknown }) => Promise<Response>

async function startLink(call: HandlerCall): Promise<{ linkId: string; deepLink: string; expiresAt: number }> {
  const response = await call('POST', '/api/link/start', { body: { accountId: 'acc-1', accountLabel: 'Work' } })
  expect(response.status).toBe(200)
  return (await response.json()) as { linkId: string; deepLink: string; expiresAt: number }
}

describe('http api', () => {
  test('requires the bearer service token on /api/link/*', async () => {
    const { call } = harness()
    expect((await call('POST', '/api/link/start', { token: null, body: { accountId: 'a' } })).status).toBe(401)
    expect((await call('POST', '/api/link/start', { token: 'wrong', body: { accountId: 'a' } })).status).toBe(401)
    expect((await call('POST', '/api/link/start', { body: { accountId: 'a' } })).status).toBe(200)
  })

  test('GET /api/health is public and reports the bot identity', async () => {
    const { call } = harness()
    const response = await call('GET', '/api/health', { token: null })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, bot: 'rox_test_bot' })
  })

  test('POST /api/link/start returns a deep link with a null code and 30-minute expiry', async () => {
    const { call } = harness()
    const response = await call('POST', '/api/link/start', { body: { accountId: 'acc-1', accountLabel: 'Work' } })
    const body = (await response.json()) as { linkId: string; code: null; deepLink: string; expiresAt: number }
    expect(body.code).toBeNull()
    expect(body.deepLink).toBe(`https://t.me/rox_test_bot?start=${body.linkId}`)
    expect(Number.isFinite(body.expiresAt)).toBe(true)
  })

  test('POST /api/link/start validates accountId and the bot username', async () => {
    const { call } = harness()
    expect((await call('POST', '/api/link/start', { body: {} })).status).toBe(400)
    expect((await call('POST', '/api/link/start', { body: { accountId: '  ' } })).status).toBe(400)
    const noBot = harness('')
    expect((await noBot.call('POST', '/api/link/start', { body: { accountId: 'acc-1' } })).status).toBe(503)
  })

  test('GET /api/link/status reports waiting without a code, and 404s unknown links', async () => {
    const { call } = harness()
    const { linkId } = await startLink(call)
    const response = await call('GET', `/api/link/status?linkId=${linkId}`)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'waiting' })

    expect((await call('GET', '/api/link/status?linkId=nope')).status).toBe(404)
    expect((await call('GET', '/api/link/status')).status).toBe(400)
  })

  test('the full flow: start → phone shared → code issued → confirmed', async () => {
    const { call, state } = harness()
    const { linkId, expiresAt } = await startLink(call)
    // The HTTP layer uses the real clock; allow a generous tolerance.
    expect(expiresAt).toBeGreaterThan(Date.now())
    expect(expiresAt).toBeLessThanOrEqual(Date.now() + LINK_TTL_MS)

    // Simulate the bot side: user opened the deep link and shared their phone.
    state.bindChat('42', linkId, NOW)
    state.issueCode('42', '+79991234567', NOW)

    const issued = await call('GET', `/api/link/status?linkId=${linkId}`)
    expect(issued.status).toBe(200)
    expect(await issued.json()).toEqual({
      status: 'code_issued',
      code: 'ABCDEFGH',
      phoneMasked: '+7********67',
    })

    const confirmed = await call('POST', '/api/link/confirm', { body: { linkId, code: 'abcdefgh' } })
    expect(confirmed.status).toBe(200)
    expect(await confirmed.json()).toEqual({ status: 'confirmed' })

    const after = await call('GET', `/api/link/status?linkId=${linkId}`)
    expect(await after.json()).toEqual({ status: 'confirmed', phoneMasked: '+7********67', confirmedAt: expect.any(Number) })
  })

  test('POST /api/link/confirm rejects a wrong code and caps attempts', async () => {
    const { call, state } = harness()
    const { linkId } = await startLink(call)
    state.bindChat('42', linkId, NOW)
    state.issueCode('42', '+79991234567', NOW)

    for (let i = 0; i < MAX_ATTEMPTS; i += 1) {
      const response = await call('POST', '/api/link/confirm', { body: { linkId, code: 'ZZZZZZZZ' } })
      expect(response.status).toBe(400)
      expect(await response.json()).toEqual({ status: 'invalid' })
    }
    // The link is invalidated; even the correct code now reports expiry.
    const expired = await call('POST', '/api/link/confirm', { body: { linkId, code: 'ABCDEFGH' } })
    expect(expired.status).toBe(410)
    expect(await expired.json()).toEqual({ status: 'expired' })
  })

  test('POST /api/link/confirm validates the body and unknown links', async () => {
    const { call } = harness()
    expect((await call('POST', '/api/link/confirm', { body: {} })).status).toBe(400)
    expect((await call('POST', '/api/link/confirm', { body: { linkId: 'nope', code: 'ABCDEFGH' } })).status).toBe(404)
  })

  test('expired links report expired and refuse confirmation', async () => {
    const { call, state } = harness()
    const { linkId } = await startLink(call)
    state.bindChat('42', linkId, NOW)
    state.issueCode('42', '+79991234567', NOW)

    const stale = Date.now() + LINK_TTL_MS + 1
    state.expireStale(stale)
    const view = await call('GET', `/api/link/status?linkId=${linkId}`)
    expect(await view.json()).toEqual({ status: 'expired' })
  })

  test('method guards reject the wrong verbs', async () => {
    const { call } = harness()
    expect((await call('GET', '/api/link/start')).status).toBe(405)
    expect((await call('DELETE', '/api/link/status?linkId=x')).status).toBe(405)
    expect((await call('GET', '/api/link/confirm')).status).toBe(405)
    expect((await call('GET', '/api/nope')).status).toBe(404)
  })
})