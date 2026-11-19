/**
 * Staff panel tests for the Rox Cloud BYOK API.
 *
 * Everything runs in memory against a fake Daytona endpoint: no real
 * credential, no network, no port. Two surfaces are driven through
 * `Request`/`Response` — the `/admin/` API and the one-origin front door that
 * also serves the pages — so the same answers the browser would get are the
 * ones asserted here.
 */

import { afterEach, describe, expect, test } from 'bun:test'

import { addCredential, createMemoryKeyStore } from '../../../../packages/cloud-keys/src/index.ts'
import type { KeyStore } from '../../../../packages/cloud-keys/src/index.ts'
import { createAuditLog, createKillSwitch } from '../../../../packages/cloud-ops/src/index.ts'
import type { AuditLog, KillSwitch } from '../../../../packages/cloud-ops/src/index.ts'
import { createMemoryMoneyStore } from '../../../../packages/cloud-runner/src/entitlement.ts'
import type { MemoryMoneyStore } from '../../../../packages/cloud-runner/src/entitlement.ts'
import type { AccountLimits } from '../../../../packages/cloud-runner/src/limits.ts'
import type { SandboxSpec } from '../../../../packages/cloud-runner/src/sandbox.ts'
import { createAdminApp } from '../admin.ts'
import type { AdminApp } from '../admin.ts'
import { createApp } from '../app.ts'
import type { CloudApp } from '../app.ts'
import { generateApiKey } from '../auth.ts'
import { createRuntime } from '../integration.ts'
import type { ControlPlane } from '../integration.ts'
import { createHandler } from '../server.ts'
import { SCOPES, createMemoryStore, nextId } from '../store.ts'
import type { MemoryStore, Tenant } from '../store.ts'

// ============================================================
// Fixtures
// ============================================================

const NOW = Date.UTC(2026, 10, 19, 12, 0, 0)
const MASTER_KEY = new Uint8Array(32).fill(9)
const RATE_CENTS_PER_HOUR = 25
const DAYTONA_URL = 'https://daytona.test/api'
const TOOLBOX_URL = 'https://toolbox.daytona.test'
const DAYTONA_SECRET = 'dt_secret_value_123'
const ADMIN_KEY = 'admin_staff_key_123'
/** The pilot ceilings the panel prints; zeros mean «не ограничено». */
const LIMITS: AccountLimits = {
  maxConcurrentSandboxes: 0,
  maxCpuPerSandbox: 0,
  maxMonthlyCents: 0,
}

interface FakeDaytona {
  readonly calls: number
  fetch: typeof fetch
}

