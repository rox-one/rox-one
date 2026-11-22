/**
 * API keys for the Rox Cloud BYOK API.
 *
 * A key is `rox_sk_live_` + 192 random bits. Only its sha256 hash is stored:
 * losing the process state loses the keys, not the customers' secrets.
 */

import { createHash, randomBytes } from 'node:crypto'

import type { ApiKeyRecord, MemoryStore, Scope, Tenant } from './store.ts'

export const API_KEY_PREFIX = 'rox_sk_live_'

export interface GeneratedApiKey {
  /** Shown to the caller exactly once, in the create response. */
  readonly secret: string
  readonly prefix: string
  readonly last4: string
  readonly hash: string
}

export interface VerifiedApiKey {
  readonly tenant: Tenant
  readonly key: ApiKeyRecord
  readonly scopes: readonly Scope[]
}

/** Hex sha256 of any string; the API key hash and the idempotency fingerprint. */
export function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex')
}

export function hashApiKey(secret: string): string {
  return sha256Hex(secret)
}

export function generateApiKey(): GeneratedApiKey {
  const secret = `${API_KEY_PREFIX}${randomBytes(24).toString('base64url')}`
  return { secret, prefix: API_KEY_PREFIX, last4: secret.slice(-4), hash: hashApiKey(secret) }
}

/**
 * Resolve a presented bearer token to its tenant, or `null` when the token is
 * unknown or revoked. Stamps `lastUsedAt` on success.
 *
 * A revoked key is found by hash on purpose: the caller must not be able to
 * tell «never existed» from «rotation revoked it», so both are a plain 401.
 */
export function verifyApiKey(
  store: MemoryStore,
  presented: string,
  now: number = Date.now(),
): VerifiedApiKey | null {
  const secret = presented.trim()
  if (secret.length === 0) return null
  const record = store.findApiKeyByHash(hashApiKey(secret))
  if (!record || record.revokedAt !== undefined) return null
  const tenant = store.tenants.get(record.tenantId)
  if (!tenant) return null
  record.lastUsedAt = now
  return { tenant, key: record, scopes: record.scopes }
}
