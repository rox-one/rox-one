/**
 * Contract tests for the Rox Cloud public API.
 *
 * Every test drives the API through `Request`/`Response`, exactly like an SDK
 * would, and uses fake providers so no customer credential is ever touched.
 */

import { describe, expect, test } from 'bun:test'

import type {
  SandboxExecResult,
  SandboxProvider,
  SandboxSpec,
  SandboxState,
  SandboxStatus,
} from '../../../../packages/cloud-runner/src/sandbox.ts'
import { CloudRunnerError } from '../../../../packages/cloud-runner/src/types.ts'
import { createApp } from '../app.ts'
import type { CloudApp, DeclaredCapabilities, RateLimitOptions } from '../app.ts'
import { generateApiKey } from '../auth.ts'
import { createMemoryStore, nextId } from '../store.ts'
import type { MemoryStore, Scope, Tenant } from '../store.ts'

// ============================================================
// Fixtures
// ============================================================

const NOW = Date.UTC(2026, 10, 19, 12, 0, 0)

const CAPABILITIES: DeclaredCapabilities = {
  id: 'daytona',
  os: ['linux', 'windows'],
  gpu: true,
  pause: true,
  snapshot: true,
  volume: true,
  streaming: 'none',
  maxTtlSec: 86_400,
  regions: ['eu-central'],
}

const ALL_SCOPES: readonly Scope[] = [
  'sandboxes:read',
  'sandboxes:write',
  'keys:write',
  'billing:read',
  'billing:write',
]

interface FakeSandbox {
  spec: SandboxSpec
  state: SandboxState
  files: Map<string, Uint8Array>
}

/** In-memory provider: the same shape a real Daytona/Modal adapter exposes. */
class FakeProvider implements SandboxProvider {
  readonly providerId: string
  readonly created: SandboxSpec[] = []
  readonly sandboxes = new Map<string, FakeSandbox>()
  costUsd = 0.05
  /** What the last exec was asked for, so the wire shape can be asserted. */
  lastExec?: { command: string; cwd?: string; timeoutMs?: number }

  constructor(providerId = 'daytona') {
    this.providerId = providerId
  }

  async create(spec: SandboxSpec): Promise<SandboxStatus> {
    this.created.push(spec)
    this.sandboxes.set(spec.id, { spec, state: 'running', files: new Map() })
    return {
      id: spec.id,
      provider: this.providerId,
      state: 'running',
      createdAt: NOW,
      expiresAt: spec.ttlSec === undefined ? undefined : NOW + spec.ttlSec * 1000,
      costSoFarUsd: this.costUsd,
    }
  }

  async get(id: string): Promise<SandboxStatus> {
    const sandbox = this.sandboxes.get(id)
    if (!sandbox) throw new CloudRunnerError('unknown sandbox', 'not_found')
    return { id, provider: this.providerId, state: sandbox.state, createdAt: NOW }
  }

  async exec(
    id: string,
    command: string,
    opts?: { cwd?: string; timeoutMs?: number },
  ): Promise<SandboxExecResult> {
    if (!this.sandboxes.has(id)) throw new CloudRunnerError('unknown sandbox', 'not_found')
    this.lastExec = { command, ...(opts?.cwd === undefined ? {} : { cwd: opts.cwd }), ...(opts?.timeoutMs === undefined ? {} : { timeoutMs: opts.timeoutMs }) }
    return { stdout: `ok: ${command}`, stderr: '', exitCode: 0 }
  }

  async readFile(id: string, path: string): Promise<Uint8Array> {
    const bytes = this.sandboxes.get(id)?.files.get(path)
    if (!bytes) throw new CloudRunnerError('unknown file', 'not_found')
    return bytes
  }

  async writeFile(id: string, path: string, data: Uint8Array): Promise<void> {
    const sandbox = this.sandboxes.get(id)
    if (!sandbox) throw new CloudRunnerError('unknown sandbox', 'not_found')
    sandbox.files.set(path, data)
  }

