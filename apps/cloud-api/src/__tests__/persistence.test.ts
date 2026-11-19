/**
 * Durability tests for the Rox Cloud state file.
 *
 * Every test works in a throwaway directory under the OS temp root, never the
 * repository, so a crash in the middle of a test cannot leave a state file next
 * to the source. No network, no provider and no real credential is touched.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { addCredential, createMemoryKeyStore, decryptSecret } from '../../../../packages/cloud-keys/src/index.ts'
import type { KeyStore } from '../../../../packages/cloud-keys/src/index.ts'
import { OpsError, createAuditLog, createKillSwitch } from '../../../../packages/cloud-ops/src/index.ts'
import type { AuditLog, KillRequest, KillSwitch } from '../../../../packages/cloud-ops/src/index.ts'
import { createMemoryMoneyStore, reserve, topUp } from '../../../../packages/cloud-runner/src/entitlement.ts'
import type { MemoryMoneyStore } from '../../../../packages/cloud-runner/src/entitlement.ts'
import { generateApiKey, verifyApiKey } from '../auth.ts'
import type { PersistedState, PersistenceDeps } from '../persistence.ts'
import { applyState, loadState, saveState, snapshotState } from '../persistence.ts'
import { createMemoryStore, nextId } from '../store.ts'
import type { MemoryStore, Scope, Tenant } from '../store.ts'

// ============================================================
// Fixtures
// ============================================================

const NOW = Date.UTC(2026, 10, 19, 12, 0, 0)
const MASTER_KEY = new Uint8Array(32).fill(7)
const DAYTONA_SECRET = 'dt_secret_value_123'

const ALL_SCOPES: readonly Scope[] = [
  'sandboxes:read',
  'sandboxes:write',
  'keys:write',
  'billing:read',
]

interface World {
  readonly store: MemoryStore
  readonly keyStore: KeyStore
  readonly moneyStore: MemoryMoneyStore
  readonly audit: AuditLog
  readonly killSwitch: KillSwitch
  readonly deps: PersistenceDeps
  readonly tenant: Tenant
  /** Full `rox_sk_live_…` secret for the tenant's one key. */
  readonly secret: string
}

/** A tenant with a key, a paid wallet, one running sandbox, a credential and a trail. */
function buildWorld(options: { sandboxState?: 'running' | 'stopped' } = {}): World {
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

  const moneyStore = createMemoryMoneyStore()
  moneyStore.saveAccount({
    id: tenant.id,
    paid: true,
    balanceCents: 0,
    reservedCents: 0,
    monthlyCapCents: 0,
    monthSpentCents: 0,
  })
  topUp(moneyStore, tenant.id, 5_000, NOW)

  const sandboxId = nextId('sbx_')
  const held = reserve(moneyStore, tenant.id, 100, sandboxId, NOW)
  if (!held.ok) throw new Error('fixture reserve must succeed')
  store.sandboxes.set(sandboxId, {
    id: sandboxId,
    tenantId: tenant.id,
    providerId: 'daytona',
    state: options.sandboxState ?? 'running',
    createdAt: NOW,
    startedAt: NOW,
    expiresAt: NOW + 3_600_000,
    costCents: 0,
    spec: { id: 'idem-1', os: 'linux', cpu: 1, memoryGb: 1, ttlSec: 3600 },
  })

  const keyStore = createMemoryKeyStore({ now: () => new Date(NOW) })
  addCredential(keyStore, MASTER_KEY, {
    tenantId: tenant.id,
    provider: 'daytona',
    label: 'main',
    secret: DAYTONA_SECRET,
    spendCapCents: 10_000,
  })

  const audit = createAuditLog({ now: () => new Date(NOW) })
  audit.append({
    actorId: `tenant:${tenant.id}`,
    action: 'sandbox.create',
    targetType: 'sandbox',
    targetId: sandboxId,
    reason: 'customer request',
    details: { provider: 'daytona', reserved_cents: 100 },
  })

  const killSwitch = createKillSwitch({ now: () => new Date(NOW) })
  const requested = killSwitch.request(
    { scope: { provider: 'daytona', product: 'sandbox' }, enabled: true, reason: 'Провайдер деградирует' },
    'staff_one',
  )
  killSwitch.approve(requested.id, 'staff_two')

  return {
    store,
    keyStore,
    moneyStore,
    audit,
    killSwitch,
    deps: { store, moneyStore, keyStore, audit, killSwitch },
    tenant,
    secret: generated.secret,
  }
}

/** Fresh stores, as a restarted process would have. */
function emptyDeps(): PersistenceDeps {
  return {
    store: createMemoryStore(),
    moneyStore: createMemoryMoneyStore(),
    keyStore: createMemoryKeyStore(),
    audit: createAuditLog(),
    killSwitch: createKillSwitch(),
  }
}

let directory: string
let file: string

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'rox-state-'))
  file = join(directory, 'state.json')
})

afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

function errorText(run: () => unknown): Promise<string> {
  return Promise.resolve()
    .then(run)
    .then(
      () => '',
      (error: unknown) => (error instanceof Error ? error.message : String(error)),
    )
}