/** Just enough Daytona to boot and stop a machine without a network. */
function createFakeDaytona(): FakeDaytona {
  const counter = { calls: 0, minted: 0 }
  const handler = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    counter.calls += 1
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    const method = (init?.method ?? 'GET').toUpperCase()
    if (method === 'POST' && url === `${DAYTONA_URL}/sandbox`) {
      counter.minted += 1
      return new Response(JSON.stringify({ id: `dt_${counter.minted}`, state: 'creating' }), {
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
  return {
    get calls() {
      return counter.calls
    },
    fetch: handler as typeof fetch,
  }
}

interface Harness {
  readonly store: MemoryStore
  readonly tenant: Tenant
  readonly other: Tenant
  readonly secret: string
  readonly keyStore: KeyStore
  readonly moneyStore: MemoryMoneyStore
  readonly audit: AuditLog
  readonly killSwitch: KillSwitch
  readonly runtime: ControlPlane
  readonly app: CloudApp
  readonly admin: AdminApp
  readonly daytona: FakeDaytona
  readonly front: (req: Request) => Promise<Response>
}

function harness(options: { readonly adminKey?: string } = {}): Harness {
  const now = (): number => NOW

  const store = createMemoryStore()
  const tenant = store.addTenant('Первая команда')
  const other = store.addTenant('Вторая команда')
  const generated = generateApiKey()
  store.addApiKey({
    id: nextId('key_'),
    tenantId: tenant.id,
    prefix: generated.prefix,
    last4: generated.last4,
    hash: generated.hash,
    scopes: SCOPES,
    createdAt: NOW,
  })

  const keyStore = createMemoryKeyStore({ now: () => new Date(now()) })
  const moneyStore = createMemoryMoneyStore()
  moneyStore.saveAccount({
    id: tenant.id,
    paid: true,
    balanceCents: 500,
    reservedCents: 0,
    monthlyCapCents: 0,
    monthSpentCents: 0,
  })
  moneyStore.saveAccount({
    id: other.id,
    paid: true,
    balanceCents: 300,
    reservedCents: 0,
    monthlyCapCents: 0,
    monthSpentCents: 0,
  })

  // Audit entries get increasing stamps, so "newest first" is testable even
  // though the rest of the harness runs at one frozen instant.
  let auditTick = 0
  const audit = createAuditLog({ now: () => new Date(NOW + auditTick++ * 1000) })
  const killSwitch = createKillSwitch({ now: () => new Date(now()) })
  addCredential(keyStore, MASTER_KEY, {
    tenantId: tenant.id,
    provider: 'daytona',
    label: 'main',
    secret: DAYTONA_SECRET,
    spendCapCents: 10_000,
  })

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

  // The same three steps the server's staff stop takes: ask the provider,
  // mark the record, settle the wallet.
  const stopResource = async (tenantId: string, sandboxId: string): Promise<void> => {
    const record = store.sandboxes.get(sandboxId)
    if (!record || record.tenantId !== tenantId) throw new Error('Машина не найдена у этого арендодателя')
    const provider = await runtime.resolveProvider(tenantId, record.providerId)
    if (!provider) throw new Error(`У арендатора больше нет ключа для провайдера «${record.providerId}»`)
    await provider.stop(record.id)
    record.state = 'stopped'
    await runtime.afterStop({
      tenantId,
      sandboxId: record.id,
      startedAt: record.startedAt ?? record.createdAt,
      stoppedAt: now(),
    })
  }

  const admin = createAdminApp({
    store,
    keyStore,
    moneyStore,
    audit,
    killSwitch,
    limits: LIMITS,
    stopResource,
    now,
    adminKey: options.adminKey,
  })

  // A machine of the second tenant, never booted through the API: it exists so
  // the filters and the counts have something that belongs to someone else.
  const otherSpec: SandboxSpec = { id: 'sbx_other', os: 'linux', cpu: 1, memoryGb: 1 }
  store.sandboxes.set('sbx_other', {
    id: 'sbx_other',
    tenantId: other.id,
    providerId: 'daytona',
    state: 'running',
    createdAt: NOW,
    costCents: 5,
    spec: otherSpec,
  })

  return {
    store,
    tenant,
    other,
    secret: generated.secret,
    keyStore,
    moneyStore,
    audit,
    killSwitch,
    runtime,
    app,
    admin,
    daytona,
    front: createHandler({ app, admin }),
  }
}

interface CallOptions {
  readonly key?: string
  readonly body?: unknown
}

function staffCall(h: Harness, method: string, path: string, options: CallOptions = {}): Promise<Response> {
  const headers: Record<string, string> = {}
  if (options.key !== undefined) headers.authorization = `Bearer ${options.key}`
  let body: string | undefined
  if (options.body !== undefined) {
    headers['content-type'] = 'application/json'
    body = JSON.stringify(options.body)
  }
  return h.admin.handle(new Request(`https://api.test${path}`, { method, headers, body }))
}

function customerCall(h: Harness, path: string, idempotencyKey: string): Promise<Response> {
  return h.app.handle(
    new Request(`https://api.test${path}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${h.secret}`,
        'content-type': 'application/json',
        'idempotency-key': idempotencyKey,
      },
      body: JSON.stringify({ os: 'linux', cpu: 1, memoryGb: 1, ttlSec: 3600 }),
    }),
  )
}

async function envelope(response: Response): Promise<{ type: string; code: string; message: string; request_id: string }> {
  const body = (await response.json()) as { error: { type: string; code: string; message: string; request_id: string } }
  return body.error
}

let idempotencyCounter = 0

async function createSandbox(h: Harness): Promise<string> {
  idempotencyCounter += 1
  const response = await customerCall(h, '/v1/sandboxes', `admin-idem-${idempotencyCounter}`)
  expect(response.status).toBe(201)
  const body = (await response.json()) as { id: string }
  return body.id
}

// ============================================================
// Access
// ============================================================

describe('staff access', () => {
  test('a request without the staff key is refused with 401', async () => {
    const h = harness({ adminKey: ADMIN_KEY })

    const anonymous = await staffCall(h, 'GET', '/admin/overview')
    expect(anonymous.status).toBe(401)
    const error = await envelope(anonymous)
    expect(error.type).toBe('authentication_error')
    expect(error.code).toBe('authentication_required')
    expect(error.request_id.startsWith('req_')).toBe(true)
    expect(anonymous.headers.get('x-request-id')).toBe(error.request_id)

    const wrong = await staffCall(h, 'GET', '/admin/overview', { key: 'not-the-key' })
    expect(wrong.status).toBe(401)
  })

  test('a deployment without ROX_ADMIN_KEY answers 404 on every route', async () => {
    const h = harness()
    for (const path of ['/admin/health', '/admin/overview', '/admin/tenants', '/admin/audit']) {
      const response = await staffCall(h, 'GET', path, { key: ADMIN_KEY })
      expect(response.status).toBe(404)
      expect((await envelope(response)).code).toBe('not_found')
    }
  })

  test('health answers when the panel is configured', async () => {
    const h = harness({ adminKey: ADMIN_KEY })
    const response = await staffCall(h, 'GET', '/admin/health', { key: ADMIN_KEY })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, runtime: true })
  })
})

// ============================================================
// Read models
// ============================================================

