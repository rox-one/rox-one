/**
 * Secret Provider Types
 *
 * Provider abstraction for resolving named secrets into agent subprocess env
 * vars at spawn time. See docs/secrets-providers.md for the model and the
 * security invariants (values never enter prompts, transcripts, or logs).
 *
 * This module is a leaf: it must not import config/storage so that
 * config/storage can depend on these types without an import cycle.
 */

import { z } from 'zod';

/** Known secret provider ids. Array order is the default chain resolution order. */
export const SECRET_PROVIDER_IDS = ['environment', 'local-encrypted', 'infisical'] as const;
export type SecretProviderId = (typeof SECRET_PROVIDER_IDS)[number];

/**
 * One configured secret injection (config `runtime.secretRefs`).
 *
 * - `name`: logical name, safe for logs/diagnostics (never the value).
 * - `envVar`: environment variable the resolved value is injected as.
 * - `provider`: pin resolution to one provider; omitted = walk the chain.
 * - `ref`: provider-specific reference. Defaults per provider:
 *   - environment: `ROX_SECRET_<NAME>` (name uppercased, non-alnum → `_`)
 *   - local-encrypted: credential account `service_oauth::global::<name>`
 *   - infisical: `<name>` (secret name within configured project/env/path)
 */
export interface SecretRefEntry {
  name: string;
  envVar: string;
  provider?: SecretProviderId;
  ref?: string;
}

export const SecretRefEntrySchema = z.object({
  name: z.string().min(1),
  envVar: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/, 'envVar must be a valid POSIX env var name'),
  provider: z.enum(SECRET_PROVIDER_IDS).optional(),
  ref: z.string().min(1).optional(),
});

/** Reference passed to a provider for resolution. */
export interface SecretRef {
  /** Logical name from the config entry (safe for logs). */
  name: string;
  /** Provider-specific reference string; provider derives a default when absent. */
  ref?: string;
}

/** Typed failure modes surfaced through resolution diagnostics. */
export type SecretErrorCode =
  | 'INFISICAL_UNAVAILABLE' // not configured, network failure, or unexpected response
  | 'INFISICAL_AUTH_FAILED' // 401/403 from the Infisical API
  | 'SECRET_NOT_FOUND'; // no provider in the chain produced a value

/** Operational resolution failure. "Not found" is NOT an error — resolve() returns null. */
export class SecretResolveError extends Error {
  readonly code: SecretErrorCode;
  readonly provider: SecretProviderId;

  constructor(code: SecretErrorCode, provider: SecretProviderId, message: string) {
    super(message);
    this.name = 'SecretResolveError';
    this.code = code;
    this.provider = provider;
  }
}

export interface SecretProvider {
  readonly id: SecretProviderId;
  isAvailable(): Promise<boolean>;
  /** Resolve a ref to its value. null = not found. Operational failures throw SecretResolveError. */
  resolve(ref: SecretRef): Promise<string | null>;
  list?(scope?: { prefix?: string }): Promise<SecretRef[]>;
}

/** Per-entry outcome. Never contains resolved values. */
export interface SecretResolutionDiagnostic {
  name: string;
  envVar: string;
  status: 'resolved' | 'not-found' | 'error';
  /** Provider that resolved the entry, or the pinned provider that failed. */
  provider?: SecretProviderId;
  errorCode?: SecretErrorCode;
  /** Redacted, value-free detail. */
  message?: string;
}

export interface ResolveSecretsResult {
  /** envVar → resolved value. SECRET: merge into subprocess env only. */
  env: Record<string, string>;
  /** Value-free per-entry outcomes, safe for logs. */
  diagnostics: SecretResolutionDiagnostic[];
  /** Resolved values (for redaction registration). Handle with care. */
  values: string[];
}
