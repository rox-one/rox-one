/**
 * Control-plane wiring for Rox Cloud (BYOK).
 *
 * The HTTP layer (`app.ts`) knows nothing about Daytona keys, wallets or the
 * kill switch: it asks this module whether a boot may happen, which provider
 * answers for a tenant, and what to record once work stops. Everything here is
 * still in memory — the pilot shape, not the billing database.
 *
 * The customer pays Daytona directly, so the wallet carries only Rox's fee:
 * `rateCentsPerHour` is the platform rate, never a vendor price.
 *
 * Rules kept here:
 * - a plaintext provider key exists only between `decryptSecret` and the
 *   adapter constructor; it is never logged, stored or returned;
 * - a boot reserves the fee up front, a stop settles the elapsed time, a
 *   destroy releases whatever is still held;
 * - every money move is an integer number of cents.
 */

import type { MoneyStore } from '../../../packages/cloud-runner/src/entitlement.ts'
import { release, reserve, settle, topUp } from '../../../packages/cloud-runner/src/entitlement.ts'
import { estimateSandboxCents } from '../../../packages/cloud-runner/src/daytona-sandbox.ts'
import type { AccountLimits } from '../../../packages/cloud-runner/src/limits.ts'
import { checkAccountLimits } from '../../../packages/cloud-runner/src/limits.ts'
import type { SandboxProvider, SandboxState } from '../../../packages/cloud-runner/src/sandbox.ts'
import { CloudRunnerError } from '../../../packages/cloud-runner/src/types.ts'
import type { KeyStore, ProviderId } from '../../../packages/cloud-keys/src/index.ts'
import { decryptSecret, listCredentials } from '../../../packages/cloud-keys/src/index.ts'
import type { AuditLog, KillSwitch } from '../../../packages/cloud-ops/src/index.ts'
import {
  DAYTONA_DEFAULT_API_URL,
  DAYTONA_DEFAULT_TOOLBOX_URL,
  E2B_DEFAULT_API_URL,
  MODAL_PROVIDER_ID,
  PROVIDER_CAPABILITIES,
  PROVIDER_IDS,
  createDaytonaProvider,
  createE2BProvider,
  createModalProvider,
} from '../../../packages/providers/src/index.ts'
import type { DeclaredCapabilities } from './app.ts'
import { API_KEY_PREFIX, hashApiKey } from './auth.ts'
import { createPlatformProvider } from './platform.ts'
import type { ApiKeyRecord, MemoryStore, Tenant } from './store.ts'
import { SCOPES, nextId } from './store.ts'

// ============================================================
// Gate refusals
// ============================================================

/** Why the pre-create gate refuses a boot, or why a stop cannot settle. */
export type GateCode =
  | 'kill_switch_active'
  | 'entitlement_required'
  | 'insufficient_balance'
  | 'budget_exceeded'
  | 'concurrency_exceeded'
  | 'sandbox_too_large'
  | 'monthly_cap_exceeded'

const GATE_MESSAGES: Readonly<Record<GateCode, string>> = {
  kill_switch_active: 'Запуск новых машин остановлен дежурным рубильником',
  entitlement_required: 'Платные машины не включены для этого счёта',
  insufficient_balance: 'На счёте недостаточно средств для резерва',
  budget_exceeded: 'Резерв не проходит по месячному потолку счёта',
  concurrency_exceeded: 'Достигнут потолок одновременных машин',
  sandbox_too_large: 'Машина запрошена больше разрешённого размера',
  monthly_cap_exceeded: 'Месячный расход достиг потолка',
}

/**
 * A refusal from the gate.
 *
 * `CloudRunnerError.code` covers provider failures only, while the gate's
 * reasons are wider (wallet, limits, kill switch). The instance stays a
 * `CloudRunnerError` so every caller that already translates provider failures
 * uses the same error envelope, and the code is widened past the union here
 * instead of teaching the runner about billing.
 */
function gateError(code: GateCode, message = GATE_MESSAGES[code]): CloudRunnerError {
  const error = new CloudRunnerError(message, 'cancelled')
  const widened = error as unknown as { code: string }
  widened.code = code
  return error
}

// ============================================================
// Options and result
// ============================================================

/** Hold length used when a request carries no `ttlSec`: one hour of fee. */
export const DEFAULT_HOLD_TTL_SEC = 3600

/** No per-account ceilings unless the caller supplies them. */
const NO_LIMITS: AccountLimits = {
  maxConcurrentSandboxes: 0,
  maxCpuPerSandbox: 0,
  maxMonthlyCents: 0,
}