  async stop(id: string): Promise<void> {
    const sandbox = this.sandboxes.get(id)
    if (!sandbox) throw new CloudRunnerError('unknown sandbox', 'not_found')
    sandbox.state = 'stopped'
  }

  async destroy(id: string): Promise<void> {
    this.sandboxes.delete(id)
  }
}

function seedTenant(store: MemoryStore, scopes: readonly Scope[]): { tenant: Tenant; secret: string } {
  const tenant = store.addTenant('Тестовая команда')
  const generated = generateApiKey()
  store.addApiKey({
    id: nextId('key_'),
    tenantId: tenant.id,
    prefix: generated.prefix,
    last4: generated.last4,
    hash: generated.hash,
    scopes,
    createdAt: NOW,
  })
  return { tenant, secret: generated.secret }
}

interface Harness {
  app: CloudApp
  store: MemoryStore
  tenant: Tenant
  secret: string
  provider: FakeProvider
}

interface HarnessOptions {
  scopes?: readonly Scope[]
  capabilities?: readonly DeclaredCapabilities[]
  resolve?: (tenantId: string, providerId: string) => SandboxProvider | null
  rateLimit?: RateLimitOptions
}

function harness(options: HarnessOptions = {}): Harness {
  const store = createMemoryStore()
  const { tenant, secret } = seedTenant(store, options.scopes ?? ALL_SCOPES)
  const provider = new FakeProvider('daytona')
  const capabilities = options.capabilities ?? [CAPABILITIES]
  const resolve = options.resolve ?? ((tenantId: string, providerId: string) => (providerId === 'daytona' ? provider : null))
  const app = createApp({
    store,
    resolveProvider: resolve,
    listCapabilities: () => capabilities,
    defaultProvider: 'daytona',
    now: () => NOW,
    rateLimit: options.rateLimit,
  })
  return { app, store, tenant, secret, provider }
}

interface CallOptions {
  method?: string
  token?: string | null
  body?: unknown
  raw?: BufferSource
  headers?: Record<string, string>
}

async function call(app: CloudApp, path: string, options: CallOptions = {}): Promise<Response> {
  const headers: Record<string, string> = { ...options.headers }
  if (typeof options.token === 'string') headers.authorization = `Bearer ${options.token}`
  let body: BodyInit | undefined
  if (options.raw !== undefined) {
    body = options.raw
    headers['content-type'] = 'application/octet-stream'
  } else if (options.body !== undefined) {
    body = JSON.stringify(options.body)
    headers['content-type'] = 'application/json'
  }
  return app.handle(new Request(`http://api.test${path}`, { method: options.method ?? 'GET', headers, body }))
}

async function readBody<T>(response: Response): Promise<T> {
  return (await response.json()) as T
}

interface ErrorBody {
  error: { type: string; code: string; message: string; request_id: string }
}

interface SandboxBody {
  id: string
  object: string
  provider: string
  state: string
  created_at: string
  expires_at: string | null
  cost_so_far_cents: number
  cost_so_far_usd: string
  routing_reason: string | null
  spec: {
    os: string
    cpu: number
    memoryGb: number
    diskGb: number | null
    snapshot: string | null
    region: string | null
    ttlSec: number | null
  }
  region: string | null
  billing: {
    mode: string
    rate_cents_per_hour: number | null
    retail_cents_per_hour: number | null
    service_fee_cents_per_hour: number | null
  }
}

interface ListBody<T> {
  object: string
  data: T[]
  has_more: boolean
  next_cursor: string | null
}

interface CatalogProvider {
  id: string
  os: string[]
  gpu: boolean
  pause: boolean
  snapshot: boolean
  volume: boolean
  streaming: string
  max_ttl_sec: number
  regions: string[]
}

interface KeyBody {
  id: string
  api_key: string
  prefix: string
  last4: string
  scopes: string[]
  created_at: string
}

