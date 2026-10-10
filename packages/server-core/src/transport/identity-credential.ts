/**
 * e2.2 — ROX identity credential resolution for the device-auth challenge.
 *
 * The device-auth proof is keyed by the EXISTING ROX identity: the identity
 * store's installation profile (`@rox/core/platform/identity`). No new key
 * material is minted — the credential is a canonical projection of the profile
 * the store already persists, so the server and a same-installation client
 * derive the identical value without a shared secret file.
 *
 * Node-only (reads the store from disk); the browser renderer receives the
 * resolved value through `WsRpcClientOptions.identityCredential`.
 */

import { getIdentityStore } from '@rox/core/platform/identity/store'
import { resolveConfigDir } from '@rox/shared/config/paths'

/**
 * Resolve the ROX identity credential for `configDir` (default: the process
 * config directory). Deterministic for a given installation.
 */
export function resolveRoxIdentityCredential(configDir?: string): string {
  const profile = getIdentityStore(configDir ?? resolveConfigDir()).getProfile()
  return `rox-identity:${profile.id}:${profile.mode}`
}