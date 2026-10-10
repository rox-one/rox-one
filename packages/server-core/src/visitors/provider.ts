/**
 * Visitor identity provider seam (port-matrix row a1.6).
 *
 * The live Cloudflare Access client is intentionally NOT implemented: it needs
 * an account, an application audience and a hosted ingress (row a1.7 is
 * skipped for the same reason). What ships is the thin provider interface plus
 * the typed {@link VisitorProviderNotConfiguredError} refusal every caller must
 * handle, so the missing half fails loudly and typed instead of silently
 * admitting anyone.
 */
import type { VisitorSubject } from './types.ts'

export const VISITOR_PROVIDER_NOT_CONFIGURED = 'VISITOR_PROVIDER_NOT_CONFIGURED'

/** Thrown by any provider operation that has no credentials to run. */
export class VisitorProviderNotConfiguredError extends Error {
  readonly code = VISITOR_PROVIDER_NOT_CONFIGURED

  constructor(message = 'Visitor provider is not configured (no credentials)') {
    super(message)
    this.name = 'VisitorProviderNotConfiguredError'
  }
}

export interface VisitorProviderIdentity {
  readonly provider: string
  readonly displayName?: string
}

/** The one operation a future Cloudflare Access / GitHub client must supply. */
export interface VisitorProvider {
  readonly provider: string
  /** Resolve the provider's record for a subject (verification / display name). */
  resolveIdentity(subject: VisitorSubject): Promise<VisitorProviderIdentity>
}

export interface VisitorProviderConfig {
  /** Provider id, e.g. `cloudflare-access`. Defaults to `cloudflare-access`. */
  provider?: string
}

/**
 * Build the provider named by config. Without credentials the returned provider
 * implements the interface but every call refuses with the typed error — no
 * fake identity is ever produced.
 */
export function createVisitorProvider(config: VisitorProviderConfig = {}): VisitorProvider {
  const provider = config.provider?.trim() || 'cloudflare-access'
  return {
    provider,
    async resolveIdentity(): Promise<VisitorProviderIdentity> {
      throw new VisitorProviderNotConfiguredError(
        `Visitor provider "${provider}" has no credentials configured`,
      )
    },
  }
}