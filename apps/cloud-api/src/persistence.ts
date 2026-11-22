/**
 * Durable state for the Rox Cloud pilot.
 *
 * One JSON file holds everything the process keeps in memory: tenants and their
 * key hashes, sandboxes, wallets and the double-entry ledger, the encrypted
 * provider credentials, the audit trail and the kill switch. The file is the
 * whole state, not a cache in front of it.
 *
 * A restart reads the file back before any store is created, so a tenant, a
 * wallet and a staff trail survive a crash. Two rules shape the file:
 *
 * - loading never starts fresh on damage: an unreadable file, an unknown
 *   version or an audit chain that does not verify raises with the file path
 *   instead of quietly opening an empty deployment;
 * - a sandbox that was still `queued`, `starting`, `running`, `paused` or
 *   `stopping` when the process died and has no `providerRef` is gone — nobody
 *   can name its lease — so it comes back as `failed` and its reservation is
 *   released. A record that does carry a `providerRef` is left exactly as it
 *   was: the process re-adopts the lease on boot (see `server.ts`) and marks
 *   nothing failed, charges nothing and releases no hold here.
 *
 * Writing is atomic: a `${file}.tmp` sibling is written and fsynced, chmodded
 * 600 and only then renamed over the target, so a crash mid-write leaves the
 * previous file whole.
 */

import { chmod, mkdir, open, readFile, rename, unlink } from 'node:fs/promises'
import { dirname } from 'node:path'

import { release, settle } from '../../../packages/cloud-runner/src/entitlement.ts'
import type {
  Account,
  LedgerEntry,
  MoneyStore,
} from '../../../packages/cloud-runner/src/entitlement.ts'
import type { SandboxState } from '../../../packages/cloud-runner/src/sandbox.ts'
import type { KeyStore, StoredCredential } from '../../../packages/cloud-keys/src/index.ts'
import { createAuditLog, createKillSwitch } from '../../../packages/cloud-ops/src/index.ts'
import type { AuditEntry, AuditLog, KillRequest, KillSwitch } from '../../../packages/cloud-ops/src/index.ts'
import type {
  ApiKeyRecord,
  IdempotencyRecord,
  MemoryStore,
  SandboxRecord,
  Tenant,
  UsageRow,
} from './store.ts'

/** Bumped only when a newer file cannot be read by this code. */
export const STATE_VERSION = 1

/** One hold, keyed by the sandbox id it was placed for. */
export interface PersistedReservation {
  readonly accountId: string
  readonly ref: string
  readonly cents: number
}

/** Control-plane rows: what the customer API keeps per tenant. */
export interface PersistedCore {
  readonly tenants: readonly Tenant[]
  readonly apiKeys: readonly ApiKeyRecord[]
  readonly sandboxes: readonly SandboxRecord[]
  readonly idempotency: readonly IdempotencyRecord[]
  readonly usage: readonly UsageRow[]
}

/** Wallet rows: balances, holds and the ledger they were derived from. */
export interface PersistedMoney {
  readonly accounts: readonly Account[]
  readonly reservations: readonly PersistedReservation[]
  readonly ledger: readonly LedgerEntry[]
}

/** Everything one process holds, in the order it is read back. */
export interface PersistedState {
  readonly version: typeof STATE_VERSION
  /** ISO-8601 instant the snapshot was taken. */
  readonly savedAt: string
  readonly core: PersistedCore
  readonly money: PersistedMoney
  /** Encrypted provider credentials; ciphertext only, never a plaintext key. */
  readonly keys: readonly StoredCredential[]
  readonly audit: readonly AuditEntry[]
  readonly kills: readonly KillRequest[]
}

/** The live stores one snapshot reads and one restore fills. */
export interface PersistenceDeps {
  readonly store: MemoryStore
  readonly moneyStore: MoneyStore
  readonly keyStore: KeyStore
  readonly audit: AuditLog
  readonly killSwitch: KillSwitch
  /**
   * Deployment rate used to price a machine whose own rate was never stored.
   * Absent means such a machine is released instead of charged.
   */
  readonly rateCentsPerHour?: number
}