describe('overview and tenants', () => {
  test('overview counts tenants, active machines, keys and money', async () => {
    const h = harness({ adminKey: ADMIN_KEY })
    await createSandbox(h)

    const response = await staffCall(h, 'GET', '/admin/overview', { key: ADMIN_KEY })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      tenants: 2,
      // The booted machine plus the second tenant's running one.
      active_sandboxes: 2,
      credentials: 1,
      // 500 for the first tenant and 300 for the second, minus nothing yet.
      balance_cents_total: 800 - RATE_CENTS_PER_HOUR,
      open_kill_switches: 0,
    })
  })

  test('the tenant list carries balance, reservation and month spend', async () => {
    const h = harness({ adminKey: ADMIN_KEY })
    await createSandbox(h)

    const response = await staffCall(h, 'GET', '/admin/tenants', { key: ADMIN_KEY })
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      data: Array<{
        id: string
        name: string
        balance_cents: number
        reserved_cents: number
        month_spent_cents: number
        sandboxes: number
        credentials: number
        created_at: string
      }>
    }
    const first = body.data.find((row) => row.id === h.tenant.id)
    expect(first?.name).toBe('Первая команда')
    expect(first?.balance_cents).toBe(500 - RATE_CENTS_PER_HOUR)
    expect(first?.reserved_cents).toBe(RATE_CENTS_PER_HOUR)
    expect(first?.month_spent_cents).toBe(0)
    expect(first?.sandboxes).toBe(1)
    expect(first?.credentials).toBe(1)
    expect(first?.created_at).toBe(new Date(h.tenant.createdAt).toISOString())

    const second = body.data.find((row) => row.id === h.other.id)
    expect(second?.credentials).toBe(0)
    expect(second?.sandboxes).toBe(1)
  })

  test('resources can be narrowed to one tenant and one provider', async () => {
    const h = harness({ adminKey: ADMIN_KEY })
    await createSandbox(h)

    const mine = await staffCall(h, 'GET', `/admin/resources?tenant=${h.other.id}`, { key: ADMIN_KEY })
    expect(mine.status).toBe(200)
    const body = (await mine.json()) as {
      data: Array<{ id: string; tenant_id: string; provider: string; state: string; expires_at: string | null }>
    }
    expect(body.data.length).toBe(1)
    expect(body.data[0]?.id).toBe('sbx_other')
    expect(body.data[0]?.tenant_id).toBe(h.other.id)
    expect(body.data[0]?.provider).toBe('daytona')
    expect(body.data[0]?.state).toBe('running')
    expect(body.data[0]?.expires_at).toBeNull()

    const missing = await staffCall(h, 'GET', '/admin/resources?provider=modal', { key: ADMIN_KEY })
    const missingBody = (await missing.json()) as { data: unknown[] }
    expect(missingBody.data.length).toBe(0)

    const bad = await staffCall(h, 'GET', '/admin/resources?state=exploded', { key: ADMIN_KEY })
    expect(bad.status).toBe(400)
    expect((await envelope(bad)).code).toBe('invalid_request')
  })
})

// ============================================================
// One tenant: wallet, ceilings, machines and both trails
// ============================================================

interface DetailBody {
  tenant: { id: string; name: string; balance_cents: number; sandboxes: number; credentials: number; created_at: string }
  account: {
    paid: boolean
    balance_cents: number
    reserved_cents: number
    monthly_cap_cents: number
    month_spent_cents: number
  }
  limits: { max_concurrent_sandboxes: number; max_cpu_per_sandbox: number; max_monthly_cents: number }
  sandboxes: Array<{ id: string; tenant_id: string; state: string; cost_cents: number; created_at: string }>
  ledger: Array<{
    id: string
    kind: string
    amount_cents: number
    balance_after_cents: number
    reserved_after_cents: number
    ref: string
    at: string
    shortfall_cents?: number
  }>
  audit: Array<{
    id: string
    actor_id: string
    action: string
    target_type: string
    target_id: string
    reason: string
    at: string
  }>
}

async function detailCall(h: Harness, tenantId: string): Promise<{ response: Response; body: DetailBody }> {
  const response = await staffCall(h, 'GET', `/admin/tenants/${tenantId}`, { key: ADMIN_KEY })
  expect(response.status).toBe(200)
  return { response, body: (await response.json()) as DetailBody }
}

