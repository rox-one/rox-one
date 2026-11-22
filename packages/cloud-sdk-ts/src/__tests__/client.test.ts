import { describe, expect, it } from 'bun:test'
import {
  RoxApiError,
  createRoxClient,
  type Account,
  type ApiKey,
  type ExecResult,
  type FetchLike,
  type ProviderCredential,
  type RoxClient,
  type Sandbox,
} from '../index.ts'

const API_KEY = 'rox_sk_live_test_0123456789abcdef'
const BASE_URL = 'https://api.rox.test'
const REQUEST_ID = 'req_0123456789abcdef01234567'

interface RecordedCall {
  url: string
  method: string
  headers: Record<string, string>
  body: string | Uint8Array | undefined
}

type Handler = (call: RecordedCall) => Response | Promise<Response>

interface Recorder {
  calls: RecordedCall[]
  fetchImpl: FetchLike
}

/** A fetch that records exactly what the client put on the wire. */
function recordCalls(handler: Handler): Recorder {
  const calls: RecordedCall[] = []
  const fetchImpl: FetchLike = async (url, init) => {
    const body = init.body
    const call: RecordedCall = {
      url,
      method: init.method ?? 'GET',
      headers: { ...((init.headers ?? {}) as Record<string, string>) },
      body:
        typeof body === 'string'
          ? body
          : body instanceof Uint8Array
            ? body
            : undefined,
    }
    calls.push(call)
    return handler(call)
  }
  return { calls, fetchImpl }
}

function makeClient(handler: Handler): { client: RoxClient; calls: RecordedCall[] } {
  const { calls, fetchImpl } = recordCalls(handler)
  return { client: createRoxClient({ baseUrl: BASE_URL, apiKey: API_KEY, fetch: fetchImpl }), calls }
}

function jsonBody(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'x-request-id': REQUEST_ID },
  })
}

function errorBody(
  code: string,
  message: string,
  options: { type?: string; status?: number; requestId?: string } = {},
): Response {
  const requestId = options.requestId ?? REQUEST_ID
  return new Response(
    JSON.stringify({ error: { type: options.type ?? 'api_error', code, message, request_id: requestId } }),
    { status: options.status ?? 400, headers: { 'content-type': 'application/json', 'x-request-id': requestId } },
  )
}

const SANDBOX: Sandbox = {
  id: 'sbx_0123456789abcdef01234567',
  object: 'sandbox',
  provider: 'daytona',
  state: 'running',
  created_at: '2026-11-19T10:00:00.000Z',
  expires_at: null,
  cost_so_far_cents: 12,
  cost_so_far_usd: '0.12',
  routing_reason: null,
}

const KEY: ApiKey = {
  id: 'key_0123456789abcdef01234567',
  prefix: 'rox_sk_live_',
  last4: 'cdef',
  scopes: ['sandboxes:read', 'sandboxes:write'],
  created_at: '2026-11-19T10:00:00.000Z',
  last_used_at: null,
}

const ACCOUNT: Account = {
  object: 'account',
  balance_cents: 5_000,
  reserved_cents: 0,
  month_spent_cents: 120,
  monthly_cap_cents: 0,
  rate_cents_per_hour: null,
  currency: 'USD',
  balance_usd: '50.00',
}

const CREDENTIAL: ProviderCredential = {
  id: 'cred_0123456789abcdef01234567',
  object: 'provider_credential',
  provider: 'daytona',
  label: 'Primary',
  fingerprint: 'f'.repeat(64),
  last4: '1234',
  status: 'active',
  spend_cap_cents: 5_000,
  regions: ['eu'],
  products: ['sandbox'],
  health: 'unknown',
  created_at: '2026-11-19T10:00:00.000Z',
  checked_at: null,
  expires_at: null,
}

const SPEC = { os: 'linux', cpu: 2, memoryGb: 4 } as const