/** States that mean the machine is already gone; anything else is drained. */
const TERMINAL_STATES: Readonly<Record<SandboxState, boolean>> = {
  queued: false,
  starting: false,
  running: false,
  paused: false,
  stopping: false,
  stopped: true,
  failed: true,
  expired: true,
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Throw unless `value` is a plain object; the caller reads its named fields. */
function requireRecord(value: unknown, label: string, file: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Файл состояния ${file} повреждён: раздел ${label} должен быть объектом`)
  }
  return value as Record<string, unknown>
}

/** Throw unless `value` is an array; the caller keeps its own typed view. */
function requireArray(value: unknown, label: string, file: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`Файл состояния ${file} повреждён: поле ${label} должно быть списком`)
  }
  return value
}

/**
 * Read the state file.
 *
 * Returns `undefined` only when the file is absent — first boot. Any other
 * read problem, an unknown version or a broken audit chain raises with the
 * path, because starting from an empty state would silently forget tenants,
 * money and the staff trail.
 */
export async function loadState(file: string): Promise<PersistedState | undefined> {
  let raw: string
  try {
    raw = await readFile(file, 'utf8')
  } catch (error) {
    if ((error as { code?: unknown } | null)?.code === 'ENOENT') return undefined
    throw new Error(`Не удалось прочитать файл состояния ${file}: ${messageOf(error)}`)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    throw new Error(`Файл состояния ${file} повреждён: это не JSON (${messageOf(error)})`)
  }
  const root = requireRecord(parsed, 'файл', file)
  if (root.version !== STATE_VERSION) {
    throw new Error(
      `Файл состояния ${file} имеет версию ${String(root.version)}, а эта сборка читает только версию ${STATE_VERSION}`,
    )
  }
  if (typeof root.savedAt !== 'string') {
    throw new Error(`Файл состояния ${file} повреждён: нет времени снимка`)
  }
  const core = requireRecord(root.core, 'core', file)
  const money = requireRecord(root.money, 'money', file)

  const state: PersistedState = {
    version: STATE_VERSION,
    savedAt: root.savedAt,
    core: {
      tenants: requireArray(core.tenants, 'core.tenants', file) as Tenant[],
      apiKeys: requireArray(core.apiKeys, 'core.apiKeys', file) as ApiKeyRecord[],
      sandboxes: requireArray(core.sandboxes, 'core.sandboxes', file) as SandboxRecord[],
      idempotency: requireArray(core.idempotency, 'core.idempotency', file) as IdempotencyRecord[],
      usage: requireArray(core.usage, 'core.usage', file) as UsageRow[],
    },
    money: {
      accounts: requireArray(money.accounts, 'money.accounts', file) as Account[],
      reservations: requireArray(
        money.reservations,
        'money.reservations',
        file,
      ) as PersistedReservation[],
      ledger: requireArray(money.ledger, 'money.ledger', file) as LedgerEntry[],
    },
    keys: requireArray(root.keys, 'keys', file) as StoredCredential[],
    audit: requireArray(root.audit, 'audit', file) as AuditEntry[],
    kills: requireArray(root.kills, 'kills', file) as KillRequest[],
  }

  // The trail is the one part whose damage is detectable from the file alone,
  // so it is checked before the process takes a single request. The kill
  // switch is checked too: a request it could not read would crash the panel
  // later instead of naming the file now.
  try {
    createAuditLog().restore(state.audit)
  } catch (error) {
    throw new Error(
      `Файл состояния ${file} содержит повреждённую цепочку аудита: ${messageOf(error)}`,
    )
  }
  try {
    createKillSwitch().restore(state.kills)
  } catch (error) {
    throw new Error(
      `Файл состояния ${file} содержит неразборчивый запрос блокировки: ${messageOf(error)}`,
    )
  }
  return state
}

/** Read the live stores into one snapshot; nothing here mutates them. */
export function snapshotState(deps: PersistenceDeps): PersistedState {
  // Accounts are keyed by tenant id in this build; the ledger is scanned too so
  // a wallet left behind by a removed tenant is not silently dropped.
  const accountIds = new Set<string>()
  for (const tenant of deps.store.tenants.values()) accountIds.add(tenant.id)
  for (const row of deps.moneyStore.listLedger()) accountIds.add(row.accountId)

  const accounts: Account[] = []
  const reservations: PersistedReservation[] = []
  for (const accountId of accountIds) {
    const account = deps.moneyStore.getAccount(accountId)
    if (account !== undefined) accounts.push(structuredClone(account))
    for (const hold of deps.moneyStore.listReservations(accountId)) {
      reservations.push({ accountId, ref: hold.ref, cents: hold.cents })
    }
  }

  return {
    version: STATE_VERSION,
    savedAt: new Date().toISOString(),
    core: {
      tenants: [...deps.store.tenants.values()].map((tenant) => structuredClone(tenant)),
      apiKeys: [...deps.store.apiKeys.values()].map((record) => structuredClone(record)),
      sandboxes: [...deps.store.sandboxes.values()].map((record) => structuredClone(record)),
      idempotency: [...deps.store.idempotency.values()].map((record) => structuredClone(record)),
      usage: deps.store.usage.map((row) => structuredClone(row)),
    },
    money: {
      accounts,
      reservations,
      ledger: deps.moneyStore.listLedger().map((row) => structuredClone(row)),
    },
    keys: [...deps.keyStore.records.values()].map((record) => structuredClone(record)),
    audit: deps.audit.entries.map((entry) => structuredClone(entry)),
    kills: deps.killSwitch.requests.map((request) => structuredClone(request)),
  }
}

/**
 * Fill the live stores from a snapshot.
 *
 * Core rows first, then money in the order the ledger was built — accounts,
 * holds, and only then the ledger itself, so the rows keep their history.
 * Sandboxes that were not already finished come back as `failed` with their
 * reservation released: their provider-side lease is gone, and keeping a hold
 * for a machine nobody can stop would lock customer money for good.
 *
 * The one exception is a record with a `providerRef`: its lease still has a
 * name, so it is restored untouched — no `failed`, no charge, no release. The
 * boot path then hands the reference to the provider's `adopt`, and the reaper
 * and the shutdown keep working on a live record exactly as before.
 */
export function applyState(state: PersistedState, deps: PersistenceDeps): void {
  const { store, moneyStore, keyStore, audit, killSwitch } = deps

  store.tenants.clear()
  store.apiKeys.clear()
  store.apiKeyIdsByHash.clear()
  store.sandboxes.clear()
  store.idempotency.clear()
  store.usage.length = 0

  for (const tenant of state.core.tenants) store.tenants.set(tenant.id, structuredClone(tenant))
  for (const record of state.core.apiKeys) store.addApiKey(structuredClone(record))
  for (const record of state.core.sandboxes) {
    // Billing fields arrived with per-machine pricing. State written before
    // that keeps `undefined` here, and every reader falls back to the flat
    // deployment rate and to `byok` — the mode those machines were sold in.
    store.sandboxes.set(record.id, structuredClone(record))
  }
  for (const record of state.core.idempotency) {
    store.idempotency.set(`${record.tenantId}\u0000${record.key}`, structuredClone(record))
  }
  for (const row of state.core.usage) store.usage.push(structuredClone(row))

  for (const account of state.money.accounts) moneyStore.saveAccount(structuredClone(account))
  for (const hold of state.money.reservations) {
    moneyStore.putReservation(hold.accountId, hold.ref, hold.cents)
  }
  for (const row of state.money.ledger) moneyStore.appendLedger(structuredClone(row))

  for (const record of state.keys) keyStore.records.set(record.id, structuredClone(record))
  audit.restore(state.audit)
  killSwitch.restore(state.kills)

  const atMs = Date.now()
  for (const record of store.sandboxes.values()) {
    if (TERMINAL_STATES[record.state]) continue
    // A named lease survives the restart: the page it lives on is the
    // provider's, not ours. Left exactly as saved, including its hold, so the
    // boot path can re-adopt it and the ordinary stop and reaper paths keep
    // settling money the way they did before the restart.
    if (record.providerRef !== undefined) {
      console.log(
        `Rox Cloud: машина ${record.id} арендатора ${record.tenantId} была в состоянии ${record.state} при остановке — аренда провайдера сохранена, управление будет восстановлено`,
      )
      continue
    }
    const was = record.state
    const account = moneyStore.getAccount(record.tenantId)
    const held =
      account === undefined ? undefined : moneyStore.findReservation(record.tenantId, record.id)
    let note = 'резерва не было'
    if (held !== undefined) {
      // The machine did run until the crash; its rate is known, so the elapsed
      // span is charged through the ordinary settlement and only then the
      // record is marked failed. An unknown rate cannot charge honestly, so the
      // hold goes back untouched.
      const rate = record.rateCentsPerHour ?? deps.rateCentsPerHour ?? 0
      if (rate > 0) {
        const elapsedMs = Math.max(0, atMs - (record.startedAt ?? record.createdAt))
        const charged = Math.max(1, Math.ceil((elapsedMs / 3_600_000) * rate))
        settle(moneyStore, record.tenantId, record.id, charged, atMs)
        record.costCents = charged
        const line = deps.store.usage.find(
          (row) => row.tenantId === record.tenantId && row.ref === record.id,
        )
        if (line !== undefined) {
          line.cents = charged
          line.stoppedAt = atMs
        }
        note = `списано ${charged} центов по ставке ${rate}`
      } else {
        release(moneyStore, record.tenantId, record.id, atMs)
        note = `резерв ${held} центов освобождён: ставка машины неизвестна`
      }
    }
    record.state = 'failed'
    console.log(
      `Rox Cloud: машина ${record.id} арендатора ${record.tenantId} была в состоянии ${was} при остановке — помечена как failed, ${note}`,
    )
  }

  // An invoice line whose machine is already finished must not keep running
  // after a reload. A line saved without a stop time is closed at the machine's
  // own deadline, or at load time when there is none, and follows the final
  // cost the record carries. Lines that already stopped are left untouched.
  for (const record of store.sandboxes.values()) {
    if (!TERMINAL_STATES[record.state]) continue
    const line = store.usage.find(
      (row) => row.tenantId === record.tenantId && row.ref === record.id,
    )
    if (line === undefined || line.stoppedAt !== undefined) continue
    line.stoppedAt =
      record.expiresAt !== undefined && record.expiresAt <= atMs ? record.expiresAt : atMs
    line.cents = record.costCents
  }
}

/**
 * Write a snapshot atomically.
 *
 * The temp sibling is written, fsynced and chmodded 600 before the rename, so
 * either the previous complete file or the new complete file is on disk — a
 * half-written state is never visible. On success no `.tmp` file remains.
 */
export async function saveState(file: string, state: PersistedState): Promise<void> {
  await mkdir(dirname(file), { recursive: true, mode: 0o700 })

  const temp = `${file}.tmp`
  const text = JSON.stringify(state)
  try {
    const handle = await open(temp, 'w', 0o600)
    try {
      await handle.writeFile(text, 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }
    await chmod(temp, 0o600)
    await rename(temp, file)
  } catch (error) {
    // A failed write must not leave a half-synced sibling behind for the next
    // attempt to mistake for the target.
    await unlink(temp).catch(() => undefined)
    throw error
  }
}
