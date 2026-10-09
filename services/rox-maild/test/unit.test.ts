/**
 * Unit tests for the pure parts of rox-maild (no network, no Stalwart).
 *
 *   bun test services/rox-maild/test
 */
import { describe, expect, test } from 'bun:test'
import { createHmac } from 'node:crypto'
import { DEFAULT_MAILBOX_QUOTA_BYTES, MAX_MAILBOX_QUOTA_BYTES, MIN_MAILBOX_QUOTA_BYTES } from '@rox/shared/mail'
import { bareAddress, prepareData } from '../src/smtp.ts'
import { hmacHex, verifySignature } from '../src/signature.ts'
import { decodeRawBase64, dedupeKey } from '../src/inbound.ts'
import { IdempotencyCache } from '../src/idempotency.ts'
import { ConfigError, loadConfig } from '../src/config.ts'
import { handleProvision } from '../src/provision.ts'

describe('signature', () => {
  test('accepts the correct hex HMAC and rejects everything else', () => {
    const secret = 'test-secret-value'
    const body = Buffer.from('{"hello":"world"}')
    const signature = createHmac('sha256', secret).update(body).digest('hex')
    expect(hmacHex(secret, body)).toBe(signature)
    expect(verifySignature(secret, body, signature)).toBe(true)
    expect(verifySignature(secret, body, signature.toUpperCase())).toBe(true)
    expect(verifySignature(secret, body, 'deadbeef')).toBe(false)
    expect(verifySignature(secret, body, null)).toBe(false)
    expect(verifySignature(secret, Buffer.from('other'), signature)).toBe(false)
  })
})

describe('bareAddress', () => {
  test('unwraps display names and rejects header injection', () => {
    expect(bareAddress('Mark <mark@rox.one>')).toBe('mark@rox.one')
    expect(bareAddress('  mark@rox.one ')).toBe('mark@rox.one')
    expect(bareAddress('mark@rox.one\r\nRCPT TO:<evil@x>')).toBe(null)
    expect(bareAddress('')).toBe(null)
  })
})

describe('prepareData', () => {
  test('normalises line endings and dot-stuffs', () => {
    const out = prepareData(Buffer.from('Subject: x\n\n.leading dot\nbody')).toString('latin1')
    expect(out).toBe('Subject: x\r\n\r\n..leading dot\r\nbody\r\n.\r\n')
  })
})

describe('decodeRawBase64', () => {
  test('round-trips canonical base64 and rejects junk', () => {
    const message = Buffer.from('From: a@b\r\n\r\nHello')
    expect(decodeRawBase64(message.toString('base64'))?.equals(message)).toBe(true)
    expect(decodeRawBase64('not base64!!')).toBe(null)
    expect(decodeRawBase64('')).toBe(null)
  })
})

describe('dedupeKey', () => {
  test('prefers Message-ID and falls back to a content hash', () => {
    expect(dedupeKey({ from: 'a', to: 'b', rawB64: '', messageId: ' <m1@x> ' }, Buffer.from('x'))).toBe('mid:<m1@x>')
    const a = dedupeKey({ from: 'a', to: 'b', rawB64: '' }, Buffer.from('x'))
    const b = dedupeKey({ from: 'a', to: 'b', rawB64: '' }, Buffer.from('x'))
    expect(a).toBe(b)
    expect(a.startsWith('sha:')).toBe(true)
  })
})

describe('IdempotencyCache', () => {
  test('runs once per key and evicts oldest beyond capacity', async () => {
    const cache = new IdempotencyCache<number>(2)
    let calls = 0
    const work = async () => ++calls
    expect(await cache.once('a', work)).toEqual({ value: 1, duplicate: false })
    expect(await cache.once('a', work)).toEqual({ value: 1, duplicate: true })
    expect(calls).toBe(1)
    await cache.once('b', work)
    await cache.once('c', work)
    expect(cache.has('a')).toBe(false)
    expect(cache.has('c')).toBe(true)
  })
})
describe('config quota', () => {
  const env = { MAIL_INBOUND_SECRET: 'x'.repeat(32), STALWART_ADMIN_USER: 'admin', STALWART_ADMIN_PASSWORD: 'pw' }
  test('defaults to 1 GiB and rejects out-of-bounds overrides', () => {
    expect(loadConfig(env).mailDefaultQuotaBytes).toBe(DEFAULT_MAILBOX_QUOTA_BYTES)
    expect(loadConfig({ ...env, MAIL_DEFAULT_QUOTA_BYTES: String(2 * 1024 ** 3) }).mailDefaultQuotaBytes).toBe(2 * 1024 ** 3)
    expect(() => loadConfig({ ...env, MAIL_DEFAULT_QUOTA_BYTES: String(MIN_MAILBOX_QUOTA_BYTES - 1) })).toThrow(ConfigError)
    expect(() => loadConfig({ ...env, MAIL_DEFAULT_QUOTA_BYTES: String(MAX_MAILBOX_QUOTA_BYTES + 1) })).toThrow(ConfigError)
    expect(() => loadConfig({ ...env, MAIL_DEFAULT_QUOTA_BYTES: 'not-a-number' })).toThrow(ConfigError)
  })
})

