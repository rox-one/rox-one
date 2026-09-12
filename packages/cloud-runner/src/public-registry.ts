/**
 * Public Cloud Run provider registry (Rox tracker issue 25).
 *
 * Cloudflare / Modal / E2B are retired from the normal registry and UI.
 * A failed Daytona request must never fall back onto those providers.
 */

export const PUBLIC_CLOUD_RUN_PROVIDERS = ['daytona', 'local', 'native'] as const;

export type PublicCloudRunProvider = (typeof PUBLIC_CLOUD_RUN_PROVIDERS)[number];

const RETIRED_CLOUD_RUN_PROVIDERS = new Set(['cloudflare', 'modal', 'e2b']);

export function isPublicCloudRunProvider(value: string): value is PublicCloudRunProvider {
  return (PUBLIC_CLOUD_RUN_PROVIDERS as readonly string[]).includes(value);
}

export function coercePublicCloudRunProvider(value: string | undefined): PublicCloudRunProvider {
  if (value && isPublicCloudRunProvider(value)) return value;
  if (value && RETIRED_CLOUD_RUN_PROVIDERS.has(value)) return 'daytona';
  return 'daytona';
}
