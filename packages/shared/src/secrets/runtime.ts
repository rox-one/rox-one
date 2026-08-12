/**
 * Secrets Runtime Bridge
 *
 * Connects config `runtime.secretRefs` to the spawn-time env fragment that
 * `getRuntimeEnvOverrides()` merges. Called at session spawn (SessionManager)
 * so every backend (claude / pi / omp) inherits freshly resolved secrets.
 *
 * Contract: never throws. Failures surface in the returned diagnostics and
 * the previous fragment stays in place.
 */

import { getRuntimeSecretRefs, setRuntimeSecretEnvFragment } from '../config/storage.ts';
import { debug } from '../utils/debug.ts';
import { resolveSecretsForSpawn, type ResolveSecretsOptions } from './chain.ts';
import { redactRegisteredSecrets } from './redact.ts';
import type { ResolveSecretsResult, SecretRefEntry } from './types.ts';

export interface RefreshRuntimeSecretEnvOptions extends ResolveSecretsOptions {
  /** Refs to resolve. Default: persisted config runtime.secretRefs. */
  refs?: SecretRefEntry[];
}

export async function refreshRuntimeSecretEnv(
  options: RefreshRuntimeSecretEnvOptions = {},
): Promise<ResolveSecretsResult> {
  try {
    const refs = options.refs ?? getRuntimeSecretRefs();
    const result = await resolveSecretsForSpawn(refs, {}, options);
    setRuntimeSecretEnvFragment(result.env);
    return result;
  } catch (error) {
    // Fail-safe: keep the last-known fragment, never break a spawn.
    debug(
      `[secrets] refresh failed, keeping previous fragment: ${redactRegisteredSecrets(
        error instanceof Error ? error.message : String(error),
      )}`,
    );
    return { env: {}, diagnostics: [], values: [] };
  }
}