/** Fake Rox broker + Stalwart management API for /api/provision tests. */
function fakeProvisionFetch() {
  let quotaBytes: number | null = null
  let marker: string | null = null
  let brokerCalls = 0
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  const fetchImpl = async (input: string, init?: RequestInit): Promise<Response> => {
    const url = String(input)
    if (url.endsWith('/api/me/account')) {
      brokerCalls++
      return (init?.headers as Record<string, string>)?.authorization === 'Bearer rox-user-token'
        ? json({ user: { id: 'u-1', handle: 'mark', email: 'mark@rox.one' } })
        : json({ error: 'invalid_token' }, 401)
    }
    if (url.endsWith('/jmap/session')) return json({ apiUrl: '/jmap/', username: 'admin', primaryAccounts: { 'urn:stalwart:jmap': 'adm' } })
    const { methodCalls } = JSON.parse(String(init?.body)) as { methodCalls: Array<[string, any, string]> }
    const responses = methodCalls.map(([name, args, tag]) => {
      if (name === 'x:Domain/get') return [name, { list: [{ id: 'd1', name: 'rox.one' }] }, tag]
      if (name === 'x:Account/query') return [name, { ids: [] }, tag]
      if (name === 'x:Account/set') {
        if (args.create) { quotaBytes = args.create.a.quotas?.maxDiskQuota ?? null; marker = args.create.a.description; return [name, { created: { a: { id: 'acc-1' } } }, tag] }
        const patch = Object.values(args.update)[0] as { quotas?: { maxDiskQuota: number } }
        if (patch.quotas) quotaBytes = patch.quotas.maxDiskQuota
        return [name, { updated: { 'acc-1': null } }, tag]
      }
      return [name, {}, tag]
    })
    return json({ methodResponses: responses })
  }
  return { fetchImpl, quota: () => quotaBytes, marker: () => marker, brokerCalls: () => brokerCalls }
}

describe('provision quota', () => {
  const config = loadConfig({
    MAIL_INBOUND_SECRET: 'x'.repeat(32), STALWART_ADMIN_USER: 'admin', STALWART_ADMIN_PASSWORD: 'pw',
    MAIL_DEFAULT_QUOTA_BYTES: String(3 * 1024 ** 3),
  })
  const provision = (body?: unknown, token = 'rox-user-token') =>
    new Request('http://maild/api/provision', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })

  test('applies the configured default when no quota is supplied', async () => {
    const { fetchImpl, quota } = fakeProvisionFetch()
    const result = await handleProvision(provision(), { config, fetchImpl })
    expect(result.status).toBe(200)
    expect(quota()).toBe(3 * 1024 ** 3)
    expect(result.body.quotaBytes).toBe(3 * 1024 ** 3)
  })

  test('accepts an explicit quota and rejects out-of-bounds values', async () => {
    const explicit = fakeProvisionFetch()
    const accepted = await handleProvision(provision({ quotaBytes: 2 * 1024 ** 3 }), { config, fetchImpl: explicit.fetchImpl })
    expect(accepted.status).toBe(200)
    expect(explicit.quota()).toBe(2 * 1024 ** 3)

    for (const bad of [MIN_MAILBOX_QUOTA_BYTES - 1, MAX_MAILBOX_QUOTA_BYTES + 1, 1024.5, 'lots']) {
      const rejected = fakeProvisionFetch()
      const result = await handleProvision(provision({ quotaBytes: bad }), { config, fetchImpl: rejected.fetchImpl })
      expect(result.status).toBe(400)
      expect(result.body.error).toBe('invalid_quota')
      expect(rejected.quota()).toBeNull()
    }
  })
})

describe('provision service token', () => {
  const env = { MAIL_INBOUND_SECRET: 'x'.repeat(32), STALWART_ADMIN_USER: 'admin', STALWART_ADMIN_PASSWORD: 'pw' }
  const withToken = loadConfig({ ...env, MAIL_PROVISION_SERVICE_TOKEN: 'svc-token-abc' })
  const withoutToken = loadConfig(env)
  const provision = (body: unknown, token: string) =>
    new Request('http://maild/api/provision', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })

  test('accepts the service token and provisions for the body owner without the broker', async () => {
    const fake = fakeProvisionFetch()
    const result = await handleProvision(provision({ ownerUuid: 'u-7', handle: 'drain' }, 'svc-token-abc'), { config: withToken, fetchImpl: fake.fetchImpl })
    expect(result.status).toBe(200)
    expect(result.body.address).toBe('drain@rox.one')
    expect(fake.marker()).toBe('rox:u-7')
    expect(fake.brokerCalls()).toBe(0)
  })

  test('rejects a wrong token when the service token is configured', async () => {
    const fake = fakeProvisionFetch()
    const result = await handleProvision(provision({ ownerUuid: 'u-7' }, 'not-the-service-token'), { config: withToken, fetchImpl: fake.fetchImpl })
    expect(result.status).toBe(401)
    expect(result.body.error).toBe('invalid_token')
    expect(fake.brokerCalls()).toBe(1)
  })

  test('requires ownerUuid from a service-token caller', async () => {
    const fake = fakeProvisionFetch()
    const result = await handleProvision(provision({}, 'svc-token-abc'), { config: withToken, fetchImpl: fake.fetchImpl })
    expect(result.status).toBe(400)
    expect(result.body.error).toBe('missing_owner')
  })

  test('is disabled when the env var is unset (user-token behavior unchanged)', async () => {
    const fake = fakeProvisionFetch()
    const asService = await handleProvision(provision({ ownerUuid: 'u-7' }, 'svc-token-abc'), { config: withoutToken, fetchImpl: fake.fetchImpl })
    expect(asService.status).toBe(401)
    const asUser = await handleProvision(provision(undefined, 'rox-user-token'), { config: withoutToken, fetchImpl: fake.fetchImpl })
    expect(asUser.status).toBe(200)
    expect(asUser.body.address).toBe('mark@rox.one')
  })
})
