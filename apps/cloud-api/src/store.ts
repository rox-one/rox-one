/**
 * In-memory control-plane state for the Rox Cloud BYOK API.
 *
 * Everything here lives in one process and disappears on restart: this is the
 * pilot shape of the public API, not the billing database. The only key
 * material kept is a sha256 hash — the plaintext leaves the process exactly
 * once, in the create response.
 */

import { randomBytes } from 'node:crypto'

import type { SandboxSpec, SandboxState } from '../../../packages/cloud-runner/src/sandbox.ts'

// ============================================================
// Scopes
// ============================================================

export type Scope =
  | 'sandboxes:read'
  | 'sandboxes:write'
  | 'keys:write'
  | 'billing:read'
  | 'billing:write'

/**
 * What a customer or bootstrap key gets by default. `billing:write` is
 * deliberately absent: adding money is a staff action (`POST
 * /v1/admin/tenants/{id}/credit`), and a key that could top itself up would
 * mint its own balance. The scope type keeps `billing:write` for service keys
 * minted deliberately outside this list.
 */
export const SCOPES: readonly Scope[] = [
  'sandboxes:read',
  'sandboxes:write',
  'keys:write',
  'billing:read',
]

/**
 * What a guest key may do. Deliberately no `keys:write` and no
 * `billing:write`: a trial account must not mint itself more trial.
 */
export const GUEST_SCOPES: readonly Scope[] = ['sandboxes:read', 'sandboxes:write', 'billing:read']

export function isScope(value: string): value is Scope {
  return (SCOPES as readonly string[]).includes(value)
}

// ============================================================
// Records
// ============================================================

export interface Tenant {
  readonly id: string
  readonly name: string
  readonly createdAt: number
  /** Created by `POST /v1/guest`: limited ceilings and a trial balance. */
  readonly guest?: boolean
  /**
   * Per-tenant ceilings, stricter than the deployment default. A guest carries
   * one machine, 16 cores, the trial balance as a monthly cap and a one-day
   * maximum lifetime here.
   */
  readonly limits?: TenantLimits
}

/** One tenant's own ceilings; `0` on an axis means «как у развёртывания». */
export interface TenantLimits {
  readonly maxConcurrentSandboxes: number
  readonly maxCpuPerSandbox: number
  readonly maxMonthlyCents: number
  /** Longest machine this tenant may rent; absent or 0 = no extra cap. */
  readonly maxTtlSec?: number
}

export interface ApiKeyRecord {
  readonly id: string
  readonly tenantId: string
  /** Public, non-secret prefix; safe to show in lists. */
  readonly prefix: string
  /** Last four characters of the secret, for a human to recognise the key. */
  readonly last4: string
  /** sha256 of the secret. The secret itself is never stored. */
  readonly hash: string
  readonly scopes: readonly Scope[]
  readonly createdAt: number
  /** Updated on every authenticated request. */
  lastUsedAt?: number
  /** Set when the key stopped working. Revoked keys stay listed so the panel can
   * show what a rotation replaced; authentication rejects them all the same. */
  revokedAt?: number
}

/** How a machine's hour is paid for; see `docs/cloud-product-spec.md` §3. */
export type BillingMode = 'byok' | 'managed'

export interface SandboxRecord {
  readonly id: string
  readonly tenantId: string
  readonly providerId: string
  state: SandboxState
  readonly createdAt: number
  readonly startedAt?: number
  /** Wall-clock deadline derived from `ttlSec`, in epoch milliseconds. */
  readonly expiresAt?: number
  /** Spend attributed to this sandbox so far, in integer cents. */
  costCents: number
  readonly routingReason?: string
  /** Exactly what the provider was asked for; kept for audits and replays. */
  readonly spec: SandboxSpec
  /**
   * Price this machine was sold at, in integer cents per hour. Absent on state
   * written before per-record rates; readers then fall back to the deployment
   * rate exactly as they did before.
   */
  readonly rateCentsPerHour?: number
  /** Full retail price of the same machine, for the invoice. */
  readonly retailCentsPerHour?: number
  /** Absent reads as `byok`, which is what every pre-existing record was. */
  readonly billingMode?: BillingMode
  /** Provider region the machine was asked for; absent = provider's choice. */
  readonly region?: string
}

export interface IdempotencyRecord {
  readonly tenantId: string
  readonly key: string
  /** sha256 of the normalised request body: same key + other body = conflict. */
  readonly fingerprint: string
  readonly sandboxId: string
  readonly createdAt: number
}

/**
 * One invoice line. Created when the machine boots and updated when it stops;
 * deleting the machine leaves the row, because an invoice that forgets a sold
 * hour is not an invoice. `cents` moves from a rising meter value to the final
 * charge, so the panel and the settle path read the same number.
 */
export interface UsageRow {
  readonly id: string
  readonly tenantId: string
  /** What the charge points at: a sandbox id today. */
  readonly ref: string
  /** Machine kind, `sandbox`, kept stable for the API's filters. */
  readonly product: string
  /** What a person reads on the invoice, e.g. «Разработка» or a snapshot. */
  label?: string
  /** Snapshot the machine was booted from, when one was named. */
  readonly snapshot?: string
  readonly billingMode?: BillingMode
  readonly rateCentsPerHour?: number
  readonly retailCentsPerHour?: number
  readonly serviceFeeCentsPerHour?: number
  /** Integer cents; never a float. */
  cents: number
  readonly currency: 'USD'
  readonly createdAt: number
  startedAt?: number
  stoppedAt?: number
}

