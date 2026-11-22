/**
 * The request journal: bodiless rows in a 500-line ring.
 */

import { describe, expect, test } from 'bun:test'

import { createMemoryKeyStore } from '../../../../packages/cloud-keys/src/index.ts'
import { createAuditLog, createKillSwitch } from '../../../../packages/cloud-ops/src/index.ts'
import { createMemoryMoneyStore } from '../../../../packages/cloud-runner/src/entitlement.ts'
import { createAdminApp } from '../admin.ts'
import { createApp } from '../app.ts'
import type { DeclaredCapabilities } from '../app.ts'
import { generateApiKey } from '../auth.ts'
import { createHandler } from '../server.ts'
import { REQUEST_LOG_CAPACITY, createMemoryStore, nextId } from '../store.ts'
import type { RequestLogRow } from '../store.ts'

const NOW = Date.UTC(2026, 10, 22, 12, 0, 0)
const ADMIN_KEY = 'staff-key-for-requests'

const CAPS: DeclaredCapabilities = {
  id: 'daytona',
  os: ['linux'],
  gpu: false,
  pause: true,
  snapshot: true,
  volume: true,
  streaming: 'none',
  maxTtlSec: 86_400,
  regions: ['us'],
}

function harness() {
  const store = createMemoryStore()
  const tenant = store.addTenant('Journal Co')
  const generated = generateApiKey()
  store.addApiKey({
    id: nextId('key_'),
    tenantId: tenant.id,
    prefix: generated.prefix,
    last4: generated.last4,
    hash: generated.hash,
    scopes: ['sandboxes:read', 'sandboxes:write', 'keys:write', 'billing:read', 'billing:write'],
    createdAt: NOW,
  })
  const app = createApp({
    store,
    resolveProvider: () => null,
    listCapabilities: () => [CAPS],
    defaultProvider: 'daytona',
    now: () => NOW,
  })
  const moneyStore = createMemoryMoneyStore()
  const admin = createAdminApp({
    store,
    keyStore: createMemoryKeyStore({ now: () => new Date(NOW) }),
    moneyStore,
    audit: createAuditLog({ now: () => new Date(NOW) }),
    killSwitch: createKillSwitch({ now: () => new Date(NOW) }),
    limits: { maxConcurrentSandboxes: 0, maxCpuPerSandbox: 0, maxMonthlyCents: 0 },
    adminKey: ADMIN_KEY,
    stopResource: async () => undefined,
    now: () => NOW,
  })
  return { app, admin, store, secret: generated.secret }
}

describe('request journal', () => {
  test('records method, path, status and the caller, never the header', async () => {
    const h = harness()
    await h.app.handle(new Request('http://api.test/health'))
    await h.app.handle(
      new Request('http://api.test/v1/sandboxes?limit=1', {
        headers: { authorization: `Bearer ${h.secret}`, 'x-forwarded-for': '203.0.113.5' },
      }),
    )

    expect(h.store.requests.length).toBe(2)
    const [health, list] = h.store.requests
    expect(health).toMatchObject({ method: 'GET', path: '/health', status: 200 })
    expect(health?.tenantId).toBeUndefined()
    expect(list).toMatchObject({
      method: 'GET',
      path: '/v1/sandboxes',
      status: 200,
      tenantId: h.store.apiKeys.values().next().value?.tenantId,
      keyLast4: h.secret.slice(-4),
      ip: '203.0.113.5',
    })
    expect(list?.requestId?.startsWith('req_')).toBe(true)
    const text = JSON.stringify(h.store.requests)
    expect(text).not.toContain(h.secret)
    expect(text).not.toContain('authorization')
  })

  test('a refused call is journaled with its status', async () => {
    const h = harness()
    await h.app.handle(new Request('http://api.test/v1/sandboxes'))
    expect(h.store.requests[0]).toMatchObject({ path: '/v1/sandboxes', status: 401 })
  })

  test('the ring keeps the newest rows only', async () => {
    const h = harness()
    for (let i = 0; i < REQUEST_LOG_CAPACITY + 5; i += 1) {
      await h.app.handle(new Request('http://api.test/health'))
    }
    expect(h.store.requests.length).toBe(REQUEST_LOG_CAPACITY)
    expect(h.store.requests[0]?.at).toBe(NOW)
  })

  test('the panel reads the journal newest first', async () => {
    const h = harness()
    await h.app.handle(new Request('http://api.test/health'))
    await h.app.handle(new Request('http://api.test/v1/nope'))
    const response = await h.admin.handle(
      new Request('http://api.test/v1/admin/requests?limit=10', {
        headers: { authorization: `Bearer ${ADMIN_KEY}` },
      }),
    )
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      capacity: number
      data: Array<{ path: string; status: number; request_id: string | null }>
    }
    expect(body.capacity).toBe(REQUEST_LOG_CAPACITY)
    expect(body.data.map((row) => row.path)).toEqual(['/v1/nope', '/health'])
    expect(body.data[0]?.status).toBe(404)
    expect(body.data[0]?.request_id?.startsWith('req_')).toBe(true)
  })
})


describe('front-door journal', () => {
  test('a staff call the app never sees still lands in the ring', async () => {
    const rows: RequestLogRow[] = []
    const front = createHandler({
      app: { handle: async () => new Response('app') },
      admin: { handle: async () => new Response('panel', { status: 200 }) },
      recordRequest: (row) => rows.push(row),
      lookupTenant: (key) => (key === ADMIN_KEY ? 'tenant-from-key' : undefined),
      clientIp: () => '198.51.100.9',
    })
    const response = await front(
      new Request('http://api.test/v1/admin/overview', {
        headers: { authorization: `Bearer ${ADMIN_KEY}` },
      }),
    )
    expect(response.status).toBe(200)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      method: 'GET',
      path: '/v1/admin/overview',
      status: 200,
      tenantId: 'tenant-from-key',
      keyLast4: ADMIN_KEY.slice(-4),
      ip: '198.51.100.9',
    })
    expect(rows[0]?.requestId === undefined || rows[0]?.requestId.startsWith('req_')).toBe(true)
  })
})
