/**
 * Guest sign-up: a trial tenant, one limited key and a trial balance.
 */

import { describe, expect, test } from 'bun:test'

import { createMemoryKeyStore } from '../../../../packages/cloud-keys/src/index.ts'
import { createAuditLog, createKillSwitch } from '../../../../packages/cloud-ops/src/index.ts'
import { createMemoryMoneyStore } from '../../../../packages/cloud-runner/src/entitlement.ts'
import type {
  SandboxExecResult,
  SandboxProvider,
  SandboxSpec,
  SandboxStatus,
} from '../../../../packages/cloud-runner/src/sandbox.ts'
import { createApp } from '../app.ts'
import type { CloudApp, DeclaredCapabilities } from '../app.ts'
import { generateApiKey, verifyApiKey } from '../auth.ts'
import { createRuntime } from '../integration.ts'
import { createMemoryStore, nextId } from '../store.ts'

const NOW = Date.UTC(2026, 10, 22, 12, 0, 0)

const CAPS: DeclaredCapabilities = {
  id: 'daytona',
  os: ['linux', 'windows'],
  gpu: true,
  pause: true,
  snapshot: true,
  volume: true,
  streaming: 'none',
  maxTtlSec: 86_400,
  regions: ['us'],
}

function harness(options: { enabled?: boolean; trial?: number } = {}) {
  const store = createMemoryStore()
  const moneyStore = createMemoryMoneyStore()
  const app = createApp({
    store,
    moneyStore,
    resolveProvider: () => null,
    listCapabilities: () => [CAPS],
    defaultProvider: 'daytona',
    now: () => NOW,
    guest: {
      enabled: options.enabled ?? true,
      ...(options.trial === undefined ? {} : { trialCents: options.trial }),
    },
    guestClientIp: () => '10.0.0.7',
  })
  return { app, store, moneyStore }
}

function join(app: CloudApp, token?: string): Promise<Response> {
  return app.handle(
    new Request('http://api.test/v1/guest', {
      method: 'POST',
      headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
    }),
  )
}

interface GuestBody {
  object: string
  tenant: { id: string; name: string }
  api_key: string
  balance_cents: number
}

describe('guest sign-up', () => {
  test('off by default: 403 guest_disabled', async () => {
    const { app } = harness({ enabled: false })
    const response = await join(app)
    expect(response.status).toBe(403)
    const body = (await response.json()) as { error: { code: string } }
    expect(body.error.code).toBe('guest_disabled')
  })

  test('creates a tenant, one limited key and the trial balance', async () => {
    const { app, store } = harness()
    const response = await join(app)
    expect(response.status).toBe(201)
    const body = (await response.json()) as GuestBody
    expect(body.object).toBe('guest')
    expect(body.tenant.id.startsWith('guest-')).toBe(true)
    expect(body.tenant.name).toBe('Гость')
    expect(body.api_key.startsWith('rox_sk_live_')).toBe(true)
    expect(body.balance_cents).toBe(2000)

    const verified = verifyApiKey(store, body.api_key, NOW)
    expect(verified).not.toBeNull()
    expect(verified?.tenant.guest).toBe(true)
    expect(verified?.scopes).toEqual(['sandboxes:read', 'sandboxes:write', 'billing:read'])
    expect(verified?.tenant.limits).toEqual({
      maxConcurrentSandboxes: 1,
      maxCpuPerSandbox: 16,
      maxMonthlyCents: 2000,
      maxTtlSec: 86_400,
    })
    expect(JSON.stringify(body)).not.toContain('plt_')
  })

  test('a custom trial balance is honoured and caps the month', async () => {
    const { app, store, moneyStore } = harness({ trial: 500 })
    const body = (await (await join(app)).json()) as GuestBody
    expect(body.balance_cents).toBe(500)
    expect(moneyStore.getAccount(body.tenant.id)?.monthlyCapCents).toBe(500)
    expect(store.tenants.get(body.tenant.id)?.limits?.maxMonthlyCents).toBe(500)
  })

  test('the sixth sign-up from one address is 429', async () => {
    const { app } = harness()
    for (let i = 0; i < 5; i += 1) {
      expect((await join(app)).status).toBe(201)
    }
    const sixth = await join(app)
    expect(sixth.status).toBe(429)
    expect(((await sixth.json()) as { error: { code: string } }).error.code).toBe('rate_limited')
  })

  test('a guest key cannot add its own balance', async () => {
    const { app } = harness()
    const guest = (await (await join(app)).json()) as GuestBody
    const response = await app.handle(
      new Request('http://api.test/v1/account/topup', {
        method: 'POST',
        headers: { authorization: `Bearer ${guest.api_key}`, 'content-type': 'application/json' },
        body: JSON.stringify({ amountCents: 100000 }),
      }),
    )
    // The route itself does not exist: a guest cannot mint balance, and neither
    // can any customer key; staff credit is the only way in.
    expect(response.status).toBe(404)
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe('not_found')
  })
})