describe('tenant detail', () => {
  test('the detail carries the wallet, the ceilings, the machines and both trails', async () => {
    const h = harness({ adminKey: ADMIN_KEY })
    const spec: SandboxSpec = { id: 'sbx_hand_made', os: 'linux', cpu: 1, memoryGb: 1 }
    // Stamped apart by hand: "newest first" must be a property of the answer,
    // not of the harness clock, which stands still.
    h.store.sandboxes.set('sbx_old', {
      id: 'sbx_old',
      tenantId: h.tenant.id,
      providerId: 'daytona',
      state: 'stopped',
      createdAt: NOW - 60_000,
      costCents: 3,
      spec,
    })
    h.store.sandboxes.set('sbx_new', {
      id: 'sbx_new',
      tenantId: h.tenant.id,
      providerId: 'daytona',
      state: 'running',
      createdAt: NOW,
      costCents: 7,
      spec,
    })

    const ledgerRow = (id: string, accountId: string, at: number): void => {
      h.moneyStore.appendLedger({
        id,
        accountId,
        kind: 'topup',
        amountCents: 5,
        balanceAfterCents: 500,
        reservedAfterCents: 0,
        ref: 'topup',
        at,
        counterparty: 'customer',
        ...(id === 'led_newest' ? { shortfallCents: 7 } : {}),
      })
    }
    ledgerRow('led_oldest', h.tenant.id, NOW - 3_000)
    ledgerRow('led_middle', h.tenant.id, NOW - 2_000)
    ledgerRow('led_newest', h.tenant.id, NOW - 1_000)
    // Money of the neighbour must never appear on this page.
    ledgerRow('led_other', h.other.id, NOW)

    const { body } = await detailCall(h, h.tenant.id)

    expect(body.tenant.id).toBe(h.tenant.id)
    expect(body.tenant.name).toBe('Первая команда')
    expect(body.tenant.created_at).toBe(new Date(h.tenant.createdAt).toISOString())
    expect(body.tenant.sandboxes).toBe(2)
    expect(body.tenant.credentials).toBe(1)

    expect(body.account).toEqual({
      paid: true,
      balance_cents: 500,
      reserved_cents: 0,
      monthly_cap_cents: 0,
      month_spent_cents: 0,
    })
    expect(body.limits).toEqual({
      max_concurrent_sandboxes: 0,
      max_cpu_per_sandbox: 0,
      max_monthly_cents: 0,
    })

    expect(body.sandboxes.map((row) => row.id)).toEqual(['sbx_new', 'sbx_old'])
    expect(body.sandboxes.map((row) => row.tenant_id)).toEqual([h.tenant.id, h.tenant.id])
    expect(body.sandboxes[0]?.cost_cents).toBe(7)

    expect(body.ledger.map((row) => row.id)).toEqual(['led_newest', 'led_middle', 'led_oldest'])
    // The projection is exactly the contract: no counterparty, no account id.
    expect(body.ledger[0]).toEqual({
      id: 'led_newest',
      kind: 'topup',
      amount_cents: 5,
      balance_after_cents: 500,
      reserved_after_cents: 0,
      ref: 'topup',
      at: new Date(NOW - 1_000).toISOString(),
      shortfall_cents: 7,
    })
    expect(body.audit).toEqual([])
  })

  test('the detail audit keeps only writes against this tenant, newest first', async () => {
    const h = harness({ adminKey: ADMIN_KEY })
    const sandboxId = await createSandbox(h)
    await staffCall(h, 'POST', `/admin/resources/${sandboxId}/stop`, {
      key: ADMIN_KEY,
      body: { reason: 'остановка по тикету' },
    })
    await staffCall(h, 'POST', `/admin/tenants/${h.tenant.id}/credit`, {
      key: ADMIN_KEY,
      body: { amountCents: 25, reason: 'пополнение' },
    })
    await staffCall(h, 'PATCH', `/admin/tenants/${h.tenant.id}`, {
      key: ADMIN_KEY,
      body: { monthlyCapCents: 12_345, reason: 'потолок' },
    })

    const { body } = await detailCall(h, h.tenant.id)
    // The stop belongs to a machine, not to the tenant: its `target_id` is the
    // sandbox id, so the tenant page does not print it here.
    expect(body.audit.map((row) => row.action)).toEqual(['tenant.limits', 'tenant.credit'])
    expect(body.audit.every((row) => row.target_id === h.tenant.id)).toBe(true)
    expect(body.audit.every((row) => row.actor_id === 'staff')).toBe(true)
    expect(body.audit.map((row) => row.reason)).toEqual(['потолок', 'пополнение'])
    const times = body.audit.map((row) => Date.parse(row.at))
    expect(times).toEqual([...times].sort((a, b) => b - a))
  })
})

describe('tenant credit', () => {
  test('a credit raises the balance and leaves the reason in the trail', async () => {
    const h = harness({ adminKey: ADMIN_KEY })

    const response = await staffCall(h, 'POST', `/admin/tenants/${h.tenant.id}/credit`, {
      key: ADMIN_KEY,
      body: { amountCents: 25, reason: 'компенсация за простой' },
    })
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      tenant: { id: string }
      account: { paid: boolean; balance_cents: number }
      entry: { id: string; kind: string; amount_cents: number; balance_after_cents: number; ref: string; at: string }
    }
    expect(body.tenant.id).toBe(h.tenant.id)
    expect(body.account.balance_cents).toBe(525)
    expect(body.account.paid).toBe(true)
    expect(body.entry.kind).toBe('topup')
    expect(body.entry.amount_cents).toBe(25)
    expect(body.entry.balance_after_cents).toBe(525)
    expect(body.entry.ref).toBe('topup')
    expect(body.entry.at).toBe(new Date(NOW).toISOString())
    expect(h.moneyStore.getAccount(h.tenant.id)?.balanceCents).toBe(525)

    const rows = h.audit.list({ action: 'tenant.credit' })
    expect(rows.length).toBe(1)
    expect(rows[0]?.actorId).toBe('staff')
    expect(rows[0]?.targetType).toBe('tenant')
    expect(rows[0]?.targetId).toBe(h.tenant.id)
    expect(rows[0]?.reason).toBe('компенсация за простой')

    const { body: view } = await detailCall(h, h.tenant.id)
    expect(view.account.balance_cents).toBe(525)
    // Both sides of the double-entry pair, and the customer side reads first.
    expect(view.ledger.map((row) => row.amount_cents)).toEqual([25, -25])
    expect(view.ledger[0]?.id).toBe(body.entry.id)
    expect(view.audit.map((row) => row.action)).toEqual(['tenant.credit'])
  })

  test('a credit to a tenant without a wallet opens one and does not claim it is paid', async () => {
    const h = harness({ adminKey: ADMIN_KEY })
    const third = h.store.addTenant('Третья команда')
    expect(h.moneyStore.getAccount(third.id)).toBeUndefined()

    const response = await staffCall(h, 'POST', `/admin/tenants/${third.id}/credit`, {
      key: ADMIN_KEY,
      body: { amountCents: 100, reason: 'первое пополнение' },
    })
    expect(response.status).toBe(200)
    const body = (await response.json()) as { account: { paid: boolean; balance_cents: number } }
    expect(body.account.balance_cents).toBe(100)
    // Money in is not the same decision as permission to provision.
    expect(body.account.paid).toBe(false)
  })
})