/** Sandboxes that still occupy the account's concurrency budget. */
const OCCUPIES_SLOT: Readonly<Record<SandboxState, boolean>> = {
  queued: true,
  starting: true,
  running: true,
  paused: true,
  stopping: true,
  stopped: false,
  failed: false,
  expired: false,
}

export interface RuntimeOptions {
  /** Control-plane state: tenants, keys, sandboxes. */
  readonly store: MemoryStore
  /** Encrypted customer provider keys. */
  readonly keyStore: KeyStore
  /** Wallet and ledger; the money account id is the tenant id. */
  readonly moneyStore: MoneyStore
  /** Append-only staff trail; tenant actions land here too. */
  readonly audit: AuditLog
  readonly killSwitch: KillSwitch
  /** AES-256 key for the credential vault; 32 bytes. */
  readonly masterKey: Uint8Array
  /** Rox's fee in cents per sandbox-hour. Provider prices never enter it. */
  readonly rateCentsPerHour: number
  readonly now?: () => number
  /** Injected HTTP transport for provider adapters. */
  readonly fetch?: typeof fetch
  readonly daytonaApiUrl?: string
  readonly daytonaToolboxUrl?: string
  /** Rox-hosted Modal bridge; when absent, Modal is not advertised. */
  readonly modalBridgeUrl?: string
  /** E2B template every customer sandbox starts from; absent = no E2B. */
  readonly e2bTemplate?: string
  /** E2B sandbox proxy host; defaults to the public one. */
  readonly e2bSandboxHost?: string
  /** Ceilings checked before a boot; zeros mean «не ограничено». */
  readonly limits?: AccountLimits
  /**
   * Rox's own provider for managed machines, or `null` when the deployment has
   * no platform key. Defaults to `createPlatformProvider` from `platform.ts`.
   */
  readonly platformProvider?: (providerId: string) => SandboxProvider | null
}

/** The assembled pieces, for the server and for tests. */
export interface ControlPlaneRuntime {
  readonly store: MemoryStore
  readonly keyStore: KeyStore
  readonly moneyStore: MoneyStore
  readonly audit: AuditLog
  readonly killSwitch: KillSwitch
  readonly rateCentsPerHour: number
  readonly now: () => number
}

/** What `beforeCreate` needs to decide and to hold the fee. */
export interface CreateGateInput {
  readonly tenantId: string
  readonly providerId: string
  readonly sandboxId: string
  readonly request: {
    readonly cpu: number
    readonly memoryGb: number
    readonly ttlSec?: number
  }
  /** Price this machine is sold at; absent falls back to the deployment rate. */
  readonly rateCentsPerHour?: number
  readonly billingMode?: 'byok' | 'managed'
}

export interface StopGateInput {
  readonly tenantId: string
  readonly sandboxId: string
  readonly startedAt: number
  readonly stoppedAt: number
  /** The rate the record was sold at, so the settlement matches the meter. */
  readonly rateCentsPerHour?: number
}

export interface DestroyGateInput {
  readonly tenantId: string
  readonly sandboxId: string
  /** true when the boot never happened and only the hold must go. */
  readonly rolledBack?: boolean
}

export interface ControlPlane {
  /** Real provider for this tenant's own key, or `null` when it has none. */
  resolveProvider(tenantId: string, providerId: string): Promise<SandboxProvider | null>
  /**
   * Provider plus who pays: the customer's key (`byok`) or Rox's platform key
   * (`managed`). `null` means neither exists for this tenant.
   */
  resolveLease(
    tenantId: string,
    providerId: string,
  ): Promise<{ provider: SandboxProvider; mode: 'byok' | 'managed' } | null>
  /** Vendors that actually have an adapter in this build. */
  listCapabilities(): readonly DeclaredCapabilities[]
  beforeCreate(input: CreateGateInput): Promise<void>
  afterStop(input: StopGateInput): Promise<void>
  afterDestroy(input: DestroyGateInput): Promise<void>
  readonly runtime: ControlPlaneRuntime
}

// ============================================================
// Runtime
// ============================================================

function isProviderId(value: string): value is ProviderId {
  return (PROVIDER_IDS as readonly string[]).includes(value)
}

function isUsable(credential: { status: string; expiresAt?: string }, atMs: number): boolean {
  if (credential.status !== 'active') return false
  if (credential.expiresAt === undefined) return true
  const expiresAtMs = Date.parse(credential.expiresAt)
  // An unreadable expiry fails closed, exactly like the key store's own gate.
  return !Number.isNaN(expiresAtMs) && expiresAtMs > atMs
}

