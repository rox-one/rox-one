/**
 * Secret Provider Chain
 *
 * `resolveSecretsForSpawn` resolves configured secret ref entries through the
 * provider chain (default order: environment → local-encrypted → infisical)
 * and returns an env fragment to merge into the agent subprocess env.
 *
 * Contract:
 * - Never throws. Per-entry failures land in `diagnostics` (value-free).
 * - `null` from a provider means "not found" → try the next one.
 * - A pinned entry (`provider` set) only consults that provider; it is
 *   called even when unavailable so it can raise its typed error
 *   (e.g. InfisicalProvider → INFISICAL_UNAVAILABLE when unconfigured).
 */

import { debug } from '../utils/debug.ts';
import { ENV_OVERRIDE_DENY } from '../config/storage.ts';
import { redactRegisteredSecrets, registerSecretValues } from './redact.ts';
import { EnvironmentProvider } from './providers/environment.ts';
import { LocalEncryptedProvider } from './providers/local.ts';
import { InfisicalProvider } from './providers/infisical.ts';
import {
  SecretResolveError,
  type ResolveSecretsResult,
  type SecretProvider,
  type SecretProviderId,
  type SecretRefEntry,
  type SecretResolutionDiagnostic,
} from './types.ts';

/** Optional context describing where the resolved env fragment will be injected. */
export interface ResolveTarget {
  /** Env the default EnvironmentProvider reads from. Default: process.env. */
  env?: Record<string, string | undefined>;
}

export interface ResolveSecretsOptions {
  /** Provider instances to use. Default: defaultProviderChain(target). */
  providers?: SecretProvider[];
  /** Chain order (subset/reordering of provider ids). Default: SECRET_PROVIDER_IDS order. */
  order?: SecretProviderId[];
}

/** Default chain: environment → local-encrypted → infisical. */
export function defaultProviderChain(target: ResolveTarget = {}): SecretProvider[] {
  return [
    new EnvironmentProvider({ env: target.env }),
    new LocalEncryptedProvider(),
    new InfisicalProvider(),
  ];
}

function orderProviders(providers: SecretProvider[], order?: SecretProviderId[]): SecretProvider[] {
  if (!order) return providers;
  const byId = new Map(providers.map((p) => [p.id, p]));
  const ordered: SecretProvider[] = [];
  for (const id of order) {
    const provider = byId.get(id);
    if (provider) ordered.push(provider);
  }
  return ordered;
}

export async function resolveSecretsForSpawn(
  entries: SecretRefEntry[],
  target: ResolveTarget = {},
  options: ResolveSecretsOptions = {},
): Promise<ResolveSecretsResult> {
  const providers = orderProviders(options.providers ?? defaultProviderChain(target), options.order);
  const env: Record<string, string> = {};
  const values: string[] = [];
  const diagnostics: SecretResolutionDiagnostic[] = [];

  for (const entry of entries) {
    // Resolution-time denylist: config.json can be edited directly, bypassing
    // the setRuntimeSecretRefs setter validation. A denied envVar (PATH,
    // NODE_OPTIONS, CRAFT_*…) must never receive a resolved secret — refuse
    // the entry here, at the one choke point every intake path crosses.
    if (ENV_OVERRIDE_DENY[entry.envVar]) {
      diagnostics.push({
        name: entry.name,
        envVar: entry.envVar,
        status: 'error',
        errorCode: 'SECRET_ENVVAR_DENIED',
        message: `envVar "${entry.envVar}" is denied for secret injection`,
      });
      continue;
    }

    const candidates = entry.provider
      ? providers.filter((p) => p.id === entry.provider)
      : providers;

    let resolved = false;
    let lastError: SecretResolveError | null = null;

    for (const provider of candidates) {
      // Unpinned entries skip unavailable providers silently; pinned entries
      // go straight to resolve() so the provider's typed error surfaces.
      // A broken isAvailable() is treated as "unavailable", never fatal.
      if (!entry.provider) {
        let available = false;
        try {
          available = await provider.isAvailable();
        } catch {
          available = false;
        }
        if (!available) continue;
      }
      try {
        const value = await provider.resolve({ name: entry.name, ref: entry.ref });
        if (value !== null) {
          env[entry.envVar] = value;
          values.push(value);
          diagnostics.push({ name: entry.name, envVar: entry.envVar, status: 'resolved', provider: provider.id });
          resolved = true;
          break;
        }
      } catch (error) {
        lastError =
          error instanceof SecretResolveError
            ? error
            : new SecretResolveError('INFISICAL_UNAVAILABLE', provider.id, error instanceof Error ? error.message : String(error));
        if (entry.provider) break; // pinned: no fallback
      }
    }

    if (!resolved) {
      if (lastError) {
        // An available provider failed operationally — surface that, not a
        // misleading "not found".
        diagnostics.push({
          name: entry.name,
          envVar: entry.envVar,
          status: 'error',
          provider: lastError.provider,
          errorCode: lastError.code,
          message: lastError.message,
        });
      } else {
        diagnostics.push({ name: entry.name, envVar: entry.envVar, status: 'not-found', errorCode: 'SECRET_NOT_FOUND' });
      }
    }
  }

  // Register resolved values for redaction, then log a redacted summary.
  registerSecretValues(values);
  for (const d of diagnostics) {
    debug(
      `[secrets] ${d.name} → ${d.envVar}: ${redactRegisteredSecrets(
        d.status === 'resolved' ? `resolved via ${d.provider}` : `${d.status}${d.errorCode ? ` (${d.errorCode})` : ''}${d.message ? ` — ${d.message}` : ''}`,
      )}`,
    );
  }

  return { env, diagnostics, values };
}