// ============================================================
// Round trip
// ============================================================

describe('state round trip', () => {
  test('tenants, key hashes, wallet, ledger, provider key and audit survive a reload', async () => {
    const before = buildWorld({ sandboxState: 'stopped' })
    const saved = snapshotState(before.deps)
    await saveState(file, saved)

    const loaded = await loadState(file)
    expect(loaded).toBeDefined()
    const after = emptyDeps()
    applyState(loaded as PersistedState, after)

    // Tenant and key authentication.
    const restoredTenant = [...after.store.tenants.values()][0]
    expect(restoredTenant?.id).toBe(before.tenant.id)
    expect(restoredTenant?.name).toBe('Тестовая команда')
    const verified = verifyApiKey(after.store, before.secret)
    expect(verified?.tenant.id).toBe(before.tenant.id)
    expect([...(verified?.scopes ?? [])].sort()).toEqual([...ALL_SCOPES].sort())

    // Wallet and ledger, row for row and in order.
    const walletBefore = before.moneyStore.getAccount(before.tenant.id)
    const walletAfter = after.moneyStore.getAccount(before.tenant.id)
    expect(walletAfter).toEqual(walletBefore)
    expect(after.moneyStore.listLedger()).toEqual(before.moneyStore.listLedger())

    // Sandbox rows come back with their spec intact.
    expect([...after.store.sandboxes.values()]).toEqual([...before.store.sandboxes.values()])

    // The encrypted provider key decrypts with the same master key.
    const [stored] = [...after.keyStore.records.values()]
    expect(stored?.tenantId).toBe(before.tenant.id)
    expect(decryptSecret(stored!, MASTER_KEY)).toBe(DAYTONA_SECRET)

    // The trail verifies and the next append still links onto it.
    expect(after.audit.verifyChain()).toEqual({ ok: true, count: 1 })
    const appended = after.audit.append({
      actorId: 'staff_one',
      action: 'sandbox.stop',
      targetType: 'sandbox',
      targetId: 'sbx_after',
      reason: 'после перезапуска',
    })
    expect(appended.prevHash).toBe(after.audit.entries[0]!.hash)
    expect(after.audit.verifyChain()).toEqual({ ok: true, count: 2 })

    // The kill switch keeps its approved scope.
    const [kill] = after.killSwitch.requests
    expect(kill?.state).toBe('active')
    expect(kill?.approvedBy).toBe('staff_two')
    expect(after.killSwitch.isBlocked({ provider: 'daytona', product: 'sandbox' })?.id).toBe(kill?.id)
  })

  test('a sandbox that was running comes back failed with its reserve released', async () => {
    const before = buildWorld({ sandboxState: 'running' })
    const balanceWhileRunning = before.moneyStore.getAccount(before.tenant.id)!.balanceCents
    const heldWhileRunning = before.moneyStore.getAccount(before.tenant.id)!.reservedCents
    expect(heldWhileRunning).toBe(100)

    await saveState(file, snapshotState(before.deps))
    const loaded = await loadState(file)
    const after = emptyDeps()
    applyState(loaded as PersistedState, after)

    const record = [...after.store.sandboxes.values()][0]!
    expect(record.state).toBe('failed')

    const wallet = after.moneyStore.getAccount(before.tenant.id)!
    expect(wallet.reservedCents).toBe(0)
    expect(wallet.balanceCents).toBe(balanceWhileRunning + heldWhileRunning)
    expect(after.moneyStore.findReservation(before.tenant.id, record.id)).toBeUndefined()

    // The release is a ledger pair, appended after the history that was saved.
    const ledger = after.moneyStore.listLedger(before.tenant.id)
    const savedRows = before.moneyStore.listLedger(before.tenant.id).length
    expect(ledger).toHaveLength(savedRows + 2)
    expect(ledger.slice(savedRows).map((row) => row.kind)).toEqual(['release', 'release'])
    expect(ledger.reduce((sum, row) => sum + row.amountCents, 0)).toBe(0)
  })

  test('a sandbox that was already stopped keeps its record and its ledger untouched', async () => {
    const before = buildWorld({ sandboxState: 'stopped' })
    await saveState(file, snapshotState(before.deps))
    const loaded = await loadState(file)
    const after = emptyDeps()
    applyState(loaded as PersistedState, after)

    expect([...after.store.sandboxes.values()][0]!.state).toBe('stopped')
    expect(after.moneyStore.listLedger()).toEqual(before.moneyStore.listLedger())
    expect(after.moneyStore.getAccount(before.tenant.id)!.reservedCents).toBe(100)
  })
})

// ============================================================
// Loading a damaged or missing file
// ============================================================

