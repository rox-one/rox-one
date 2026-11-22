/**
 * Key rotation: every old key stops working, one new secret appears once.
 */

import { describe, expect, test } from 'bun:test'

import { createMemoryKeyStore } from '../../../../packages/cloud-keys/src/index.ts'
import { createAuditLog, createKillSwitch } from '../../../../packages/cloud-ops/src/index.ts'
import { createMemoryMoneyStore } from '../../../../packages/cloud-runner/src/entitlement.ts'
import { createAdminApp } from '../admin.ts'
import { generateApiKey, verifyApiKey } from '../auth.ts'
import { createMemoryStore, nextId } from '../store.ts'

const NOW = Date.UTC(2026, 10, 22, 12, 0, 0)
const ADMIN_KEY = 'staff-key-for-rotate'

function harness() {
  const store = createMemoryStore()
  const keyStore = createMemoryKeyStore({ now: () => new Date(NOW) })
  const moneyStore = createMemoryMoneyStore()
  const audit = createAuditLog({ now: () => new Date(NOW) })
  const killSwitch = createKillSwitch({ now: () => new Date(NOW) })

  const tenant = store.addTenant('Rotating Co')
  moneyStore.saveAccount({
    id: tenant.id,
    paid: true,
    balanceCents: 2400,
    reservedCents: 100,
    monthlyCapCents: 0,
    monthSpentCents: 0,
  })
  const generated = generateApiKey()
  store.addApiKey({
    id: nextId('key_'),
    tenantId: tenant.id,
    prefix: generated.prefix,
    last4: generated.last4,
    hash: generated.hash,
    scopes: ['sandboxes:read', 'billing:read'],
    createdAt: NOW,
  })

  const admin = createAdminApp({
    store,
    keyStore,
    moneyStore,
    audit,
    killSwitch,
    limits: { maxConcurrentSandboxes: 0, maxCpuPerSandbox: 0, maxMonthlyCents: 0 },
    adminKey: ADMIN_KEY,
    stopResource: async () => undefined,
    now: () => NOW,
  })
  return { admin, store, audit, tenant, oldSecret: generated.secret }
}

function call(admin: ReturnType<typeof harness>['admin'], path: string, body?: unknown, key = ADMIN_KEY) {
  return admin.handle(
    new Request(`http://api.test${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        authorization: `Bearer ${key}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  )
}

describe('key rotation', () => {
  test('refuses without a reason and changes nothing', async () => {
    const h = harness()
    const response = await call(h.admin, `/v1/admin/tenants/${h.tenant.id}/rotate-key`, {})
    expect(response.status).toBe(400)
    expect(verifyApiKey(h.store, h.oldSecret, NOW)).not.toBeNull()
  })

  test('revokes every old key and returns one new secret', async () => {
    const h = harness()
    const response = await call(h.admin, `/v1/admin/tenants/${h.tenant.id}/rotate-key`, {
      reason: 'клиент сообщил об утечке',
    })
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      revoked: number
      key: { api_key: string; scopes: string[] }
    }
    expect(body.revoked).toBe(1)
    expect(body.key.api_key.startsWith('rox_sk_live_')).toBe(true)
    expect(body.key.scopes.length).toBeGreaterThan(0)

    expect(verifyApiKey(h.store, h.oldSecret, NOW)).toBeNull()
    expect(verifyApiKey(h.store, body.key.api_key, NOW)).not.toBeNull()
    expect(JSON.stringify(body)).not.toContain('hash')

    const auditRows = h.audit.list({ action: 'tenant.rotate_key' as never })
    expect(auditRows.length).toBe(1)
    expect(auditRows[0]?.reason).toBe('клиент сообщил об утечке')
  })

  test('the key list shows both keys, one revoked, with the owner wallet', async () => {
    const h = harness()
    await call(h.admin, `/v1/admin/tenants/${h.tenant.id}/rotate-key`, { reason: 'плановая ротация' })
    const response = await call(h.admin, '/v1/admin/keys')
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      data: Array<{
        tenant_id: string
        tenant_name: string
        revoked_at: string | null
        balance_cents: number
        reserved_cents: number
      }>
    }
    const rows = body.data.filter((row) => row.tenant_id === h.tenant.id)
    expect(rows.length).toBe(2)
    expect(rows.filter((row) => row.revoked_at !== null).length).toBe(1)
    expect(rows.every((row) => row.tenant_name === 'Rotating Co')).toBe(true)
    expect(rows[0]?.balance_cents).toBe(2400)
    expect(rows[0]?.reserved_cents).toBe(100)
  })

  test('an unknown tenant answers 404', async () => {
    const h = harness()
    const response = await call(h.admin, '/v1/admin/tenants/ten_missing/rotate-key', { reason: 'нет такого' })
    expect(response.status).toBe(404)
  })
})