/** One handler that answers every documented route with a valid body. */
function route(call: RecordedCall): Response {
  const url = new URL(call.url)
  const path = url.pathname

  if (call.method === 'POST' && path === '/v1/sandboxes') return jsonBody(SANDBOX, 201)
  if (call.method === 'GET' && path === '/v1/sandboxes') {
    return jsonBody({ object: 'list', data: [SANDBOX], has_more: false, next_cursor: null })
  }
  if (call.method === 'POST' && path === `/v1/sandboxes/${SANDBOX.id}/exec`) {
    return jsonBody({ stdout: 'ok', stderr: '', exit_code: 0 })
  }
  if (call.method === 'GET' && path === `/v1/sandboxes/${SANDBOX.id}/files`) {
    return new Response(new Uint8Array([1, 2, 3]), {
      status: 200,
      headers: { 'x-request-id': REQUEST_ID },
    })
  }
  if (call.method === 'PUT' && path === `/v1/sandboxes/${SANDBOX.id}/files`) {
    return new Response(null, { status: 204, headers: { 'x-request-id': REQUEST_ID } })
  }
  if (call.method === 'POST' && path === `/v1/sandboxes/${SANDBOX.id}/stop`) return jsonBody(SANDBOX)
  if (call.method === 'GET' && path === `/v1/sandboxes/${SANDBOX.id}`) return jsonBody(SANDBOX)
  if (call.method === 'DELETE' && path === `/v1/sandboxes/${SANDBOX.id}`) {
    return new Response(null, { status: 204, headers: { 'x-request-id': REQUEST_ID } })
  }

  if (call.method === 'POST' && path === '/v1/keys') return jsonBody({ ...KEY, secret: 'rox_sk_live_minted' }, 201)
  if (call.method === 'GET' && path === '/v1/keys') return jsonBody({ object: 'list', data: [KEY] })
  if (call.method === 'DELETE' && path === `/v1/keys/${KEY.id}`) {
    return new Response(null, { status: 204, headers: { 'x-request-id': REQUEST_ID } })
  }

  if (call.method === 'GET' && path === '/v1/account') return jsonBody(ACCOUNT)
  if (call.method === 'POST' && path === '/v1/account/topup') return jsonBody(ACCOUNT)

  if (call.method === 'POST' && path === '/v1/provider-credentials') return jsonBody(CREDENTIAL, 201)
  if (call.method === 'GET' && path === '/v1/provider-credentials') {
    return jsonBody({ object: 'list', data: [CREDENTIAL] })
  }
  if (call.method === 'POST' && path === `/v1/provider-credentials/${CREDENTIAL.id}/promote`) {
    return jsonBody(CREDENTIAL)
  }
  if (call.method === 'DELETE' && path === `/v1/provider-credentials/${CREDENTIAL.id}`) {
    return jsonBody(CREDENTIAL)
  }

  return errorBody('not_found', 'Такого адреса нет', { status: 404 })
}

/** Every method of the client, so one loop proves the shared header contract. */
const ALL_METHODS: Array<{ name: string; run: (client: RoxClient) => Promise<unknown> }> = [
  { name: 'sandboxes.create', run: (c) => c.sandboxes.create(SPEC) },
  { name: 'sandboxes.get', run: (c) => c.sandboxes.get(SANDBOX.id) },
  { name: 'sandboxes.list', run: (c) => c.sandboxes.list() },
  { name: 'sandboxes.exec', run: (c) => c.sandboxes.exec(SANDBOX.id, 'true') },
  { name: 'sandboxes.readFile', run: (c) => c.sandboxes.readFile(SANDBOX.id, '/tmp/a') },
  { name: 'sandboxes.writeFile', run: (c) => c.sandboxes.writeFile(SANDBOX.id, '/tmp/a', new Uint8Array([1])) },
  { name: 'sandboxes.stop', run: (c) => c.sandboxes.stop(SANDBOX.id) },
  { name: 'sandboxes.delete', run: (c) => c.sandboxes.delete(SANDBOX.id) },
  { name: 'keys.create', run: (c) => c.keys.create({ scopes: ['sandboxes:read'] }) },
  { name: 'keys.list', run: (c) => c.keys.list() },
  { name: 'keys.revoke', run: (c) => c.keys.revoke(KEY.id) },
  { name: 'account.get', run: (c) => c.account.get() },
  { name: 'account.topUp', run: (c) => c.account.topUp(1_000) },
  {
    name: 'providerCredentials.add',
    run: (c) =>
      c.providerCredentials.add({ provider: 'daytona', label: 'Primary', secret: 'dt_x', spendCapCents: 100 }),
  },
  { name: 'providerCredentials.list', run: (c) => c.providerCredentials.list() },
  { name: 'providerCredentials.promote', run: (c) => c.providerCredentials.promote(CREDENTIAL.id) },
  { name: 'providerCredentials.disable', run: (c) => c.providerCredentials.disable(CREDENTIAL.id) },
]

