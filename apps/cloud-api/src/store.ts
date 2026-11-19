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

export type Scope = 'sandboxes:read' | 'sandboxes:write' | 'keys:write' | 'billing:read'

export const SCOPES: readonly Scope[] = [
  'sandboxes:read',
  'sandboxes:write',
  'keys:write',
  'billing:read',
]

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
}

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
}

export interface IdempotencyRecord {
  readonly tenantId: string
  readonly key: string
  /** sha256 of the normalised request body: same key + other body = conflict. */
  readonly fingerprint: string
  readonly sandboxId: string
  readonly createdAt: number
}

export interface UsageRow {
  readonly id: string
  readonly tenantId: string
  /** What the charge points at: a sandbox id today. */
  readonly ref: string
  readonly product: string
  /** Integer cents; never a float. */
  cents: number
  readonly currency: 'USD'
  readonly createdAt: number
}

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

  addTenant(name: string): Tenant
  addApiKey(record: ApiKeyRecord): void
  findApiKeyByHash(hash: string): ApiKeyRecord | undefined
  removeApiKey(id: string): boolean
  /** Sandboxes of one tenant, in creation order (Map insertion order). */
  sandboxesOf(tenantId: string): SandboxRecord[]
  /** Forget a sandbox and every idempotency record that pointed at it. */
  dropSandbox(id: string): void
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

  return {
    tenants,
    apiKeys,
    apiKeyIdsByHash,
    sandboxes,
    idempotency,
    usage,

    addTenant(name) {
      const tenant: Tenant = { id: nextId('ten_'), name, createdAt: Date.now() }
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
  }
}