describe('tenant limits', () => {
  test('a patch changes the cap and the paid flag and records what changed', async () => {
    const h = harness({ adminKey: ADMIN_KEY })

    const response = await staffCall(h, 'PATCH', `/admin/tenants/${h.tenant.id}`, {
      key: ADMIN_KEY,
      body: { monthlyCapCents: 12_345, paid: false, reason: 'клиент ушёл на предоплату' },
    })
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      tenant: { id: string }
      account: { paid: boolean; balance_cents: number; monthly_cap_cents: number; reserved_cents: number }
    }
    expect(body.tenant.id).toBe(h.tenant.id)
    expect(body.account.monthly_cap_cents).toBe(12_345)
    expect(body.account.paid).toBe(false)
    // A limit change moves no money.
    expect(body.account.balance_cents).toBe(500)
    expect(body.account.reserved_cents).toBe(0)
    expect(h.moneyStore.getAccount(h.tenant.id)).toMatchObject({
      paid: false,
      monthlyCapCents: 12_345,
      balanceCents: 500,
    })

    // A patch that names only one field leaves the other as it was.
    const second = await staffCall(h, 'PATCH', `/admin/tenants/${h.tenant.id}`, {
      key: ADMIN_KEY,
      body: { monthlyCapCents: 0, reason: 'потолок снят' },
    })
    expect(second.status).toBe(200)
    const secondBody = (await second.json()) as { account: { paid: boolean; monthly_cap_cents: number } }
    expect(secondBody.account.monthly_cap_cents).toBe(0)
    expect(secondBody.account.paid).toBe(false)

    const rows = h.audit.list({ action: 'tenant.limits' })
    expect(rows.length).toBe(2)
    expect(rows[0]?.actorId).toBe('staff')
    expect(rows[0]?.targetId).toBe(h.tenant.id)
    expect(rows[0]?.reason).toBe('клиент ушёл на предоплату')
    expect(rows[1]?.reason).toBe('потолок снят')

    const { body: view } = await detailCall(h, h.tenant.id)
    expect(view.account).toMatchObject({ paid: false, monthly_cap_cents: 0 })
    expect(view.audit.map((row) => row.action)).toEqual(['tenant.limits', 'tenant.limits'])
  })

  test('an unknown tenant answers 404 on all three routes and writes nothing', async () => {
    const h = harness({ adminKey: ADMIN_KEY })
    const missing = 'ten_missing'
    const calls: Array<{ method: string; path: string; body?: unknown }> = [
      { method: 'GET', path: `/admin/tenants/${missing}` },
      { method: 'POST', path: `/admin/tenants/${missing}/credit`, body: { amountCents: 25, reason: 'проверка' } },
      { method: 'PATCH', path: `/admin/tenants/${missing}`, body: { monthlyCapCents: 100, reason: 'проверка' } },
    ]
    for (const call of calls) {
      const response = await staffCall(h, call.method, call.path, {
        key: ADMIN_KEY,
        ...(call.body === undefined ? {} : { body: call.body }),
      })
      expect(response.status).toBe(404)
      expect((await envelope(response)).code).toBe('not_found')
    }
    expect(h.audit.list().length).toBe(0)
  })

  test('a credit with a bad amount or a bad reason changes nothing', async () => {
    const h = harness({ adminKey: ADMIN_KEY })
    const bodies: unknown[] = [
      {},
      { amountCents: 0, reason: 'ноль' },
      { amountCents: -5, reason: 'минус' },
      { amountCents: 1.5, reason: 'дробь' },
      { amountCents: 10_000_001, reason: 'слишком много' },
      { amountCents: '25', reason: 'строка вместо числа' },
      { amountCents: 25 },
      { amountCents: 25, reason: '   ' },
      { amountCents: 25, reason: 'я'.repeat(201) },
    ]
    for (const body of bodies) {
      const response = await staffCall(h, 'POST', `/admin/tenants/${h.tenant.id}/credit`, {
        key: ADMIN_KEY,
        body,
      })
      expect(response.status).toBe(400)
      expect((await envelope(response)).code).toBe('invalid_request')
    }
    expect(h.moneyStore.getAccount(h.tenant.id)?.balanceCents).toBe(500)
    expect(h.moneyStore.listLedger(h.tenant.id).length).toBe(0)
    expect(h.audit.list().length).toBe(0)
  })

  test('a patch with none of the editable fields is refused', async () => {
    const h = harness({ adminKey: ADMIN_KEY })
    const bodies: unknown[] = [
      {},
      { reason: 'только причина' },
      { monthlyCapCents: -1, reason: 'минус' },
      { monthlyCapCents: 1.5, reason: 'дробь' },
      { monthlyCapCents: '100', reason: 'строка' },
      { paid: 'yes', reason: 'строка вместо флага' },
      { monthlyCapCents: 100 },
      { paid: true },
    ]
    for (const body of bodies) {
      const response = await staffCall(h, 'PATCH', `/admin/tenants/${h.tenant.id}`, {
        key: ADMIN_KEY,
        body,
      })
      expect(response.status).toBe(400)
      expect((await envelope(response)).code).toBe('invalid_request')
    }
    expect(h.moneyStore.getAccount(h.tenant.id)).toMatchObject({ paid: true, monthlyCapCents: 0 })
    expect(h.audit.list({ action: 'tenant.limits' }).length).toBe(0)
  })
})