describe('authentication header', () => {
  it('sends the bearer key and never puts it in a URL', async () => {
    for (const method of ALL_METHODS) {
      const { client, calls } = makeClient(route)
      await method.run(client)
      expect(calls).toHaveLength(1)
      expect(calls[0]?.headers.authorization).toBe(`Bearer ${API_KEY}`)
      expect(calls[0]?.url).not.toContain(API_KEY)
    }
  })

  it('refuses to build a client without a key or base url', () => {
    expect(() => createRoxClient({ baseUrl: BASE_URL, apiKey: '' })).toThrow('apiKey is required')
    expect(() => createRoxClient({ baseUrl: '', apiKey: API_KEY })).toThrow('baseUrl is required')
  })
})

describe('documented paths', () => {
  const expected: Array<{ name: string; run: (client: RoxClient) => Promise<unknown>; method: string; path: string }> = [
    { name: 'sandboxes.create', run: (c) => c.sandboxes.create(SPEC), method: 'POST', path: '/v1/sandboxes' },
    { name: 'sandboxes.get', run: (c) => c.sandboxes.get(SANDBOX.id), method: 'GET', path: `/v1/sandboxes/${SANDBOX.id}` },
    { name: 'sandboxes.list', run: (c) => c.sandboxes.list(), method: 'GET', path: '/v1/sandboxes' },
    {
      name: 'sandboxes.exec',
      run: (c) => c.sandboxes.exec(SANDBOX.id, 'true'),
      method: 'POST',
      path: `/v1/sandboxes/${SANDBOX.id}/exec`,
    },
    {
      name: 'sandboxes.readFile',
      run: (c) => c.sandboxes.readFile(SANDBOX.id, '/tmp/a'),
      method: 'GET',
      path: `/v1/sandboxes/${SANDBOX.id}/files`,
    },
    {
      name: 'sandboxes.writeFile',
      run: (c) => c.sandboxes.writeFile(SANDBOX.id, '/tmp/a', new Uint8Array([1])),
      method: 'PUT',
      path: `/v1/sandboxes/${SANDBOX.id}/files`,
    },
    { name: 'sandboxes.stop', run: (c) => c.sandboxes.stop(SANDBOX.id), method: 'POST', path: `/v1/sandboxes/${SANDBOX.id}/stop` },
    {
      name: 'sandboxes.delete',
      run: (c) => c.sandboxes.delete(SANDBOX.id),
      method: 'DELETE',
      path: `/v1/sandboxes/${SANDBOX.id}`,
    },
    { name: 'keys.create', run: (c) => c.keys.create({ scopes: ['keys:write'] }), method: 'POST', path: '/v1/keys' },
    { name: 'keys.list', run: (c) => c.keys.list(), method: 'GET', path: '/v1/keys' },
    { name: 'keys.revoke', run: (c) => c.keys.revoke(KEY.id), method: 'DELETE', path: `/v1/keys/${KEY.id}` },
    { name: 'account.get', run: (c) => c.account.get(), method: 'GET', path: '/v1/account' },
    { name: 'account.topUp', run: (c) => c.account.topUp(2_500), method: 'POST', path: '/v1/account/topup' },
    {
      name: 'providerCredentials.add',
      run: (c) =>
        c.providerCredentials.add({ provider: 'modal', label: 'Spare', secret: 'ak_x', spendCapCents: 500 }),
      method: 'POST',
      path: '/v1/provider-credentials',
    },
    {
      name: 'providerCredentials.list',
      run: (c) => c.providerCredentials.list(),
      method: 'GET',
      path: '/v1/provider-credentials',
    },
    {
      name: 'providerCredentials.promote',
      run: (c) => c.providerCredentials.promote(CREDENTIAL.id),
      method: 'POST',
      path: `/v1/provider-credentials/${CREDENTIAL.id}/promote`,
    },
    {
      name: 'providerCredentials.disable',
      run: (c) => c.providerCredentials.disable(CREDENTIAL.id),
      method: 'DELETE',
      path: `/v1/provider-credentials/${CREDENTIAL.id}`,
    },
  ]

  it('builds the path and verb of every operation in the spec', async () => {
    for (const entry of expected) {
      const { client, calls } = makeClient(route)
      await entry.run(client)
      const call = calls[0]
      expect(call?.method).toBe(entry.method)
      expect(new URL(call?.url ?? '').pathname).toBe(entry.path)
    }
  })

  it('keeps ids out of the path when they contain separators', async () => {
    const { client, calls } = makeClient(route)
    await client.sandboxes.get('sbx/../escape').catch(() => undefined)
    expect(new URL(calls[0]?.url ?? '').pathname).toBe('/v1/sandboxes/sbx%2F..%2Fescape')
  })
})

