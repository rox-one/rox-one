/**
 * Public Cloud Run provider registry (Rox tracker issue 25).
 *
 * Cloudflare / Modal / E2B are retired from the normal registry and UI.
 * A failed Daytona request must never fall back onto those providers, so an
 * unknown provider name is now an explicit error instead of a silent
 * rewrite to `daytona` — a typo in config must be visible, not paid for on
 * someone else's account.
 */

import { CloudRunnerError } from './types.ts';

export const PUBLIC_CLOUD_RUN_PROVIDERS = ['daytona', 'local', 'native'] as const;

export type PublicCloudRunProvider = (typeof PUBLIC_CLOUD_RUN_PROVIDERS)[number];

export type PublicCloudRunProviderResolution =
  | { ok: true; provider: PublicCloudRunProvider }
  | { ok: false; error: 'provider_unknown'; allowed: readonly PublicCloudRunProvider[] };

const DEFAULT_PUBLIC_CLOUD_RUN_PROVIDER: PublicCloudRunProvider = 'daytona';

export function isPublicCloudRunProvider(value: string): value is PublicCloudRunProvider {
  return (PUBLIC_CLOUD_RUN_PROVIDERS as readonly string[]).includes(value);
}

/**
 * Resolve a configured provider name.
 *
 * Empty/undefined keeps the historical default (`daytona`). Any other
 * non-empty name that is not in the public list is rejected with the list of
 * allowed names so the caller can show it to the user.
 */
export function resolvePublicCloudRunProvider(
  value: string | undefined,
): PublicCloudRunProviderResolution {
  if (!value) return { ok: true, provider: DEFAULT_PUBLIC_CLOUD_RUN_PROVIDER };
  if (isPublicCloudRunProvider(value)) return { ok: true, provider: value };
  return { ok: false, error: 'provider_unknown', allowed: PUBLIC_CLOUD_RUN_PROVIDERS };
}

/**
 * Throwing variant for call sites that cannot branch. Same resolution as
 * `resolvePublicCloudRunProvider`; an unknown name raises
 * `CloudRunnerError` code `provider_unknown` and never falls back.
 */
export function coercePublicCloudRunProvider(value: string | undefined): PublicCloudRunProvider {
  const resolved = resolvePublicCloudRunProvider(value);
  if (resolved.ok) return resolved.provider;
  throw new CloudRunnerError(
    `unknown cloud-run provider: ${value ?? ''} (allowed: ${PUBLIC_CLOUD_RUN_PROVIDERS.join(', ')})`,
    'provider_unknown',
  );
}