describe('tenant detail and secrets', () => {
  test('the detail never carries a provider secret or an audit chain link', async () => {
    const h = harness({ adminKey: ADMIN_KEY })
    await createSandbox(h)
    await staffCall(h, 'POST', `/admin/tenants/${h.tenant.id}/credit`, {
      key: ADMIN_KEY,
      body: { amountCents: 25, reason: 'проверка' },
    })
    await staffCall(h, 'PATCH', `/admin/tenants/${h.tenant.id}`, {
      key: ADMIN_KEY,
      body: { monthlyCapCents: 12_345, reason: 'проверка' },
    })

    const response = await staffCall(h, 'GET', `/admin/tenants/${h.tenant.id}`, { key: ADMIN_KEY })
    expect(response.status).toBe(200)
    const text = await response.text()
    const body = JSON.parse(text) as DetailBody
    expect(text).not.toContain(DAYTONA_SECRET)
    expect(text).not.toContain('ciphertext')
    expect(text).not.toContain('prevHash')
    expect(text).not.toContain('"hash"')
    expect(text).not.toContain('counterparty')
    // A machine's own audit row is not part of the tenant page.
    expect(body.audit.some((row) => row.action === 'sandbox.create')).toBe(false)

    const auditKeys = ['action', 'actor_id', 'at', 'id', 'reason', 'target_id', 'target_type']
    for (const row of body.audit) expect(Object.keys(row).sort()).toEqual(auditKeys)
    const ledgerKeys = [
      'amount_cents',
      'at',
      'balance_after_cents',
      'id',
      'kind',
      'ref',
      'reserved_after_cents',
    ]
    for (const row of body.ledger) {
      expect(Object.keys(row).sort()).toEqual(
        row.shortfall_cents === undefined ? ledgerKeys : [...ledgerKeys, 'shortfall_cents'],
      )
    }

    // The booted machine is listed, and the wallet explains where the money went.
    expect(body.sandboxes.length).toBe(1)
    expect(body.ledger.length).toBeGreaterThan(0)
  })
})

// ============================================================
// Staff writes
// ============================================================

describe('stopping a machine', () => {
  test('a stop without a reason changes nothing and answers 400', async () => {
    const h = harness({ adminKey: ADMIN_KEY })
    const sandboxId = await createSandbox(h)
    const before = h.audit.list({ action: 'sandbox.stop' }).length

    const refused = await staffCall(h, 'POST', `/admin/resources/${sandboxId}/stop`, {
      key: ADMIN_KEY,
      body: {},
    })
    expect(refused.status).toBe(400)
    expect((await envelope(refused)).code).toBe('invalid_request')
    expect(h.store.sandboxes.get(sandboxId)?.state).not.toBe('stopped')
    expect(h.audit.list({ action: 'sandbox.stop' }).length).toBe(before)
  })

  test('a stop with a reason stops the machine and records who and why', async () => {
    const h = harness({ adminKey: ADMIN_KEY })
    const sandboxId = await createSandbox(h)

    const stopped = await staffCall(h, 'POST', `/admin/resources/${sandboxId}/stop`, {
      key: ADMIN_KEY,
      body: { reason: 'клиент просит остановить, тикет 42' },
    })
    expect(stopped.status).toBe(200)
    const body = (await stopped.json()) as { id: string; state: string }
    expect(body.id).toBe(sandboxId)
    expect(body.state).toBe('stopped')
    expect(h.store.sandboxes.get(sandboxId)?.state).toBe('stopped')

    const staffEntry = h.audit
      .list({ action: 'sandbox.stop' })
      .find((entry) => entry.actorId === 'staff')
    expect(staffEntry?.targetId).toBe(sandboxId)
    expect(staffEntry?.reason).toBe('клиент просит остановить, тикет 42')
    expect(staffEntry?.details?.tenant_id).toBe(h.tenant.id)
    // The wallet was settled by the same stop, once.
    expect(h.moneyStore.findReservation(h.tenant.id, sandboxId)).toBeUndefined()
  })

  test('a stop of an unknown machine answers 404 with the reason checked first', async () => {
    const h = harness({ adminKey: ADMIN_KEY })
    const missing = await staffCall(h, 'POST', '/admin/resources/sbx_missing/stop', {
      key: ADMIN_KEY,
      body: { reason: 'почему бы и нет' },
    })
    expect(missing.status).toBe(404)
  })
})