describe('sandbox creation', () => {
  it('always sends an idempotency key and generates a fresh one when absent', async () => {
    const { client, calls } = makeClient(route)
    await client.sandboxes.create(SPEC)
    await client.sandboxes.create(SPEC)
    const first = calls[0]?.headers['idempotency-key']
    const second = calls[1]?.headers['idempotency-key']
    expect(typeof first).toBe('string')
    expect((first ?? '').length).toBeGreaterThan(0)
    expect(second).not.toBe(first)
  })

  it('honours a caller-supplied idempotency key', async () => {
    const { client, calls } = makeClient(route)
    await client.sandboxes.create(SPEC, { idempotencyKey: 'boot-42' })
    expect(calls[0]?.headers['idempotency-key']).toBe('boot-42')
    expect(JSON.parse(String(calls[0]?.body))).toEqual(SPEC)
  })

  it('treats a repeated key answered with 200 as the same sandbox', async () => {
    const { client } = makeClient(() => jsonBody(SANDBOX, 200))
    const sandbox = await client.sandboxes.create(SPEC, { idempotencyKey: 'boot-42' })
    expect(sandbox.id).toBe(SANDBOX.id)
  })
})

describe('sandboxes', () => {
  it('parses exit_code, stdout and stderr from exec', async () => {
    const { client, calls } = makeClient(() =>
      jsonBody({ stdout: 'done', stderr: 'warn', exit_code: 3 } satisfies ExecResult),
    )
    const result = await client.sandboxes.exec(SANDBOX.id, 'make test', { timeoutSec: 30 })
    expect(result.exit_code).toBe(3)
    expect(result.stdout).toBe('done')
    expect(result.stderr).toBe('warn')
    expect(JSON.parse(String(calls[0]?.body))).toEqual({ command: 'make test', timeoutSec: 30 })
  })

  it('omits timeoutSec when the caller did not ask for one', async () => {
    const { client, calls } = makeClient(() => jsonBody({ stdout: '', stderr: '', exit_code: 0 }))
    await client.sandboxes.exec(SANDBOX.id, 'true')
    expect(JSON.parse(String(calls[0]?.body))).toEqual({ command: 'true' })
  })

  it('round-trips file bytes through the octet-stream endpoints', async () => {
    const files = new Map<string, Uint8Array>()
    const { client, calls } = makeClient((call) => {
      const path = new URL(call.url).searchParams.get('path')
      if (path === null) return errorBody('invalid_request', 'Параметр path обязателен', { status: 400 })
      if (call.method === 'PUT') {
        files.set(path, call.body instanceof Uint8Array ? new Uint8Array(call.body) : new Uint8Array())
        return new Response(null, { status: 204, headers: { 'x-request-id': REQUEST_ID } })
      }
      const stored = files.get(path)
      if (stored === undefined) return errorBody('not_found', 'Файл не найден', { status: 404 })
      return new Response(new Uint8Array(stored), { status: 200, headers: { 'x-request-id': REQUEST_ID } })
    })

    const payload = new Uint8Array([0, 1, 254, 255])
    expect(await client.sandboxes.writeFile(SANDBOX.id, '/tmp/blob.bin', payload)).toBeUndefined()
    const read = await client.sandboxes.readFile(SANDBOX.id, '/tmp/blob.bin')
    expect(read).toBeInstanceOf(Uint8Array)
    expect(Array.from(read)).toEqual([0, 1, 254, 255])

    await client.sandboxes.writeFile(SANDBOX.id, '/tmp/note.txt', 'hello')
    expect(Array.from(files.get('/tmp/note.txt') ?? [])).toEqual(Array.from(new TextEncoder().encode('hello')))
    expect(calls[0]?.headers['content-type']).toBe('application/octet-stream')
    expect(calls[1]?.headers.accept).toBe('application/octet-stream')
    expect(new URL(calls[0]?.url ?? '').searchParams.get('path')).toBe('/tmp/blob.bin')
  })

  it('sends the cursor as a query parameter and nothing when unset', async () => {
    const { client, calls } = makeClient(route)
    const page = await client.sandboxes.list({ limit: 5, startingAfter: SANDBOX.id })
    expect(Array.isArray(page.data)).toBe(true)
    expect(page.has_more).toBe(false)
    const params = new URL(calls[0]?.url ?? '').searchParams
    expect(params.get('limit')).toBe('5')
    expect(params.get('starting_after')).toBe(SANDBOX.id)

    await client.sandboxes.list()
    expect(calls[1]?.url).toBe(`${BASE_URL}/v1/sandboxes`)
  })

  it('returns void for a 204 delete', async () => {
    const { client, calls } = makeClient(route)
    const result = await client.sandboxes.delete(SANDBOX.id)
    expect(result).toBeUndefined()
    expect(calls[0]?.headers.accept).toBe('application/json')
  })

  it('returns the stopped sandbox from stop', async () => {
    const { client } = makeClient(() => jsonBody({ ...SANDBOX, state: 'stopped' }))
    const sandbox = await client.sandboxes.stop(SANDBOX.id)
    expect(sandbox.state).toBe('stopped')
  })
})