interface KeyMetadata {
  id: string
  prefix: string
  last4: string
  scopes: string[]
  created_at: string
  last_used_at: string | null
}

const SPEC_BODY = { os: 'linux' as const, cpu: 2, memoryGb: 4 }

function createSandbox(
  app: CloudApp,
  token: string,
  idempotencyKey: string,
  body: Record<string, unknown> = SPEC_BODY,
): Promise<Response> {
  return call(app, '/v1/sandboxes', {
    method: 'POST',
    token,
    headers: { 'idempotency-key': idempotencyKey },
    body,
  })
}

// ============================================================
// Basics
// ============================================================

describe('health and authentication', () => {
  test('health answers ok without a key and carries a request id', async () => {
    const { app } = harness()
    const response = await call(app, '/health')
    expect(response.status).toBe(200)
    expect(await readBody<{ ok: boolean }>(response)).toEqual({ ok: true })
    expect(response.headers.get('x-request-id')).toMatch(/^req_[0-9a-f]{24}$/)
  })

  test('missing key is 401 authentication_required', async () => {
    const { app } = harness()
    const response = await call(app, '/v1/sandboxes')
    expect(response.status).toBe(401)
    const body = await readBody<ErrorBody>(response)
    expect(body.error.type).toBe('authentication_error')
    expect(body.error.code).toBe('authentication_required')
    expect(body.error.message.length).toBeGreaterThan(0)
    expect(body.error.request_id).toMatch(/^req_/)
    expect(response.headers.get('x-request-id')).toBe(body.error.request_id)
  })

  test('unknown key is 401 as well', async () => {
    const { app } = harness()
    const response = await call(app, '/v1/sandboxes', { token: 'rox_sk_live_nope' })
    expect(response.status).toBe(401)
    expect((await readBody<ErrorBody>(response)).error.code).toBe('authentication_required')
  })

  test('wrong scope is 403 permission_denied', async () => {
    const { app, secret } = harness({ scopes: ['sandboxes:read'] })
    const response = await call(app, '/v1/sandboxes', {
      method: 'POST',
      token: secret,
      headers: { 'idempotency-key': 'scope-check' },
      body: SPEC_BODY,
    })
    expect(response.status).toBe(403)
    const body = await readBody<ErrorBody>(response)
    expect(body.error.type).toBe('permission_error')
    expect(body.error.code).toBe('permission_denied')
  })

  test('errors keep the envelope and the request id header together', async () => {
    const { app } = harness()
    const response = await call(app, '/v1/does-not-exist')
    expect(response.status).toBe(404)
    const body = await readBody<ErrorBody>(response)
    expect(body.error.code).toBe('not_found')
    expect(response.headers.get('x-request-id')).toBe(body.error.request_id)
  })

  test('rate limit answers 429 rate_limited', async () => {
    const { app, secret } = harness({ rateLimit: { limit: 2, windowMs: 60_000 } })
    await call(app, '/health')
    expect((await call(app, '/v1/sandboxes', { token: secret })).status).toBe(200)
    expect((await call(app, '/v1/sandboxes', { token: secret })).status).toBe(200)
    const response = await call(app, '/v1/sandboxes', { token: secret })
    expect(response.status).toBe(429)
    expect((await readBody<ErrorBody>(response)).error.code).toBe('rate_limited')
  })
})

// ============================================================
// Keys
// ============================================================

