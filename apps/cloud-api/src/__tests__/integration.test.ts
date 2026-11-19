/**
 * Wiring tests for the Rox Cloud control plane.
 *
 * Everything below runs against in-memory stores and a fake Daytona endpoint:
 * no real credential is touched, no network is reached. The tests drive the
 * public API through `Request`/`Response` wherever the contract is HTTP, and
 * call the runtime directly where the question is about resolution.
 */

import { describe, expect, test } from 'bun:test'

import { addCredential, createMemoryKeyStore, disableCredential } from '../../../../packages/cloud-keys/src/index.ts'
import type { KeyStore } from '../../../../packages/cloud-keys/src/index.ts'
import { createAuditLog, createKillSwitch } from '../../../../packages/cloud-ops/src/index.ts'
import type { AuditLog, KillSwitch } from '../../../../packages/cloud-ops/src/index.ts'
import { createMemoryMoneyStore } from '../../../../packages/cloud-runner/src/entitlement.ts'
import type { MemoryMoneyStore } from '../../../../packages/cloud-runner/src/entitlement.ts'
import type { AccountLimits } from '../../../../packages/cloud-runner/src/limits.ts'
import { createApp } from '../app.ts'
import type { CloudApp } from '../app.ts'
import { generateApiKey, verifyApiKey } from '../auth.ts'
import { createRuntime, ensureBootstrapKey } from '../integration.ts'
import type { ControlPlane } from '../integration.ts'
import { SCOPES, createMemoryStore, nextId } from '../store.ts'
import type { MemoryStore, Scope, Tenant } from '../store.ts'

// ============================================================
// Fixtures
// ============================================================

const NOW = Date.UTC(2026, 10, 19, 12, 0, 0)
const MASTER_KEY = new Uint8Array(32).fill(9)
const RATE_CENTS_PER_HOUR = 25
const DAYTONA_URL = 'https://daytona.test/api'
const TOOLBOX_URL = 'https://toolbox.daytona.test'

const ALL_SCOPES: readonly Scope[] = [
  'sandboxes:read',
  'sandboxes:write',
  'keys:write',
  'billing:read',
]

interface DaytonaCall {
  readonly url: string
  readonly method: string
  readonly authorization: string | null
  readonly body: unknown
}

interface FakeDaytona {
  readonly calls: DaytonaCall[]
  readonly fetch: typeof fetch
}