/** One built adapter per tenant+provider, so the adapter's sandbox map survives. */
interface CachedProvider {
  readonly credentialId: string
  readonly provider: SandboxProvider
}

export function createRuntime(options: RuntimeOptions): ControlPlane {
  if (!Number.isInteger(options.rateCentsPerHour) || options.rateCentsPerHour <= 0) {
    throw new Error(
      `rateCentsPerHour must be a positive integer number of cents, got ${options.rateCentsPerHour}`,
    )
  }
  const now = options.now ?? (() => Date.now())
  const limits = options.limits ?? NO_LIMITS
  const providers = new Map<string, CachedProvider>()

  const runtime: ControlPlaneRuntime = {
    store: options.store,
    keyStore: options.keyStore,
    moneyStore: options.moneyStore,
    audit: options.audit,
    killSwitch: options.killSwitch,
    rateCentsPerHour: options.rateCentsPerHour,
    now,
  }

  // ---------- provider resolution ----------

  async function resolveProvider(tenantId: string, providerId: string): Promise<SandboxProvider | null> {
    const cacheKey = `${tenantId}\u0000${providerId}`
    if (!isProviderId(providerId)) {
      providers.delete(cacheKey)
      return null
    }
    const atMs = now()
    const credential = listCredentials(options.keyStore, tenantId, providerId).find((entry) =>
      isUsable(entry, atMs),
    )
    if (!credential) {
      // A disabled or rotated-away key must not keep serving from the cache.
      providers.delete(cacheKey)
      return null
    }
    const cached = providers.get(cacheKey)
    if (cached && cached.credentialId === credential.id) return cached.provider

    // A vendor without an adapter (or Modal without a bridge URL, or E2B
    // without a template) stores keys but cannot answer requests, so no secret
    // is decrypted for it.
    const modalBridgeUrl = options.modalBridgeUrl
    const e2bTemplate = options.e2bTemplate
    const hasAdapter =
      providerId === 'daytona' ||
      (providerId === 'modal' && Boolean(modalBridgeUrl)) ||
      (providerId === 'e2b' && Boolean(e2bTemplate))
    if (!hasAdapter) {
      providers.delete(cacheKey)
      return null
    }

    const stored = options.keyStore.records.get(credential.id)
    if (!stored) {
      providers.delete(cacheKey)
      return null
    }
    const apiKey = decryptSecret(
      { ciphertext: stored.ciphertext, iv: stored.iv, tag: stored.tag },
      options.masterKey,
    )
    const provider =
      providerId === 'modal'
        ? createModalProvider({
            id: MODAL_PROVIDER_ID,
            apiUrl: modalBridgeUrl as string,
            apiKey,
            fetch: options.fetch,
            now,
          })
        : providerId === 'e2b'
          ? createE2BProvider({
              id: 'e2b',
              apiUrl: E2B_DEFAULT_API_URL,
              apiKey,
              defaultTemplate: e2bTemplate as string,
              ...(options.e2bSandboxHost ? { sandboxHost: options.e2bSandboxHost } : {}),
              fetch: options.fetch,
              now,
            })
          : createDaytonaProvider({
              id: 'daytona',
              apiUrl: options.daytonaApiUrl ?? DAYTONA_DEFAULT_API_URL,
              toolboxUrl: options.daytonaToolboxUrl ?? DAYTONA_DEFAULT_TOOLBOX_URL,
              apiKey,
              fetch: options.fetch,
              now,
            })
    providers.set(cacheKey, { credentialId: credential.id, provider })
    return provider
  }

  /**
   * Rox's platform adapter, built once per provider so its sandbox map lives
   * as long as the process. The key never leaves `platform.ts`.
   */
  const platformCache = new Map<string, SandboxProvider>()
  function platformProviderFor(providerId: string): SandboxProvider | null {
    const cached = platformCache.get(providerId)
    if (cached !== undefined) return cached
    const built = (options.platformProvider ?? createPlatformProvider)(providerId)
    if (built !== null) platformCache.set(providerId, built)
    return built
  }

  /**
   * Who pays for this machine. The customer's own key always wins, because a
   * byok customer pays the provider directly; only when they have none does
   * Rox front the machine on its platform key.
   */
  async function resolveLease(
    tenantId: string,
    providerId: string,
  ): Promise<{ provider: SandboxProvider; mode: 'byok' | 'managed' } | null> {
    const own = await resolveProvider(tenantId, providerId)
    if (own !== null) return { provider: own, mode: 'byok' }
    const managed = platformProviderFor(providerId)
    return managed === null ? null : { provider: managed, mode: 'managed' }
  }

  function listCapabilities(): readonly DeclaredCapabilities[] {
    // Only vendors with a real adapter are advertised. Modal appears only when
    // the bridge URL is configured, because its adapter has nothing to call
    // otherwise; E2B keys are accepted into the vault but not advertised.
    const daytona = PROVIDER_CAPABILITIES.daytona
    const listed: DeclaredCapabilities[] = [
      { ...daytona, os: [...daytona.os], regions: [...daytona.regions] },
    ]
    if (options.modalBridgeUrl) {
      const modal = PROVIDER_CAPABILITIES.modal
      listed.push({ ...modal, os: [...modal.os], regions: [...modal.regions] })
    }
    if (options.e2bTemplate) {
      const e2b = PROVIDER_CAPABILITIES.e2b
      listed.push({ ...e2b, os: [...e2b.os], regions: [...e2b.regions] })
    }
    return listed
  }

  // ---------- lifecycle gates ----------

  function activeCount(tenantId: string): number {
    let count = 0
    for (const record of options.store.sandboxesOf(tenantId)) {
      if (OCCUPIES_SLOT[record.state]) count += 1
    }
    return count
  }

  /** `0` means «не ограничено», so the tighter positive ceiling wins. */
  function tighterCeiling(a: number, b: number): number {
    if (a <= 0) return b
    if (b <= 0) return a
    return Math.min(a, b)
  }

  /**
   * The ceiling a boot is checked against: the deployment default, narrowed by
   * the tenant's own (a guest carries one machine and the trial balance).
   */
  function limitsFor(tenantId: string): AccountLimits {
    const own = options.store.tenants.get(tenantId)?.limits
    if (own === undefined) return limits
    return {
      maxConcurrentSandboxes: tighterCeiling(limits.maxConcurrentSandboxes, own.maxConcurrentSandboxes),
      maxCpuPerSandbox: tighterCeiling(limits.maxCpuPerSandbox, own.maxCpuPerSandbox),
      maxMonthlyCents: tighterCeiling(limits.maxMonthlyCents, own.maxMonthlyCents),
    }
  }

  async function beforeCreate(input: CreateGateInput): Promise<void> {
    const { tenantId, providerId, sandboxId, request } = input

    const blocked = options.killSwitch.isBlocked({
      ...(isProviderId(providerId) ? { provider: providerId } : {}),
      product: 'sandbox',
    })
    if (blocked) {
      throw gateError('kill_switch_active', `${GATE_MESSAGES.kill_switch_active}: ${blocked.reason}`)
    }

    const account = options.moneyStore.getAccount(tenantId)
    if (!account) {
      // No wallet means the account was never paid for; nothing to hold against.
      throw gateError('entitlement_required')
    }

    // The tenant profile owns the lifetime cap as well: a guest machine may
    // live a day, not a month, and the refusal names the limit.
    const maxTtlSec = options.store.tenants.get(tenantId)?.limits?.maxTtlSec
    if (
      request.ttlSec !== undefined &&
      maxTtlSec !== undefined &&
      maxTtlSec > 0 &&
      request.ttlSec > maxTtlSec
    ) {
      throw new CloudRunnerError(
        `Срок жизни ${request.ttlSec} с больше разрешённых ${maxTtlSec} с для этого клиента`,
        'invalid_spec',
      )
    }

    const rateCentsPerHour = input.rateCentsPerHour ?? options.rateCentsPerHour
    const ttlSec = request.ttlSec ?? DEFAULT_HOLD_TTL_SEC
    const holdCents = estimateSandboxCents({
      ttlMs: ttlSec * 1000,
      rateCentsPerHour,
    })

    const refusal = checkAccountLimits({
      limits: limitsFor(tenantId),
      activeCount: activeCount(tenantId),
      requestedCpu: request.cpu,
      monthSpentCents: account.monthSpentCents,
      requestedReserveCents: holdCents,
    })
    if (refusal) throw gateError(refusal)

    const held = reserve(options.moneyStore, tenantId, holdCents, sandboxId, now())
    if (!held.ok) throw gateError(held.error)

    options.audit.append({
      actorId: `tenant:${tenantId}`,
      action: 'sandbox.create',
      targetType: 'sandbox',
      targetId: sandboxId,
      reason: 'customer request',
      details: {
        provider: providerId,
        cpu: request.cpu,
        memory_gb: request.memoryGb,
        reserved_cents: holdCents,
        rate_cents_per_hour: rateCentsPerHour,
        billing_mode: input.billingMode ?? 'byok',
      },
    })
  }

  async function afterStop(input: StopGateInput): Promise<void> {
    const { tenantId, sandboxId, startedAt, stoppedAt } = input
    let chargedCents = 0
    const account = options.moneyStore.getAccount(tenantId)
    // `settle` releases the hold and then charges the elapsed fee; with no hold
    // left (already settled, or released by a destroy) it would charge again,
    // so an absent hold means there is nothing to settle.
    if (account && options.moneyStore.findReservation(tenantId, sandboxId) !== undefined) {
      const elapsedMs = Math.max(0, stoppedAt - startedAt)
      const rateCentsPerHour = input.rateCentsPerHour ?? options.rateCentsPerHour
      // A started sandbox costs at least one cent, like any metered hour.
      chargedCents = Math.max(1, Math.ceil((elapsedMs / 3_600_000) * rateCentsPerHour))
      settle(options.moneyStore, tenantId, sandboxId, chargedCents, now())
    }
    options.audit.append({
      actorId: `tenant:${tenantId}`,
      action: 'sandbox.stop',
      targetType: 'sandbox',
      targetId: sandboxId,
      reason: 'customer request',
      details: {
        charged_cents: chargedCents,
        rate_cents_per_hour: input.rateCentsPerHour ?? options.rateCentsPerHour,
      },
    })
  }

  async function afterDestroy(input: DestroyGateInput): Promise<void> {
    const { tenantId, sandboxId, rolledBack } = input
    let releasedCents = 0
    // A missing account and a missing hold are both "nothing to give back",
    // which keeps destroy after stop from charging or refunding twice.
    if (options.moneyStore.getAccount(tenantId)) {
      const held = options.moneyStore.findReservation(tenantId, sandboxId)
      if (held !== undefined) {
        release(options.moneyStore, tenantId, sandboxId, now())
        releasedCents = held
      }
    }
    if (rolledBack === true) return
    options.audit.append({
      actorId: `tenant:${tenantId}`,
      action: 'sandbox.delete',
      targetType: 'sandbox',
      targetId: sandboxId,
      reason: 'customer request',
      details: { released_cents: releasedCents },
    })
  }

  return { resolveProvider, resolveLease, listCapabilities, beforeCreate, afterStop, afterDestroy, runtime }
}