describe('api keys', () => {
  test('create shows the secret once, list hides it', async () => {
    const { app, secret } = harness()
    const created = await call(app, '/v1/keys', {
      method: 'POST',
      token: secret,
      body: { scopes: ['sandboxes:read'] },
    })
    expect(created.status).toBe(201)
    const key = await readBody<KeyBody>(created)
    expect(key.api_key.startsWith('rox_sk_live_')).toBe(true)
    expect(key.prefix).toBe('rox_sk_live_')
    expect(key.last4).toBe(key.api_key.slice(-4))
    expect(key.scopes).toEqual(['sandboxes:read'])
    expect(key.created_at).toBe('2026-11-19T12:00:00.000Z')

    const listed = await call(app, '/v1/keys', { token: secret })
    expect(listed.status).toBe(200)
    const list = await readBody<ListBody<KeyMetadata>>(listed)
    const row = list.data.find((entry) => entry.id === key.id)
    expect(row).toBeDefined()
    expect(row?.prefix).toBe('rox_sk_live_')
    expect(row?.last4).toBe(key.last4)
    expect(row?.last_used_at).toBeNull()
    expect(JSON.stringify(list)).not.toContain(key.api_key)

    const usable = await call(app, '/v1/sandboxes', { token: key.api_key })
    expect(usable.status).toBe(200)
  })

  test('a key cannot mint scopes it does not hold', async () => {
    const { app, secret } = harness({ scopes: ['keys:write'] })
    const response = await call(app, '/v1/keys', {
      method: 'POST',
      token: secret,
      body: { scopes: ['billing:read'] },
    })
    expect(response.status).toBe(403)
    expect((await readBody<ErrorBody>(response)).error.code).toBe('permission_denied')
  })

  test('deleting a key revokes it', async () => {
    const { app, secret } = harness()
    const created = await readBody<KeyBody>(
      await call(app, '/v1/keys', { method: 'POST', token: secret, body: { scopes: ['sandboxes:read'] } }),
    )
    const deleted = await call(app, `/v1/keys/${created.id}`, { method: 'DELETE', token: secret })
    expect(deleted.status).toBe(204)
    const revoked = await call(app, '/v1/sandboxes', { token: created.api_key })
    expect(revoked.status).toBe(401)
  })
})

// ============================================================
// Catalog
// ============================================================

describe('catalog', () => {
  test('lists the eight priced products and declared provider capabilities', async () => {
    const { app, secret } = harness()
    const response = await call(app, '/v1/catalog', { token: secret })
    expect(response.status).toBe(200)
    const body = await readBody<{
      products: {
        id: string
        cents_per_hour: number
        service_fee_cents_per_hour: number
        available: boolean
        note: string | null
      }[]
      providers: CatalogProvider[]
      managed_providers: string[]
    }>(response)
    expect(body.products.map((product) => product.id)).toEqual([
      'linux-start',
      'linux-pro',
      'linux-large',
      'windows-start',
      'windows-pro',
      'windows-large',
      'windows-xl',
      'gpu-h100',
    ])
    expect(body.products.map((product) => product.cents_per_hour)).toEqual([
      20, 36, 60, 34, 56, 92, 174, 786,
    ])
    expect(body.products.map((product) => product.service_fee_cents_per_hour)).toEqual([
      5, 5, 9, 5, 8, 14, 26, 118,
    ])
    expect(body.products.filter((product) => product.available).map((product) => product.id)).toEqual([
      'linux-start',
      'linux-pro',
      'linux-large',
    ])
    expect(body.products.map((product) => product.note)).toEqual([
      null,
      null,
      null,
      'Класс Windows недоступен в этом аккаунте Daytona',
      'Класс Windows недоступен в этом аккаунте Daytona',
      'Класс Windows недоступен в этом аккаунте Daytona',
      'Класс Windows недоступен в этом аккаунте Daytona',
      'Нужны GPU-кредиты Daytona',
    ])
    expect(body.managed_providers).toEqual([])
    expect(body.providers).toHaveLength(1)
    expect(body.providers[0]).toMatchObject({
      id: 'daytona',
      os: ['linux', 'windows'],
      gpu: true,
      pause: true,
      snapshot: true,
      volume: true,
      streaming: 'none',
      max_ttl_sec: 86_400,
      regions: ['eu-central'],
    })
  })
})

// ============================================================
// Sandboxes
// ============================================================