// ============================================================
// Credentials
// ============================================================

describe('provider credentials', () => {
  const FORBIDDEN_KEYS: Record<string, true> = {
    ciphertext: true,
    iv: true,
    tag: true,
    secret: true,
  }

  /** Every field name at any depth that must never reach the panel. */
  function forbiddenKeys(value: unknown): string[] {
    if (Array.isArray(value)) return value.flatMap((item) => forbiddenKeys(item))
    if (value === null || typeof value !== 'object') return []
    const found: string[] = []
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (FORBIDDEN_KEYS[key] === true) found.push(key)
      found.push(...forbiddenKeys(item))
    }
    return found
  }

  test('the staff view never carries ciphertext, iv, tag or the secret', async () => {
    const h = harness({ adminKey: ADMIN_KEY })
    const response = await staffCall(h, 'GET', '/admin/credentials', { key: ADMIN_KEY })
    expect(response.status).toBe(200)
    const text = await response.text()
    expect(text).not.toContain('ciphertext')
    expect(text).not.toContain('"iv"')
    expect(text).not.toContain('"tag"')
    expect(text).not.toContain(DAYTONA_SECRET)

    const body = JSON.parse(text) as {
      data: Array<{ id: string; tenant_id: string; provider: string; last4: string; status: string }>
    }
    expect(forbiddenKeys(body)).toEqual([])
    expect(body.data.length).toBe(1)
    expect(body.data[0]?.tenant_id).toBe(h.tenant.id)
    expect(body.data[0]?.provider).toBe('daytona')
    expect(body.data[0]?.status).toBe('active')
    expect(body.data[0]?.last4).toBe('_123')
  })
})

// ============================================================
// Kill switch
// ============================================================

describe('kill switch', () => {
  test('request, approve, block a boot, then disable and boot again', async () => {
    const h = harness({ adminKey: ADMIN_KEY })

    const requested = await staffCall(h, 'POST', '/admin/killswitch', {
      key: ADMIN_KEY,
      body: {
        scope: { provider: 'daytona', product: 'sandbox' },
        enabled: true,
        reason: 'провайдер деградирует',
      },
    })
    expect(requested.status).toBe(200)
    const pending = (await requested.json()) as { id: string; state: string }
    expect(pending.state).toBe('pending')
    // A pending request blocks nothing yet.
    expect(h.killSwitch.isBlocked({ provider: 'daytona', product: 'sandbox' })).toBeNull()

    const approved = await staffCall(h, 'POST', `/admin/killswitch/${pending.id}/approve`, {
      key: ADMIN_KEY,
    })
    expect(approved.status).toBe(200)
    const approvedBody = (await approved.json()) as { state: string }
    expect(approvedBody.state).toBe('active')
    expect(h.killSwitch.isBlocked({ provider: 'daytona', product: 'sandbox' })).not.toBeNull()
    expect(h.runtime.runtime.killSwitch.list().length).toBe(1)

    const blocked = await customerCall(h, '/v1/sandboxes', 'admin-idem-blocked')
    expect(blocked.status).toBe(409)
    expect((await envelope(blocked)).code).toBe('kill_switch_active')
    expect(h.daytona.calls).toBe(0)

    const disabled = await staffCall(h, 'POST', `/admin/killswitch/${pending.id}/disable`, {
      key: ADMIN_KEY,
      body: { reason: 'провайдер восстановился' },
    })
    expect(disabled.status).toBe(200)
    const disabledBody = (await disabled.json()) as { state: string }
    expect(disabledBody.state).toBe('disabled')
    expect(h.killSwitch.isBlocked({ provider: 'daytona', product: 'sandbox' })).toBeNull()

    const allowed = await customerCall(h, '/v1/sandboxes', 'admin-idem-allowed')
    expect(allowed.status).toBe(201)
    expect(h.daytona.calls).toBe(1)
  })

  test('a kill request without a reason is refused and the list stays empty', async () => {
    const h = harness({ adminKey: ADMIN_KEY })
    const response = await staffCall(h, 'POST', '/admin/killswitch', {
      key: ADMIN_KEY,
      body: { scope: {}, enabled: true, reason: '   ' },
    })
    expect(response.status).toBe(400)
    expect((await envelope(response)).code).toBe('invalid_request')
    expect(h.killSwitch.list().length).toBe(0)
  })

  test('the same staff key cannot approve its own request in one step', async () => {
    const h = harness({ adminKey: ADMIN_KEY })
    // A request made directly as `staff` cannot be approved as `staff`: the
    // switch refuses one person doing both halves.
    const direct = h.killSwitch.request({ scope: {}, enabled: true, reason: 'ручная проверка' }, 'staff')
    const response = await staffCall(h, 'POST', `/admin/killswitch/${direct.id}/approve`, {
      key: ADMIN_KEY,
    })
    expect(response.status).toBe(409)
    expect((await envelope(response)).code).toBe('conflict')
  })
})

// ============================================================
// Journal
// ============================================================