describe('loading', () => {
  test('a missing file reads as a first boot', async () => {
    expect(await loadState(join(directory, 'absent.json'))).toBeUndefined()
  })

  test('unreadable JSON raises with the file path', async () => {
    await writeFile(file, '{"version": 1, "core": oops', 'utf8')
    const message = await errorText(() => loadState(file))
    expect(message).toContain(file)
    expect(message).toContain('не JSON')
  })

  test('an unknown version refuses to load', async () => {
    await writeFile(file, JSON.stringify({ version: 2, savedAt: new Date(NOW).toISOString() }), 'utf8')
    const message = await errorText(() => loadState(file))
    expect(message).toContain(file)
    expect(message).toContain('версию')
  })

  test('a tampered audit chain raises with the file path', async () => {
    const world = buildWorld({ sandboxState: 'stopped' })
    const state = snapshotState(world.deps)
    const tampered: PersistedState = {
      ...state,
      audit: state.audit.map((entry, index) =>
        index === 0 ? { ...entry, reason: 'подменённая причина' } : entry,
      ),
    }
    await writeFile(file, JSON.stringify(tampered), 'utf8')

    const message = await errorText(() => loadState(file))
    expect(message).toContain(file)
    expect(message).toContain('цепочку аудита')
  })

  test('a kill request the panel could not read raises with the file path', async () => {
    const state = snapshotState(buildWorld({ sandboxState: 'stopped' }).deps)
    const broken = {
      ...state,
      kills: [
        {
          id: '',
          scope: {},
          enabled: true,
          reason: 'x',
          by: 'staff_one',
          at: new Date(NOW).toISOString(),
          state: 'active',
        },
      ],
    }
    await writeFile(file, JSON.stringify(broken), 'utf8')

    const message = await errorText(() => loadState(file))
    expect(message).toContain(file)
    expect(message).toContain('блокировки')
  })

  test('the killed process leaves a state the restore marks failed, not running', async () => {
    // A hard kill looks exactly like this: the file was written while the
    // machine was running and nothing drained it.
    const world = buildWorld({ sandboxState: 'running' })
    await saveState(file, snapshotState(world.deps))

    const loaded = await loadState(file)
    expect(loaded?.core.sandboxes[0]?.state).toBe('running')
    const after = emptyDeps()
    applyState(loaded as PersistedState, after)
    expect([...after.store.sandboxes.values()][0]!.state).toBe('failed')
  })
})

// ============================================================
// Writing
// ============================================================

describe('saving', () => {
  test('a second save replaces the file and leaves no temp sibling', async () => {
    const world = buildWorld({ sandboxState: 'stopped' })
    const first = snapshotState(world.deps)
    await saveState(file, { ...first, savedAt: '2026-11-19T10:00:00.000Z' })

    const second = snapshotState(world.deps)
    const secondText = JSON.stringify({ ...second, savedAt: '2026-11-19T11:00:00.000Z' })
    await saveState(file, JSON.parse(secondText) as PersistedState)

    expect(await readFile(file, 'utf8')).toBe(secondText)
    const entries = await readdir(directory)
    expect(entries).toEqual(['state.json'])

    const mode = (await stat(file)).mode & 0o777
    expect(mode).toBe(0o600)
  })

  test('the parent directory is created with mode 700', async () => {
    const nested = join(directory, 'run', 'nested', 'state.json')
    await saveState(nested, snapshotState(buildWorld().deps))
    expect((await stat(join(directory, 'run', 'nested'))).mode & 0o777).toBe(0o700)
    expect((await stat(nested)).mode & 0o777).toBe(0o600)
  })

  test('the saved file holds no plaintext provider secret', async () => {
    const world = buildWorld()
    await saveState(file, snapshotState(world.deps))
    const text = await readFile(file, 'utf8')
    expect(text).not.toContain(DAYTONA_SECRET)
    expect(text).not.toContain(world.secret)
  })
})

// ============================================================
// Restore inputs are validated
// ============================================================

describe('restore validation', () => {
  test('the kill switch refuses a record it could not read later', () => {
    const killSwitch = createKillSwitch()
    const broken = [
      { id: '', scope: {}, enabled: true, reason: 'x', by: 'staff', at: new Date(NOW).toISOString(), state: 'active' },
    ] as unknown as KillRequest[]
    expect(() => killSwitch.restore(broken)).toThrow(OpsError)
    expect(killSwitch.requests).toHaveLength(0)
  })

  test('the kill switch refuses an unknown scope provider', () => {
    const killSwitch = createKillSwitch()
    const broken = [
      {
        id: 'kill_1',
        scope: { provider: 'unknown_vendor' },
        enabled: true,
        reason: 'x',
        by: 'staff',
        at: new Date(NOW).toISOString(),
        state: 'active',
      },
    ] as unknown as KillRequest[]
    expect(() => killSwitch.restore(broken)).toThrow(OpsError)
  })

  test('the audit log refuses a broken chain and keeps the trail it had', () => {
    const audit = createAuditLog()
    audit.append({
      actorId: 'staff_one',
      action: 'sandbox.stop',
      targetType: 'sandbox',
      targetId: 'sbx_1',
      reason: 'до восстановления',
    })
    const good = audit.entries
    const tampered = good.map((entry) => ({ ...entry, targetId: 'sbx_other' }))
    expect(() => audit.restore(tampered)).toThrow(OpsError)
    expect(audit.entries).toEqual(good)
    expect(audit.restore(good)).toEqual({ ok: true, count: 1 })
  })
})