describe('sandbox creation', () => {
  test('create without an idempotency key is 400', async () => {
    const { app, secret, provider } = harness()
    const response = await call(app, '/v1/sandboxes', { method: 'POST', token: secret, body: SPEC_BODY })
    expect(response.status).toBe(400)
    expect((await readBody<ErrorBody>(response)).error.code).toBe('idempotency_key_required')
    expect(provider.created).toHaveLength(0)
  })

  test('create with a fake provider is 201 and reports honest money', async () => {
    const { app, secret, provider } = harness()
    const response = await createSandbox(app, secret, 'create-1', { ...SPEC_BODY, ttlSec: 600 })
    expect(response.status).toBe(201)
    const body = await readBody<SandboxBody>(response)
    expect(body.id).toMatch(/^sbx_[0-9a-f]{24}$/)
    expect(body.object).toBe('sandbox')
    expect(body.provider).toBe('daytona')
    expect(body.state).toBe('running')
    expect(body.created_at).toBe('2026-11-19T12:00:00.000Z')
    expect(body.expires_at).toBe(new Date(NOW + 600_000).toISOString())
    expect(body.cost_so_far_usd).toBe('0.05')
    expect(body.cost_so_far_cents).toBe(5)
    expect(body.cost_so_far_usd).toMatch(/^\d+\.\d{2}$/)
    expect(body.routing_reason).toContain('daytona')
    expect(provider.created).toHaveLength(1)
    expect(provider.created[0]).toMatchObject({ os: 'linux', cpu: 2, memoryGb: 4, ttlSec: 600 })
  })

  test('the same idempotency key returns the same sandbox with 200', async () => {
    const { app, secret, provider } = harness()
    const first = await createSandbox(app, secret, 'same-key')
    const second = await createSandbox(app, secret, 'same-key')
    expect(first.status).toBe(201)
    expect(second.status).toBe(200)
    const firstBody = await readBody<SandboxBody>(first)
    const secondBody = await readBody<SandboxBody>(second)
    expect(secondBody.id).toBe(firstBody.id)
    expect(provider.created).toHaveLength(1)

    const list = await readBody<ListBody<SandboxBody>>(await call(app, '/v1/sandboxes', { token: secret }))
    expect(list.data).toHaveLength(1)
  })

  test('the same key with another body is 409', async () => {
    const { app, secret, provider } = harness()
    await createSandbox(app, secret, 'reused')
    const conflict = await createSandbox(app, secret, 'reused', { os: 'linux', cpu: 4, memoryGb: 8 })
    expect(conflict.status).toBe(409)
    expect((await readBody<ErrorBody>(conflict)).error.code).toBe('conflict')
    expect(provider.created).toHaveLength(1)
  })

  test('unknown provider is 400 with the allowed list', async () => {
    const { app, secret } = harness()
    const response = await createSandbox(app, secret, 'unknown-provider', { ...SPEC_BODY, provider: 'e2b' })
    expect(response.status).toBe(400)
    const body = await readBody<ErrorBody>(response)
    expect(body.error.code).toBe('provider_unknown')
    expect(body.error.message).toContain('daytona')
  })

  test('an undeclared capability is 400 capability_unavailable', async () => {
    const { app, secret, provider } = harness({ capabilities: [{ ...CAPABILITIES, gpu: false }] })
    const blocked = await createSandbox(app, secret, 'gpu-ask', {
      ...SPEC_BODY,
      gpu: { type: 'a10', count: 1 },
    })
    expect(blocked.status).toBe(400)
    expect((await readBody<ErrorBody>(blocked)).error.code).toBe('capability_unavailable')
    expect(provider.created).toHaveLength(0)
  })

  test('a ttl above the declared ceiling is rejected, 0 means unbounded', async () => {
    const { app, secret } = harness()
    const response = await createSandbox(app, secret, 'too-long', { ...SPEC_BODY, ttlSec: 999_999 })
    expect(response.status).toBe(400)
    expect((await readBody<ErrorBody>(response)).error.code).toBe('invalid_request')

    const unbounded = harness({ capabilities: [{ ...CAPABILITIES, maxTtlSec: 0 }] })
    const allowed = await createSandbox(unbounded.app, unbounded.secret, 'long-but-fine', {
      ...SPEC_BODY,
      ttlSec: 999_999,
    })
    expect(allowed.status).toBe(201)
  })

  test('two tenants resolve different providers for the same provider id', async () => {
    const store = createMemoryStore()
    const alpha = seedTenant(store, ['sandboxes:read', 'sandboxes:write'])
    const beta = seedTenant(store, ['sandboxes:read', 'sandboxes:write'])
    const providerAlpha = new FakeProvider('daytona')
    const providerBeta = new FakeProvider('daytona')
    const app = createApp({
      store,
      resolveProvider: (tenantId, providerId) => {
        if (providerId !== 'daytona') return null
        if (tenantId === alpha.tenant.id) return providerAlpha
        if (tenantId === beta.tenant.id) return providerBeta
        return null
      },
      listCapabilities: () => [CAPABILITIES],
      defaultProvider: 'daytona',
      now: () => NOW,
    })

    const first = await createSandbox(app, alpha.secret, 'shared-key')
    const second = await createSandbox(app, beta.secret, 'shared-key')
    expect(first.status).toBe(201)
    expect(second.status).toBe(201)
    const firstBody = await readBody<SandboxBody>(first)
    const secondBody = await readBody<SandboxBody>(second)
    expect(firstBody.id).not.toBe(secondBody.id)
    expect(providerAlpha.created).toHaveLength(1)
    expect(providerBeta.created).toHaveLength(1)

    const alphaList = await readBody<ListBody<SandboxBody>>(await call(app, '/v1/sandboxes', { token: alpha.secret }))
    expect(alphaList.data.map((entry) => entry.id)).toEqual([firstBody.id])
  })

  test('a tenant without a credential for the provider is 400', async () => {
    const store = createMemoryStore()
    const credentialled = seedTenant(store, ['sandboxes:write'])
    const bare = seedTenant(store, ['sandboxes:write'])
    const provider = new FakeProvider('daytona')
    const app = createApp({
      store,
      resolveProvider: (tenantId, providerId) =>
        providerId === 'daytona' && tenantId === credentialled.tenant.id ? provider : null,
      listCapabilities: () => [CAPABILITIES],
      defaultProvider: 'daytona',
      now: () => NOW,
    })

    const ok = await createSandbox(app, credentialled.secret, 'has-credential')
    expect(ok.status).toBe(201)

    const denied = await createSandbox(app, bare.secret, 'no-credential')
    expect(denied.status).toBe(400)
    const body = await readBody<ErrorBody>(denied)
    expect(body.error.code).toBe('capability_unavailable')
    expect(body.error.message).toContain('daytona')
    expect(provider.created).toHaveLength(1)
  })
})