describe('audit journal', () => {
  test('entries come newest first and keep the reason', async () => {
    const h = harness({ adminKey: ADMIN_KEY })
    const sandboxId = await createSandbox(h)
    await staffCall(h, 'POST', `/admin/resources/${sandboxId}/stop`, {
      key: ADMIN_KEY,
      body: { reason: 'первая причина' },
    })

    const response = await staffCall(h, 'GET', '/admin/audit?limit=50', { key: ADMIN_KEY })
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      data: Array<{ id: string; at: string; actor_id: string; action: string; target_id: string; reason: string }>
    }
    expect(body.data.length).toBeGreaterThan(1)
    const times = body.data.map((entry) => Date.parse(entry.at))
    expect(times).toEqual([...times].sort((a, b) => b - a))
    // The last thing appended is the first thing shown.
    const newest = h.audit.list().at(-1)
    if (newest === undefined) throw new Error('журнал пуст: нечего сравнивать')
    expect(body.data[0]?.id).toBe(newest.id)
    expect(body.data[0]?.reason).toBe('первая причина')
    expect(body.data[0]?.actor_id).toBe('staff')
    expect(body.data.some((entry) => entry.action === 'sandbox.create')).toBe(true)

    const bad = await staffCall(h, 'GET', '/admin/audit?limit=0', { key: ADMIN_KEY })
    expect(bad.status).toBe(400)
  })
})

// ============================================================
// One origin: pages, redirect and CORS
// ============================================================

describe('pages on the API origin', () => {
  test('the marketing site is served at the root and the console stays at /console/', async () => {
    const h = harness({ adminKey: ADMIN_KEY })

    const root = await h.front(new Request('https://api.test/'))
    expect(root.status).toBe(200)
    expect(root.headers.get('content-type')).toContain('text/html')
    expect(await root.text()).toContain('Rox Cloud')

    const docs = await h.front(new Request('https://api.test/docs.html'))
    expect(docs.status).toBe(200)
    expect(await docs.text()).toContain('Документация')

    const console = await h.front(new Request('https://api.test/console/'))
    expect(console.status).toBe(200)
    expect(console.headers.get('content-type')).toContain('text/html')
    expect(await console.text()).toContain('Rox Cloud')

    const consoleBare = await h.front(new Request('https://api.test/console'))
    expect(consoleBare.status).toBe(302)
    expect(consoleBare.headers.get('location')).toBe('/console/')

    for (const path of ['/console/app.js', '/console/styles.css']) {
      const asset = await h.front(new Request(`https://api.test${path}`))
      expect(asset.status).toBe(200)
      expect(asset.headers.get('content-length')).not.toBeNull()
    }

    const adminPage = await h.front(new Request('https://api.test/admin/'))
    expect(adminPage.status).toBe(200)
    expect(adminPage.headers.get('content-type')).toContain('text/html')
    const html = await adminPage.text()
    expect(html).toContain('Рубильник')
    expect(html).not.toContain('http://')
    expect(html).not.toContain('https://')
  })

  test('a path-traversal attempt never reaches the source tree', async () => {
    const h = harness({ adminKey: ADMIN_KEY })
    const response = await h.front(new Request('https://api.test/console/../src/app.ts'))
    expect(response.status).toBe(404)
    const text = await response.text()
    expect(text).not.toContain('createApp')
    const body = JSON.parse(text) as { error?: { code?: string } }
    expect(body.error?.code).toBe('not_found')

    const encoded = await h.front(new Request('https://api.test/console/%2e%2e/%2e%2e/src/server.ts'))
    expect(encoded.status).toBe(404)
    expect(await encoded.text()).not.toContain('Bun.serve')
  })

  test('preflight answers 204 and echoes only a configured origin', async () => {
    const h = harness({ adminKey: ADMIN_KEY })
    const previous = process.env.ROX_CORS_ORIGIN

    try {
      delete process.env.ROX_CORS_ORIGIN
      const bare = await h.front(
        new Request('https://api.test/admin/overview', {
          method: 'OPTIONS',
          headers: { origin: 'https://panel.test' },
        }),
      )
      expect(bare.status).toBe(204)
      expect(bare.headers.get('access-control-allow-origin')).toBeNull()

      process.env.ROX_CORS_ORIGIN = 'https://panel.test, https://other.test'
      const allowed = await h.front(
        new Request('https://api.test/admin/overview', {
          method: 'OPTIONS',
          headers: { origin: 'https://panel.test' },
        }),
      )
      expect(allowed.status).toBe(204)
      expect(allowed.headers.get('access-control-allow-origin')).toBe('https://panel.test')
      expect(allowed.headers.get('access-control-allow-headers')).toContain('idempotency-key')
      expect(allowed.headers.get('access-control-allow-methods')).toContain('OPTIONS')
      expect(allowed.headers.get('access-control-max-age')).toBe('600')

      const stranger = await h.front(
        new Request('https://api.test/admin/overview', {
          method: 'OPTIONS',
          headers: { origin: 'https://evil.test' },
        }),
      )
      expect(stranger.headers.get('access-control-allow-origin')).toBeNull()
    } finally {
      if (previous === undefined) delete process.env.ROX_CORS_ORIGIN
      else process.env.ROX_CORS_ORIGIN = previous
    }
  })
})