/**
 * One API call, as the staff journal shows it. Deliberately bodiless: no
 * request body, no `Authorization` header, no query values beyond the path —
 * a log an operator reads must not become a secret store.
 */
export interface RequestLogRow {
  /** Epoch milliseconds; the panel prints it in the operator's zone. */
  at: number
  method: string
  /** Path only, without the query string. */
  path: string
  status: number
  durationMs: number
  tenantId?: string
  /** Last four characters of the presented key, never the key. */
  keyLast4?: string
  /** Forwarded or remote address, for abuse triage. */
  ip?: string
  /** The `x-request-id` of the same call, so a complaint names one request. */
  requestId?: string
}

/** Short name the staff panel uses for the same row. */
export type RequestRow = RequestLogRow

/** How many calls the in-memory journal keeps; older rows fall off the end. */
export const REQUEST_LOG_CAPACITY = 500

// ============================================================
// Store
// ============================================================

export interface MemoryStore {
  readonly tenants: Map<string, Tenant>
  readonly apiKeys: Map<string, ApiKeyRecord>
  /** Derived index: key hash → key id, so verification is O(1). */
  readonly apiKeyIdsByHash: Map<string, string>
  readonly sandboxes: Map<string, SandboxRecord>
  /** Keyed by `${tenantId}\u0000${idempotencyKey}`. */
  readonly idempotency: Map<string, IdempotencyRecord>
  readonly usage: UsageRow[]
  /** Ring of the newest `REQUEST_LOG_CAPACITY` API calls, in arrival order. */
  readonly requests: RequestLogRow[]

  addTenant(name: string, options?: { guest?: boolean; limits?: Tenant['limits'] }): Tenant
  addApiKey(record: ApiKeyRecord): void
  findApiKeyByHash(hash: string): ApiKeyRecord | undefined
  removeApiKey(id: string): boolean
  /** Mark every live key of a tenant as revoked; returns how many changed. */
  revokeTenantKeys(tenantId: string, at: number): number
  /** Sandboxes of one tenant, in creation order (Map insertion order). */
  sandboxesOf(tenantId: string): SandboxRecord[]
  /** Forget a sandbox and every idempotency record that pointed at it. */
  dropSandbox(id: string): void
  /** Append one call to the journal, dropping the oldest past the capacity. */
  recordRequest(row: RequestLogRow): void
}

/** Random, unguessable id with a readable prefix (`sbx_`, `key_`, `req_`). */
export function nextId(prefix: string): string {
  return `${prefix}${randomBytes(12).toString('hex')}`
}

export function createMemoryStore(): MemoryStore {
  const tenants = new Map<string, Tenant>()
  const apiKeys = new Map<string, ApiKeyRecord>()
  const apiKeyIdsByHash = new Map<string, string>()
  const sandboxes = new Map<string, SandboxRecord>()
  const idempotency = new Map<string, IdempotencyRecord>()
  const usage: UsageRow[] = []
  const requests: RequestLogRow[] = []

  return {
    tenants,
    apiKeys,
    apiKeyIdsByHash,
    sandboxes,
    idempotency,
    usage,
    requests,

    addTenant(name, options) {
      const guest = options?.guest === true
      const tenant: Tenant = {
        // A guest is recognisable by its id, not only by a flag: `guest-…`.
        id: guest ? nextId('guest-') : nextId('ten_'),
        name,
        createdAt: Date.now(),
        ...(guest ? { guest: true } : {}),
        ...(options?.limits === undefined ? {} : { limits: options.limits }),
      }
      tenants.set(tenant.id, tenant)
      return tenant
    },

    addApiKey(record) {
      apiKeys.set(record.id, record)
      apiKeyIdsByHash.set(record.hash, record.id)
    },

    findApiKeyByHash(hash) {
      const id = apiKeyIdsByHash.get(hash)
      return id === undefined ? undefined : apiKeys.get(id)
    },

    removeApiKey(id) {
      const record = apiKeys.get(id)
      if (!record) return false
      apiKeys.delete(id)
      if (apiKeyIdsByHash.get(record.hash) === id) apiKeyIdsByHash.delete(record.hash)
      return true
    },

    revokeTenantKeys(tenantId, at) {
      let changed = 0
      for (const record of apiKeys.values()) {
        if (record.tenantId !== tenantId || record.revokedAt !== undefined) continue
        record.revokedAt = at
        changed += 1
      }
      return changed
    },

    sandboxesOf(tenantId) {
      const rows: SandboxRecord[] = []
      for (const record of sandboxes.values()) {
        if (record.tenantId === tenantId) rows.push(record)
      }
      return rows
    },

    dropSandbox(id) {
      sandboxes.delete(id)
      for (const [idempotencyId, record] of idempotency) {
        if (record.sandboxId === id) idempotency.delete(idempotencyId)
      }
    },

    recordRequest(row) {
      requests.push(row)
      if (requests.length > REQUEST_LOG_CAPACITY) {
        requests.splice(0, requests.length - REQUEST_LOG_CAPACITY)
      }
    },
  }
}