// ============================================================
// Listing and lifecycle
// ============================================================

describe('sandbox listing', () => {
  test('paginates with limit and starting_after', async () => {
    const { app, secret } = harness()
    const ids: string[] = []
    for (const key of ['a', 'b', 'c']) {
      ids.push((await readBody<SandboxBody>(await createSandbox(app, secret, key))).id)
    }

    const firstPage = await readBody<ListBody<SandboxBody>>(
      await call(app, '/v1/sandboxes?limit=2', { token: secret }),
    )
    expect(firstPage.object).toBe('list')
    expect(firstPage.data.map((entry) => entry.id)).toEqual([ids[0], ids[1]])
    expect(firstPage.has_more).toBe(true)
    expect(firstPage.next_cursor).toBe(ids[1])

    const secondPage = await readBody<ListBody<SandboxBody>>(
      await call(app, `/v1/sandboxes?limit=2&starting_after=${firstPage.next_cursor}`, { token: secret }),
    )
    expect(secondPage.data.map((entry) => entry.id)).toEqual([ids[2]])
    expect(secondPage.has_more).toBe(false)
    expect(secondPage.next_cursor).toBeNull()
  })

  test('rejects a bad limit and an unknown cursor', async () => {
    const { app, secret } = harness()
    const badLimit = await call(app, '/v1/sandboxes?limit=0', { token: secret })
    expect(badLimit.status).toBe(400)
    const badCursor = await call(app, '/v1/sandboxes?starting_after=sbx_missing', { token: secret })
    expect(badCursor.status).toBe(400)
  })
})