describe('keys, account and provider credentials', () => {
  it('sends scopes on key creation and returns the one-time secret', async () => {
    const { client, calls } = makeClient(route)
    const created = await client.keys.create({ scopes: ['sandboxes:read', 'sandboxes:write'] })
    expect(created.secret).toBe('rox_sk_live_minted')
    expect(JSON.parse(String(calls[0]?.body))).toEqual({ scopes: ['sandboxes:read', 'sandboxes:write'] })
  })

  it('revokes a key with a 204', async () => {
    const { client, calls } = makeClient(route)
    expect(await client.keys.revoke(KEY.id)).toBeUndefined()
    expect(calls[0]?.method).toBe('DELETE')
  })

  it('tops up in integer cents', async () => {
    const { client, calls } = makeClient(route)
    const account = await client.account.topUp(12_345)
    expect(account.balance_cents).toBe(5_000)
    expect(JSON.parse(String(calls[0]?.body))).toEqual({ amountCents: 12_345 })
  })

  it('adds a provider credential with its spend cap and lists metadata only', async () => {
    const { client, calls } = makeClient(route)
    const credential = await client.providerCredentials.add({
      provider: 'daytona',
      label: 'Primary',
      secret: 'dt_live_secret',
      spendCapCents: 5_000,
      regions: ['eu'],
      products: ['sandbox'],
    })
    expect(credential.spend_cap_cents).toBe(5_000)
    expect(JSON.parse(String(calls[0]?.body))).toEqual({
      provider: 'daytona',
      label: 'Primary',
      secret: 'dt_live_secret',
      spendCapCents: 5_000,
      regions: ['eu'],
      products: ['sandbox'],
    })
    const listed = await client.providerCredentials.list()
    expect(listed.data[0]?.id).toBe(CREDENTIAL.id)
  })

  it('promotes and disables by id', async () => {
    const { client, calls } = makeClient(route)
    await client.providerCredentials.promote(CREDENTIAL.id)
    await client.providerCredentials.disable(CREDENTIAL.id)
    expect(calls[0]?.method).toBe('POST')
    expect(calls[1]?.method).toBe('DELETE')
  })
})

