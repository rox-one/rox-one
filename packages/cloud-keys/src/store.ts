/**
 * BYOK credential store.
 *
 * An in-memory store of encrypted `StoredCredential` records plus the
 * operations the panel and the provider proxy need: add, list, rotate
 * (promote), disable, record health and gate a spend.
 *
 * Public functions return metadata only. The plaintext secret exists just long
 * enough to be encrypted inside `addCredential`; afterwards only `crypto.ts`
 * can recover it with the master key.
 */

import { randomUUID } from 'node:crypto';
import { encryptSecret, fingerprintSecret, lastFour } from './crypto.ts';
import type {
  AddCredentialInput,
  CredentialHealth,
  CredentialStatus,
  ProviderCredential,
  ProviderId,
  StoredCredential,
} from './types.ts';

/** Shortest secret accepted; shorter material is treated as a typo. */
export const MIN_SECRET_LENGTH = 8;

export type KeyStoreErrorCode =
  | 'secret_empty'
  | 'secret_too_short'
  | 'duplicate_fingerprint'
  | 'credential_not_found';

/** Rejection from the store, carrying a stable machine-readable reason. */
export class KeyStoreError extends Error {
  readonly code: KeyStoreErrorCode;

  constructor(code: KeyStoreErrorCode, message: string) {
    super(message);
    this.name = 'KeyStoreError';
    this.code = code;
  }
}

/** Why a spend may not proceed against this credential. */
export type SpendCapErrorCode = 'spend_cap_exceeded' | 'credential_disabled' | 'credential_expired';

export interface SpendCapRejection {
  error: SpendCapErrorCode;
}

/** Storage handle. `records` holds ciphertext only. */
export interface KeyStore {
  /**
   * Encrypted records by credential id. Exposed for diagnostics and tests;
   * reading it never yields a plaintext secret.
   */
  readonly records: Map<string, StoredCredential>;
  /** Injectable clock so expiry and timestamps stay testable. */
  readonly now: () => Date;
}

export interface MemoryKeyStoreOptions {
  now?: () => Date;
}

export function createMemoryKeyStore(options: MemoryKeyStoreOptions = {}): KeyStore {
  return {
    records: new Map<string, StoredCredential>(),
    now: options.now ?? (() => new Date()),
  };
}

function findOwned(store: KeyStore, tenantId: string, id: string): StoredCredential {
  const record = store.records.get(id);
  if (!record || record.tenantId !== tenantId) {
    throw new KeyStoreError('credential_not_found', `Credential ${id} not found for this tenant`);
  }
  return record;
}

/** Project a stored record onto its metadata view, dropping secret material. */
function toMetadata(record: StoredCredential): ProviderCredential {
  const metadata: ProviderCredential = {
    id: record.id,
    tenantId: record.tenantId,
    provider: record.provider,
    label: record.label,
    fingerprint: record.fingerprint,
    last4: record.last4,
    status: record.status,
    spendCapCents: record.spendCapCents,
    createdAt: record.createdAt,
    checkedAt: record.checkedAt,
    health: record.health,
  };
  if (record.expiresAt !== undefined) metadata.expiresAt = record.expiresAt;
  if (record.regions !== undefined) metadata.regions = [...record.regions];
  if (record.products !== undefined) metadata.products = [...record.products];
  return metadata;
}

function isExpired(record: StoredCredential, now: Date): boolean {
  if (record.expiresAt === undefined) return false;
  const expiresAtMs = Date.parse(record.expiresAt);
  // An unreadable expiry fails closed: never spend on an unclear key.
  if (Number.isNaN(expiresAtMs)) return true;
  return expiresAtMs <= now.getTime();
}

function pickInitialStatus(store: KeyStore, tenantId: string, provider: ProviderId): CredentialStatus {
  for (const record of store.records.values()) {
    if (record.tenantId === tenantId && record.provider === provider && record.status === 'active') {
      return 'standby';
    }
  }
  return 'active';
}

/**
 * Encrypt and store a new key.
 *
 * The first key of a tenant+provider becomes `active`; later ones join as
 * `standby` so rotation stays explicit. Returns metadata, never the secret.
 */