class GateProvider implements SandboxProvider {
  readonly providerId = 'daytona'
  async create(spec: SandboxSpec): Promise<SandboxStatus> {
    return { id: spec.id, provider: this.providerId, state: 'running', createdAt: NOW }
  }
  async get(id: string): Promise<SandboxStatus> {
    return { id, provider: this.providerId, state: 'running', createdAt: NOW }
  }
  async exec(): Promise<SandboxExecResult> {
    return { stdout: '', stderr: '', exitCode: 0 }
  }
  async readFile(): Promise<Uint8Array> {
    return new Uint8Array()
  }
  async writeFile(): Promise<void> {}
  async stop(): Promise<void> {}
  async destroy(): Promise<void> {}
}

/** A guest tenant with its profile ceilings and the real pre-create gate. */
function gatedHarness() {
  const store = createMemoryStore()
  const tenant = store.addTenant('Гость', {
    guest: true,
    limits: {
      maxConcurrentSandboxes: 1,
      maxCpuPerSandbox: 16,
      maxMonthlyCents: 2000,
      maxTtlSec: 86_400,
    },
  })
  const keyStore = createMemoryKeyStore({ now: () => new Date(NOW) })
  const moneyStore = createMemoryMoneyStore()
  moneyStore.saveAccount({
    id: tenant.id,
    paid: true,
    balanceCents: 2000,
    reservedCents: 0,
    monthlyCapCents: 2000,
    monthSpentCents: 0,
  })
  const runtime = createRuntime({
    store,
    keyStore,
    moneyStore,
    audit: createAuditLog({ now: () => new Date(NOW) }),
    killSwitch: createKillSwitch({ now: () => new Date(NOW) }),
    masterKey: new Uint8Array(32).fill(1),
    rateCentsPerHour: 36,
    now: () => NOW,
  })
  const provider = new GateProvider()
  const generated = generateApiKey()
  store.addApiKey({
    id: nextId('key_'),
    tenantId: tenant.id,
    prefix: generated.prefix,
    last4: generated.last4,
    hash: generated.hash,
    scopes: ['sandboxes:read', 'sandboxes:write', 'billing:read'],
    createdAt: NOW,
  })
  const app = createApp({
    store,
    moneyStore,
    resolveProvider: () => provider,
    listCapabilities: () => [CAPS],
    defaultProvider: 'daytona',
    beforeCreate: runtime.beforeCreate,
    afterStop: runtime.afterStop,
    afterDestroy: runtime.afterDestroy,
    rateCentsPerHour: 36,
    now: () => NOW,
  })
  return { app, secret: generated.secret }
}

async function createAs(
  app: CloudApp,
  secret: string,
  body: Record<string, unknown>,
): Promise<Response> {
  return app.handle(
    new Request('http://api.test/v1/sandboxes', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${secret}`,
        'content-type': 'application/json',
        'idempotency-key': `g-${Math.random()}`,
      },
      body: JSON.stringify(body),
    }),
  )
}

async function codeOf(response: Response): Promise<string> {
  return ((await response.json()) as { error: { code: string } }).error.code
}

describe('guest ceilings', () => {
  test('a second simultaneous machine is refused', async () => {
    const h = gatedHarness()
    const first = await createAs(h.app, h.secret, { os: 'linux', cpu: 1, memoryGb: 1, ttlSec: 3600 })
    expect(first.status).toBe(201)
    const second = await createAs(h.app, h.secret, { os: 'linux', cpu: 1, memoryGb: 1, ttlSec: 3600 })
    expect(second.status).toBe(409)
    expect(await codeOf(second)).toBe('concurrency_exceeded')
  })

  test('17 cores are refused as too large', async () => {
    const h = gatedHarness()
    const response = await createAs(h.app, h.secret, { os: 'linux', cpu: 17, memoryGb: 4, ttlSec: 3600 })
    expect(response.status).toBe(400)
    expect(await codeOf(response)).toBe('sandbox_too_large')
  })

  test('a lifetime above one day is refused', async () => {
    const h = gatedHarness()
    const response = await createAs(h.app, h.secret, { os: 'linux', cpu: 1, memoryGb: 1, ttlSec: 86_401 })
    expect(response.status).toBe(400)
    expect(await codeOf(response)).toBe('invalid_request')
  })
})