describe('errors', () => {
  it('maps the error envelope, keeping the Russian message and request id', async () => {
    const { client } = makeClient(() =>
      errorBody('insufficient_balance', 'Не хватает средств на запуск машины', {
        type: 'payment_error',
        status: 402,
        requestId: 'req_abcdefabcdefabcdefabcdef',
      }),
    )
    const failure = await client.sandboxes.create(SPEC).catch((err: unknown) => err)
    expect(failure).toBeInstanceOf(RoxApiError)
    const error = failure as RoxApiError
    expect(error.status).toBe(402)
    expect(error.code).toBe('insufficient_balance')
    expect(error.type).toBe('payment_error')
    expect(error.message).toBe('Не хватает средств на запуск машины')
    expect(error.requestId).toBe('req_abcdefabcdefabcdefabcdef')
  })

  it('falls back to the header request id when the envelope omits it', async () => {
    const { client } = makeClient(
      () =>
        new Response(JSON.stringify({ error: { type: 'conflict_error', code: 'conflict', message: 'Ключ занят' } }), {
          status: 409,
          headers: { 'x-request-id': REQUEST_ID },
        }),
    )
    const error = (await client.sandboxes.create(SPEC).catch((err: unknown) => err)) as RoxApiError
    expect(error.code).toBe('conflict')
    expect(error.requestId).toBe(REQUEST_ID)
  })

  it('reports an unreadable error body as invalid_response', async () => {
    const { client } = makeClient(
      () => new Response('upstream exploded', { status: 502, headers: { 'x-request-id': REQUEST_ID } }),
    )
    const error = (await client.sandboxes.get(SANDBOX.id).catch((err: unknown) => err)) as RoxApiError
    expect(error).toBeInstanceOf(RoxApiError)
    expect(error.code).toBe('invalid_response')
    expect(error.status).toBe(502)
    expect(error.requestId).toBe(REQUEST_ID)
  })

  it('reports a non-JSON success body as invalid_response', async () => {
    const { client } = makeClient(
      () => new Response('<html>not json</html>', { status: 200, headers: { 'x-request-id': REQUEST_ID } }),
    )
    const error = (await client.account.get().catch((err: unknown) => err)) as RoxApiError
    expect(error.code).toBe('invalid_response')
    expect(error.status).toBe(200)
  })

  it('turns a transport failure into network_error', async () => {
    const { client } = makeClient(() => {
      throw new TypeError('socket hang up')
    })
    const error = (await client.sandboxes.list().catch((err: unknown) => err)) as RoxApiError
    expect(error).toBeInstanceOf(RoxApiError)
    expect(error.code).toBe('network_error')
    expect(error.type).toBe('network_error')
    expect(error.status).toBe(0)
    expect(error.requestId).toBeNull()
    expect(error.message).toContain('socket hang up')
  })

  it('never lets the presented key reach an error message', async () => {
    const { client: transportFailure } = makeClient(() => {
      throw new Error(`connect failed for ${API_KEY}`)
    })
    const network = (await transportFailure.account.get().catch((err: unknown) => err)) as RoxApiError
    expect(network.message).not.toContain(API_KEY)

    const { client: echoing } = makeClient(() => errorBody('authentication_required', `Ключ ${API_KEY} неизвестен`, { status: 401 }))
    const server = (await echoing.account.get().catch((err: unknown) => err)) as RoxApiError
    expect(server.message).not.toContain(API_KEY)
    expect(server.message).toContain('[REDACTED]')
  })

  it('times out locally as a network error', async () => {
    // The fake fetch only ever settles through the abort signal, so the local
    // deadline is the one event that can finish this promise: no guessed wait.
    const fetchImpl: FetchLike = (_url, init) => {
      const { promise, reject } = Promise.withResolvers<Response>()
      init.signal?.addEventListener('abort', () => {
        const abortError = new Error('The operation was aborted')
        abortError.name = 'AbortError'
        reject(abortError)
      })
      return promise
    }
    const client = createRoxClient({ baseUrl: BASE_URL, apiKey: API_KEY, fetch: fetchImpl, timeoutMs: 0 })
    const error = (await client.account.get().catch((err: unknown) => err)) as RoxApiError
    expect(error.code).toBe('network_error')
    expect(error.message).toContain('timed out')
  })
})