describe('sandbox operations', () => {
  test('exec returns stdout, stderr and exit code', async () => {
    const { app, secret } = harness()
    const created = await readBody<SandboxBody>(await createSandbox(app, secret, 'exec-1'))
    const response = await call(app, `/v1/sandboxes/${created.id}/exec`, {
      method: 'POST',
      token: secret,
      body: { command: 'uname -a', timeoutSec: 30 },
    })
    expect(response.status).toBe(200)
    expect(await readBody<{ stdout: string; stderr: string; exit_code: number }>(response)).toEqual({
      stdout: 'ok: uname -a',
      stderr: '',
      exit_code: 0,
    })
  })

  test('exec carries cwd and timeout_sec and answers exit_code', async () => {
    const { app, secret, provider } = harness()
    const created = await readBody<SandboxBody>(await createSandbox(app, secret, 'exec-cwd'))
    const response = await call(app, `/v1/sandboxes/${created.id}/exec`, {
      method: 'POST',
      token: secret,
      body: { command: 'pwd', cwd: '/root', timeout_sec: 12 },
    })
    expect(response.status).toBe(200)
    expect(await readBody<{ stdout: string; stderr: string; exit_code: number }>(response)).toEqual({
      stdout: 'ok: pwd',
      stderr: '',
      exit_code: 0,
    })
    expect(provider.lastExec).toEqual({ command: 'pwd', cwd: '/root', timeoutMs: 12_000 })
  })

  test('exec without a command is 400', async () => {
    const { app, secret } = harness()
    const created = await readBody<SandboxBody>(await createSandbox(app, secret, 'exec-empty'))
    const response = await call(app, `/v1/sandboxes/${created.id}/exec`, {
      method: 'POST',
      token: secret,
      body: {},
    })
    expect(response.status).toBe(400)
    expect((await readBody<ErrorBody>(response)).error.code).toBe('invalid_request')
  })

  test('files round-trip as raw bytes', async () => {
    const { app, secret } = harness()
    const created = await readBody<SandboxBody>(await createSandbox(app, secret, 'files-1'))
    const payload = new TextEncoder().encode('привет, мир\n')

    const written = await call(app, `/v1/sandboxes/${created.id}/files?path=%2Ftmp%2Fnote.txt`, {
      method: 'PUT',
      token: secret,
      raw: payload,
    })
    expect(written.status).toBe(204)

    const read = await call(app, `/v1/sandboxes/${created.id}/files?path=%2Ftmp%2Fnote.txt`, { token: secret })
    expect(read.status).toBe(200)
    expect(read.headers.get('content-type')).toBe('application/octet-stream')
    const bytes = new Uint8Array(await read.arrayBuffer())
    expect(new TextDecoder().decode(bytes)).toBe('привет, мир\n')
  })

  test('files without a path is 400', async () => {
    const { app, secret } = harness()
    const created = await readBody<SandboxBody>(await createSandbox(app, secret, 'files-2'))
    const response = await call(app, `/v1/sandboxes/${created.id}/files`, { token: secret })
    expect(response.status).toBe(400)
  })

  test('stop moves the sandbox to stopped', async () => {
    const { app, secret, provider } = harness()
    const created = await readBody<SandboxBody>(await createSandbox(app, secret, 'stop-1'))
    const response = await call(app, `/v1/sandboxes/${created.id}/stop`, { method: 'POST', token: secret })
    expect(response.status).toBe(200)
    expect((await readBody<SandboxBody>(response)).state).toBe('stopped')
    expect(provider.sandboxes.get(created.id)?.state).toBe('stopped')
  })

  test('delete removes the sandbox and get then answers 404', async () => {
    const { app, secret, provider } = harness()
    const created = await readBody<SandboxBody>(await createSandbox(app, secret, 'delete-1'))
    const deleted = await call(app, `/v1/sandboxes/${created.id}`, { method: 'DELETE', token: secret })
    expect(deleted.status).toBe(204)
    expect(provider.sandboxes.has(created.id)).toBe(false)

    const gone = await call(app, `/v1/sandboxes/${created.id}`, { token: secret })
    expect(gone.status).toBe(404)
    const body = await readBody<ErrorBody>(gone)
    expect(body.error.code).toBe('not_found')
    expect(gone.headers.get('x-request-id')).toBe(body.error.request_id)
  })

  test('another tenant sees 404, not somebody else sandbox', async () => {
    const store = createMemoryStore()
    const owner = seedTenant(store, ['sandboxes:read', 'sandboxes:write'])
    const stranger = seedTenant(store, ['sandboxes:read'])
    const provider = new FakeProvider('daytona')
    const app = createApp({
      store,
      resolveProvider: (tenantId, providerId) =>
        providerId === 'daytona' && tenantId === owner.tenant.id ? provider : null,
      listCapabilities: () => [CAPABILITIES],
      defaultProvider: 'daytona',
      now: () => NOW,
    })
    const created = await readBody<SandboxBody>(await createSandbox(app, owner.secret, 'owner-1'))
    const stolen = await call(app, `/v1/sandboxes/${created.id}`, { token: stranger.secret })
    expect(stolen.status).toBe(404)
    const listed = await readBody<ListBody<SandboxBody>>(
      await call(app, '/v1/sandboxes', { token: stranger.secret }),
    )
    expect(listed.data).toHaveLength(0)
  })
})