// ============================================================
// Bootstrap
// ============================================================

export interface BootstrapOptions {
  /** Full `rox_sk_live_…` secret the operator already configured. */
  readonly key: string
  /** Human name of the one tenant created with that key. */
  readonly tenantName: string
  readonly now?: () => number
}

export interface BootstrapResult {
  /** true only on the boot that created the tenant and the key. */
  readonly created: boolean
  readonly tenant?: Tenant
  readonly keyId?: string
}

/**
 * Create the first tenant and key from the operator's configured secret.
 *
 * The store keeps a hash only, so a restart with the same secret finds nothing
 * to add and reports `created: false`; a store that already holds any key is
 * never touched.
 */
export function ensureBootstrapKey(store: MemoryStore, options: BootstrapOptions): BootstrapResult {
  if (store.apiKeys.size > 0) return { created: false }
  if (!options.key.startsWith(API_KEY_PREFIX)) {
    throw new Error(`Bootstrap key must start with ${API_KEY_PREFIX}`)
  }
  const at = (options.now ?? (() => Date.now()))()
  const tenant = store.addTenant(options.tenantName)
  const record: ApiKeyRecord = {
    id: nextId('key_'),
    tenantId: tenant.id,
    prefix: API_KEY_PREFIX,
    last4: options.key.slice(-4),
    hash: hashApiKey(options.key),
    scopes: SCOPES,
    createdAt: at,
  }
  store.addApiKey(record)
  return { created: true, tenant, keyId: record.id }
}

/**
 * Pay the bootstrap tenant's wallet in full, once per boot.
 *
 * In this slice there is no payment capture: a configured starting balance is
 * how the operator makes the first tenant able to reserve a fee at all.
 */
export function ensureBootstrapBalance(
  moneyStore: MoneyStore,
  tenantId: string,
  cents: number,
  atMs: number,
): void {
  if (!Number.isInteger(cents) || cents <= 0) {
    throw new Error(`Starting balance must be a positive integer number of cents, got ${cents}`)
  }
  if (!moneyStore.getAccount(tenantId)) {
    moneyStore.saveAccount({
      id: tenantId,
      paid: true,
      balanceCents: 0,
      reservedCents: 0,
      monthlyCapCents: 0,
      monthSpentCents: 0,
    })
  }
  topUp(moneyStore, tenantId, cents, atMs)
}