export function addCredential(
  store: KeyStore,
  masterKey: Uint8Array,
  input: AddCredentialInput,
): ProviderCredential {
  if (input.secret.trim().length === 0) {
    throw new KeyStoreError('secret_empty', 'Credential secret is empty');
  }
  if (input.secret.length < MIN_SECRET_LENGTH) {
    throw new KeyStoreError('secret_too_short', `Credential secret must be at least ${MIN_SECRET_LENGTH} characters`);
  }

  const fingerprint = fingerprintSecret(input.secret);
  for (const record of store.records.values()) {
    if (record.tenantId === input.tenantId && record.fingerprint === fingerprint) {
      throw new KeyStoreError('duplicate_fingerprint', 'This secret is already registered for the tenant');
    }
  }

  const encrypted = encryptSecret(input.secret, masterKey);
  const record: StoredCredential = {
    id: `cred_${randomUUID()}`,
    tenantId: input.tenantId,
    provider: input.provider,
    label: input.label,
    fingerprint,
    last4: lastFour(input.secret),
    status: pickInitialStatus(store, input.tenantId, input.provider),
    spendCapCents: input.spendCapCents,
    createdAt: store.now().toISOString(),
    checkedAt: null,
    health: 'unknown',
    ciphertext: encrypted.ciphertext,
    iv: encrypted.iv,
    tag: encrypted.tag,
  };
  if (input.expiresAt !== undefined) record.expiresAt = input.expiresAt;
  if (input.regions !== undefined) record.regions = [...input.regions];
  if (input.products !== undefined) record.products = [...input.products];

  store.records.set(record.id, record);
  return toMetadata(record);
}

/** Metadata for a tenant's keys, optionally narrowed to one provider. */
export function listCredentials(store: KeyStore, tenantId: string, provider?: ProviderId): ProviderCredential[] {
  const result: ProviderCredential[] = [];
  for (const record of store.records.values()) {
    if (record.tenantId !== tenantId) continue;
    if (provider !== undefined && record.provider !== provider) continue;
    result.push(toMetadata(record));
  }
  result.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return result;
}

/**
 * Make one key the active one for its tenant+provider.
 *
 * Every other key of the same tenant+provider that was `active` drops to
 * `standby`; `disabled` and `expired` keys keep their state so a rotation never
 * silently revives a key the tenant turned off.
 */
export function promoteCredential(store: KeyStore, tenantId: string, id: string): ProviderCredential {
  const target = findOwned(store, tenantId, id);
  for (const record of store.records.values()) {
    if (
      record.id !== target.id &&
      record.tenantId === tenantId &&
      record.provider === target.provider &&
      record.status === 'active'
    ) {
      record.status = 'standby';
    }
  }
  target.status = 'active';
  return toMetadata(target);
}

/** Turn a key off; it can no longer authorize a spend. */
export function disableCredential(store: KeyStore, tenantId: string, id: string): ProviderCredential {
  const record = findOwned(store, tenantId, id);
  record.status = 'disabled';
  return toMetadata(record);
}

/** Record the outcome of a provider probe and stamp the check time. */
export function markHealth(
  store: KeyStore,
  tenantId: string,
  id: string,
  health: CredentialHealth,
): ProviderCredential {
  const record = findOwned(store, tenantId, id);
  record.health = health;
  record.checkedAt = store.now().toISOString();
  return toMetadata(record);
}

/**
 * Gate one spend against a key: `null` means allowed, otherwise the refusal.
 *
 * Checks run cheapest-first: disabled, then expired, then the per-key ceiling.
 */
export function assertWithinCap(
  store: KeyStore,
  tenantId: string,
  id: string,
  amountCents: number,
): SpendCapRejection | null {
  const record = findOwned(store, tenantId, id);
  if (record.status === 'disabled') {
    return { error: 'credential_disabled' };
  }
  if (record.status === 'expired' || isExpired(record, store.now())) {
    return { error: 'credential_expired' };
  }
  if (amountCents > record.spendCapCents) {
    return { error: 'spend_cap_exceeded' };
  }
  return null;
}