// ============================================================
// Usage
// ============================================================

describe('money', () => {
  test('there is no customer top-up route at all', async () => {
    // Even a key that once carried `billing:write` finds nothing to call:
    // money is added by staff under `/v1/admin/tenants/{id}/credit`.
    const { app, secret } = harness({ scopes: [...ALL_SCOPES] })
    const response = await call(app, '/v1/account/topup', {
      method: 'POST',
      token: secret,
      body: { amountCents: 100 },
    })
    expect(response.status).toBe(404)
    expect((await readBody<ErrorBody>(response)).error.code).toBe('not_found')
  })
})

describe('usage', () => {
  test('usage lists money in integer cents per sandbox', async () => {
    const { app, secret } = harness()
    const created = await readBody<SandboxBody>(await createSandbox(app, secret, 'usage-1'))
    const response = await call(app, '/v1/usage', { token: secret })
    expect(response.status).toBe(200)
    const body = await readBody<
      ListBody<{
        ref: string
        product: string
        label: string | null
        cents: number
        currency: string
        created_at: string
        billing_mode: string
      }>
    >(response)
    expect(body.object).toBe('list')
    expect(body.data).toMatchObject([
      { ref: created.id, product: 'sandbox', cents: 5, currency: 'USD', billing_mode: 'byok' },
    ])
    expect(typeof body.data[0]!.created_at).toBe('string')
    expect(Number.isNaN(Date.parse(body.data[0]!.created_at))).toBe(false)
  })

  test('usage as CSV carries the invoice header', async () => {
    const { app, secret } = harness()
    await createSandbox(app, secret, 'usage-csv')
    const response = await call(app, '/v1/usage?format=csv', { token: secret })
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/csv')
    const text = await response.text()
    expect(text.split('\n')[0]).toContain('rate_cents_per_hour')
    expect(text).toContain('usage')
  })

  test('usage needs billing:read', async () => {
    const { app, secret } = harness({ scopes: ['sandboxes:read'] })
    const response = await call(app, '/v1/usage', { token: secret })
    expect(response.status).toBe(403)
  })
})