/** Just enough Daytona to see which URL, method and bearer a call carried. */
function createFakeDaytona(): FakeDaytona {
  const calls: DaytonaCall[] = []
  let minted = 0
  const handler = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    const method = (init?.method ?? 'GET').toUpperCase()
    const headers = new Headers(init?.headers)
    const rawBody = init?.body
    calls.push({
      url,
      method,
      authorization: headers.get('authorization'),
      body: typeof rawBody === 'string' ? JSON.parse(rawBody) : undefined,
    })
    if (method === 'POST' && url === `${DAYTONA_URL}/sandbox`) {
      minted += 1
      return new Response(JSON.stringify({ id: `dt_${minted}`, state: 'creating' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    if (method === 'DELETE') return new Response(null, { status: 204 })
    return new Response(JSON.stringify({ id: 'dt', state: 'stopped' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }
  // `typeof fetch` also carries Bun's `preconnect`; a plain function cannot
  // grow that member, so the transport is cast at this single seam.
  return { calls, fetch: handler as typeof fetch }
}

interface HarnessOptions {
  /** `null` leaves the tenant without a wallet at all. */
  readonly account?:
    | {
        readonly paid: boolean
        readonly balanceCents: number
        readonly monthSpentCents?: number
        readonly monthlyCapCents?: number
      }
    | null
  readonly limits?: AccountLimits
}

interface Harness {
  readonly store: MemoryStore
  readonly tenant: Tenant
  readonly secret: string
  readonly keyStore: KeyStore
  readonly moneyStore: MemoryMoneyStore
  readonly audit: AuditLog
  readonly killSwitch: KillSwitch
  readonly runtime: ControlPlane
  readonly app: CloudApp
  readonly daytona: FakeDaytona
  advance(ms: number): void
}

function harness(options: HarnessOptions = {}): Harness {
  const clock = { value: NOW }
  const now = (): number => clock.value

  const store = createMemoryStore()
  const tenant = store.addTenant('Тестовая команда')
  const generated = generateApiKey()
  store.addApiKey({
    id: nextId('key_'),
    tenantId: tenant.id,
    prefix: generated.prefix,
    last4: generated.last4,
    hash: generated.hash,
    scopes: ALL_SCOPES,
    createdAt: NOW,
  })

  const keyStore = createMemoryKeyStore({ now: () => new Date(now()) })
  const moneyStore = createMemoryMoneyStore()
  const seed: {
    paid: boolean
    balanceCents: number
    monthSpentCents?: number
    monthlyCapCents?: number
  } | null = options.account === undefined ? { paid: true, balanceCents: 500 } : options.account
  if (seed !== null) {
    moneyStore.saveAccount({
      id: tenant.id,
      paid: seed.paid,
      balanceCents: seed.balanceCents,
      reservedCents: 0,
      monthlyCapCents: seed.monthlyCapCents ?? 0,
      monthSpentCents: seed.monthSpentCents ?? 0,
    })
  }

  const audit = createAuditLog({ now: () => new Date(now()) })
  const killSwitch = createKillSwitch({ now: () => new Date(now()) })
  const daytona = createFakeDaytona()

  const runtime = createRuntime({
    store,
    keyStore,
    moneyStore,
    audit,
    killSwitch,
    masterKey: MASTER_KEY,
    rateCentsPerHour: RATE_CENTS_PER_HOUR,
    now,
    fetch: daytona.fetch,
    daytonaApiUrl: DAYTONA_URL,
    daytonaToolboxUrl: TOOLBOX_URL,
    limits: options.limits,
  })

  const app = createApp({
    store,
    resolveProvider: runtime.resolveProvider,
    listCapabilities: runtime.listCapabilities,
    defaultProvider: 'daytona',
    beforeCreate: runtime.beforeCreate,
    afterStop: runtime.afterStop,
    afterDestroy: runtime.afterDestroy,
    keyStore,
    masterKey: MASTER_KEY,
    moneyStore,
    rateCentsPerHour: RATE_CENTS_PER_HOUR,
    now,
  })

  return {
    store,
    tenant,
    secret: generated.secret,
    keyStore,
    moneyStore,
    audit,
    killSwitch,
    runtime,
    app,
    daytona,
    advance(ms) {
      clock.value += ms
    },
  }
}

const DAYTONA_SECRET = 'dt_secret_value_123'

function addDaytonaCredential(h: Harness, secret = DAYTONA_SECRET): string {
  const credential = addCredential(h.keyStore, MASTER_KEY, {
    tenantId: h.tenant.id,
    provider: 'daytona',
    label: 'main',
    secret,
    spendCapCents: 10_000,
  })
  return credential.id
}

interface CallOptions {
  readonly secret?: string
  readonly body?: unknown
  readonly idempotencyKey?: string
}

function call(app: CloudApp, method: string, path: string, options: CallOptions = {}): Promise<Response> {
  const headers: Record<string, string> = {}
  if (options.secret !== undefined) headers.authorization = `Bearer ${options.secret}`
  if (options.idempotencyKey !== undefined) headers['idempotency-key'] = options.idempotencyKey
  let body: string | undefined
  if (options.body !== undefined) {
    headers['content-type'] = 'application/json'
    body = JSON.stringify(options.body)
  }
  return app.handle(new Request(`https://api.test${path}`, { method, headers, body }))
}

let idempotencyCounter = 0

function createSandbox(
  h: Harness,
  body: Record<string, unknown> = {},
): Promise<Response> {
  idempotencyCounter += 1
  return call(h.app, 'POST', '/v1/sandboxes', {
    secret: h.secret,
    idempotencyKey: `idem-${idempotencyCounter}`,
    body: { os: 'linux', cpu: 1, memoryGb: 1, ttlSec: 3600, ...body },
  })
}

async function errorCode(response: Response): Promise<string> {
  const body = (await response.json()) as { error?: { code?: string } }
  return body.error?.code ?? ''
}

// ============================================================
// Provider resolution
// ============================================================

describe('provider resolution', () => {
  test('a tenant with no credential resolves to null', async () => {
    const h = harness()
    expect(await h.runtime.resolveProvider(h.tenant.id, 'daytona')).toBeNull()
  })

  test('a stored credential resolves to a provider that calls Daytona with the decrypted key', async () => {
    const h = harness()
    addDaytonaCredential(h)

    const provider = await h.runtime.resolveProvider(h.tenant.id, 'daytona')
    expect(provider).not.toBeNull()
    await provider!.create({ id: 'sbx_direct', os: 'linux', cpu: 1, memoryGb: 1 })

    const create = h.daytona.calls.find((entry) => entry.method === 'POST')
    expect(create?.url).toBe(`${DAYTONA_URL}/sandbox`)
    expect(create?.authorization).toBe(`Bearer ${DAYTONA_SECRET}`)
  })

  test('a disabled credential stops resolving, even after it was used', async () => {
    const h = harness()
    const credentialId = addDaytonaCredential(h)

    expect(await h.runtime.resolveProvider(h.tenant.id, 'daytona')).not.toBeNull()
    disableCredential(h.keyStore, h.tenant.id, credentialId)

    expect(await h.runtime.resolveProvider(h.tenant.id, 'daytona')).toBeNull()
  })

  test('only the provider with an adapter is advertised', () => {
    const h = harness()
    const ids = h.runtime.listCapabilities().map((entry) => entry.id)
    expect(ids).toEqual(['daytona'])
  })
})

// ============================================================
// Gates
// ============================================================

describe('pre-create gate', () => {
  test('an approved kill switch blocks a boot with 409', async () => {
    const h = harness()
    addDaytonaCredential(h)
    const block = h.killSwitch.request(
      { scope: { provider: 'daytona', product: 'sandbox' }, enabled: true, reason: 'инцидент' },
      'staff-1',
    )
    h.killSwitch.approve(block.id, 'staff-2')

    const response = await createSandbox(h)
    expect(response.status).toBe(409)
    expect(await errorCode(response)).toBe('kill_switch_active')
    // Nothing reached the provider and nothing was held.
    expect(h.daytona.calls.length).toBe(0)
    expect(h.moneyStore.listReservations(h.tenant.id).length).toBe(0)
  })

  test('an empty wallet refuses the boot with 402', async () => {
    const h = harness({ account: { paid: true, balanceCents: 0 } })
    addDaytonaCredential(h)

    const response = await createSandbox(h)
    expect(response.status).toBe(402)
    expect(await errorCode(response)).toBe('insufficient_balance')
    expect(h.daytona.calls.length).toBe(0)
  })

  test('the account concurrency limit refuses a second machine with 409', async () => {
    const h = harness({ limits: { maxConcurrentSandboxes: 1, maxCpuPerSandbox: 0, maxMonthlyCents: 0 } })
    addDaytonaCredential(h)

    const first = await createSandbox(h)
    expect(first.status).toBe(201)
    const second = await createSandbox(h)
    expect(second.status).toBe(409)
    expect(await errorCode(second)).toBe('concurrency_exceeded')
  })
})

// ============================================================
// Money
// ============================================================

describe('platform fee', () => {
  test('a successful create reserves one hour of fee', async () => {
    const h = harness()
    addDaytonaCredential(h)

    const response = await createSandbox(h)
    expect(response.status).toBe(201)
    const sandbox = (await response.json()) as { id: string }

    expect(h.moneyStore.findReservation(h.tenant.id, sandbox.id)).toBe(RATE_CENTS_PER_HOUR)
    expect(h.moneyStore.getAccount(h.tenant.id)?.balanceCents).toBe(500 - RATE_CENTS_PER_HOUR)
  })

  test('stop settles the elapsed time and the ledger keeps the pair', async () => {
    const h = harness()
    addDaytonaCredential(h)
    const created = await createSandbox(h)
    const sandbox = (await created.json()) as { id: string }

    // Half an hour at 25 cents per hour: 13 cents, rounded up.
    h.advance(30 * 60 * 1000)
    const stopped = await call(h.app, 'POST', `/v1/sandboxes/${sandbox.id}/stop`, { secret: h.secret })
    expect(stopped.status).toBe(200)

    expect(h.moneyStore.findReservation(h.tenant.id, sandbox.id)).toBeUndefined()
    const rows = h.moneyStore.listLedger(h.tenant.id).filter((row) => row.ref === sandbox.id)
    const released = rows.filter((row) => row.kind === 'release')
    const settled = rows.filter((row) => row.kind === 'settle')
    // Each move is a double-entry pair: the customer row and its opposite.
    expect(released.length).toBe(2)
    expect(settled.length).toBe(2)
    expect(released.some((row) => row.counterparty === 'customer')).toBe(true)
    expect(released.some((row) => row.counterparty === 'reserve')).toBe(true)
    const charged = settled.find((row) => row.counterparty === 'customer')
    expect(charged?.amountCents).toBe(-13)
    expect(h.moneyStore.getAccount(h.tenant.id)?.balanceCents).toBe(500 - 13)

    expect(h.audit.list({ action: 'sandbox.create' }).length).toBe(1)
    expect(h.audit.list({ action: 'sandbox.stop' }).length).toBe(1)
  })

  test('destroy releases a hold that was never settled', async () => {
    const h = harness()
    addDaytonaCredential(h)
    const created = await createSandbox(h)
    const sandbox = (await created.json()) as { id: string }

    const deleted = await call(h.app, 'DELETE', `/v1/sandboxes/${sandbox.id}`, { secret: h.secret })
    expect(deleted.status).toBe(204)

    expect(h.moneyStore.findReservation(h.tenant.id, sandbox.id)).toBeUndefined()
    const rows = h.moneyStore.listLedger(h.tenant.id).filter((row) => row.ref === sandbox.id)
    expect(rows.filter((row) => row.kind === 'release').length).toBe(2)
    expect(rows.filter((row) => row.kind === 'settle').length).toBe(0)
    expect(h.moneyStore.getAccount(h.tenant.id)?.balanceCents).toBe(500)
    expect(h.audit.list({ action: 'sandbox.delete' }).length).toBe(1)
  })

  test('a second stop never charges twice', async () => {
    const h = harness()
    addDaytonaCredential(h)
    const created = await createSandbox(h)
    const sandbox = (await created.json()) as { id: string }

    h.advance(60 * 60 * 1000)
    await call(h.app, 'POST', `/v1/sandboxes/${sandbox.id}/stop`, { secret: h.secret })
    const afterFirst = h.moneyStore.getAccount(h.tenant.id)?.balanceCents
    await call(h.app, 'POST', `/v1/sandboxes/${sandbox.id}/stop`, { secret: h.secret })

    expect(h.moneyStore.getAccount(h.tenant.id)?.balanceCents).toBe(afterFirst)
  })
})

// ============================================================
// Provider credentials
// ============================================================

describe('provider credentials', () => {
  test('the API stores a key and every response hides the secret material', async () => {
    const h = harness()

    const created = await call(h.app, 'POST', '/v1/provider-credentials', {
      secret: h.secret,
      body: { provider: 'daytona', label: 'main', secret: DAYTONA_SECRET, spendCapCents: 5000 },
    })
    expect(created.status).toBe(201)
    const createdText = await created.text()
    expect(createdText).not.toContain(DAYTONA_SECRET)
    expect(createdText).not.toContain('ciphertext')
    const createdBody = JSON.parse(createdText) as { id: string; last4: string; status: string }
    expect(createdBody.status).toBe('active')
    expect(createdBody.last4).toBe('_123')

    const listed = await call(h.app, 'GET', '/v1/provider-credentials', { secret: h.secret })
    expect(listed.status).toBe(200)
    const listedText = await listed.text()
    expect(listedText).not.toContain(DAYTONA_SECRET)
    expect(listedText).not.toContain('ciphertext')
    expect(listedText).not.toContain('"iv"')
    expect(listedText).not.toContain('"tag"')
    const listedBody = JSON.parse(listedText) as { data: Array<{ id: string }> }
    expect(listedBody.data.length).toBe(1)
    expect(listedBody.data[0]?.id).toBe(createdBody.id)

    const disabled = await call(h.app, 'DELETE', `/v1/provider-credentials/${createdBody.id}`, {
      secret: h.secret,
    })
    expect(disabled.status).toBe(200)
    expect((await disabled.json()) as { status: string }).toMatchObject({ status: 'disabled' })
    expect(await h.runtime.resolveProvider(h.tenant.id, 'daytona')).toBeNull()
  })

  test('a secret shorter than the vault minimum is rejected with 400', async () => {
    const h = harness()
    const response = await call(h.app, 'POST', '/v1/provider-credentials', {
      secret: h.secret,
      body: { provider: 'daytona', label: 'main', secret: 'short', spendCapCents: 100 },
    })
    expect(response.status).toBe(400)
  })
})

// ============================================================
// Account
// ============================================================

describe('account', () => {
  test('a fresh tenant reads as zero balance and cannot boot a machine', async () => {
    const h = harness({ account: null })
    addDaytonaCredential(h)

    const account = await call(h.app, 'GET', '/v1/account', { secret: h.secret })
    expect(account.status).toBe(200)
    const body = (await account.json()) as {
      balance_cents: number
      balance_usd: string
      rate_cents_per_hour: number
      currency: string
    }
    expect(body.balance_cents).toBe(0)
    expect(body.balance_usd).toBe('0.00')
    expect(body.rate_cents_per_hour).toBe(RATE_CENTS_PER_HOUR)
    expect(body.currency).toBe('USD')

    const refused = await createSandbox(h)
    expect(refused.status).toBe(402)
    expect(await errorCode(refused)).toBe('entitlement_required')
  })

  test('a top-up makes the fee reservable again', async () => {
    const h = harness({ account: null })
    addDaytonaCredential(h)

    const topup = await call(h.app, 'POST', '/v1/account/topup', {
      secret: h.secret,
      body: { amountCents: 250 },
    })
    expect(topup.status).toBe(200)
    const afterTopUp = (await topup.json()) as { balance_cents: number; balance_usd: string }
    expect(afterTopUp.balance_cents).toBe(250)
    expect(afterTopUp.balance_usd).toBe('2.50')

    const created = await createSandbox(h)
    expect(created.status).toBe(201)
    const sandbox = (await created.json()) as { id: string }
    expect(h.moneyStore.findReservation(h.tenant.id, sandbox.id)).toBe(RATE_CENTS_PER_HOUR)
  })

  test('a top-up of a non-integer amount is rejected with 400', async () => {
    const h = harness()
    for (const amountCents of [1.5, 0, -10, '100']) {
      const response = await call(h.app, 'POST', '/v1/account/topup', {
        secret: h.secret,
        body: { amountCents },
      })
      expect(response.status).toBe(400)
    }
  })
})

// ============================================================
// Bootstrap
// ============================================================

describe('bootstrap', () => {
  const BOOTSTRAP = 'rox_sk_live_bootstrap_secret_value'

  test('the first boot creates one tenant and one working key', () => {
    const store = createMemoryStore()

    const first = ensureBootstrapKey(store, { key: BOOTSTRAP, tenantName: 'Моя команда', now: () => NOW })
    expect(first.created).toBe(true)
    expect(store.apiKeys.size).toBe(1)
    expect(store.tenants.size).toBe(1)

    const verified = verifyApiKey(store, BOOTSTRAP, NOW)
    expect(verified?.scopes).toEqual([...SCOPES])
    expect(verified?.tenant.name).toBe('Моя команда')
    // The store keeps a hash, never the secret itself.
    expect([...store.apiKeys.values()][0]?.hash).not.toContain(BOOTSTRAP)
  })

  test('a second boot adds no key', () => {
    const store = createMemoryStore()
    ensureBootstrapKey(store, { key: BOOTSTRAP, tenantName: 'Моя команда', now: () => NOW })
    const second = ensureBootstrapKey(store, { key: BOOTSTRAP, tenantName: 'Моя команда', now: () => NOW })

    expect(second.created).toBe(false)
    expect(store.apiKeys.size).toBe(1)
    expect(store.tenants.size).toBe(1)
  })

  test('a key without the API prefix is refused', () => {
    const store = createMemoryStore()
    expect(() => ensureBootstrapKey(store, { key: 'not-a-key', tenantName: 'Моя команда' })).toThrow()
    expect(store.apiKeys.size).toBe(0)
  })
})
