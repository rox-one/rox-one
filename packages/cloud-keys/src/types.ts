/**
 * Rox Cloud — customer-owned provider keys (BYOK).
 *
 * A tenant brings its own Daytona / Modal / E2B key. The platform keeps the
 * secret encrypted at rest and only ever hands the UI metadata: a fingerprint,
 * the last four characters, status, health and spend cap.
 *
 * Nothing in this file carries a secret; `StoredCredential` carries the
 * ciphertext produced by `crypto.ts` and never the plaintext.
 */

/** Providers whose customer-owned API keys Rox Cloud can hold. */
export type ProviderId = 'daytona' | 'modal' | 'e2b';

/**
 * Lifecycle of one key.
 *
 * `active` is the key requests use, `standby` is a rotated-in or rotated-out
 * spare, `disabled` was turned off by the tenant and `expired` ran past
 * `expiresAt`.
 */
export type CredentialStatus = 'active' | 'standby' | 'disabled' | 'expired';

/** Result of the last provider probe. `unknown` until the first probe runs. */
export type CredentialHealth = 'ok' | 'degraded' | 'invalid' | 'unknown';

/** Everything the panel is allowed to see about one key. */
export interface ProviderCredential {
  id: string;
  tenantId: string;
  provider: ProviderId;
  /** Tenant-supplied name for the key; never derived from the secret. */
  label: string;
  /** SHA-256 hex of the plaintext secret; used to reject duplicates. */
  fingerprint: string;
  /** Last four characters of the secret — the only secret-derived text shown. */
  last4: string;
  status: CredentialStatus;
  /** ISO-8601 instant after which the key must not be used. */
  expiresAt?: string;
  /** Per-key ceiling in cents for a single authorized spend. */
  spendCapCents: number;
  regions?: string[];
  products?: string[];
  /** ISO-8601 instant the credential was added. */
  createdAt: string;
  /** ISO-8601 instant of the last health probe; null until one runs. */
  checkedAt: string | null;
  health: CredentialHealth;
}

/** Encrypted record held by the store. Ciphertext only — never the secret. */
export interface StoredCredential extends ProviderCredential {
  /** AES-256-GCM ciphertext, base64. */
  ciphertext: string;
  /** 12-byte initialisation vector, base64. */
  iv: string;
  /** 16-byte GCM authentication tag, base64. */
  tag: string;
}

/** What the caller supplies to add a key; server-side fields are derived. */
export interface AddCredentialInput {
  tenantId: string;
  provider: ProviderId;
  label: string;
  /** Plaintext secret; encrypted immediately and never stored as-is. */
  secret: string;
  expiresAt?: string;
  spendCapCents: number;
  regions?: string[];
  products?: string[];
}
