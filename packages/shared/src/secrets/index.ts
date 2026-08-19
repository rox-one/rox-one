/**
 * Secrets module — scoped secret providers + spawn-time env injection.
 * See docs/secrets-providers.md.
 */

export {
  SECRET_PROVIDER_IDS,
  SecretRefEntrySchema,
  SecretResolveError,
  SecretConfigError,
  toPublicSecretRef,
  type SecretProviderId,
  type SecretRefEntry,
  type SecretRef,
  type SecretProvider,
  type SecretErrorCode,
  type SecretResolutionDiagnostic,
  type ResolveSecretsResult,
} from './types.ts';

export {
  REDACTED_PLACEHOLDER,
  redactSecrets,
  registerSecretValues,
  redactRegisteredSecrets,
  clearRegisteredSecretValues,
} from './redact.ts';

export { EnvironmentProvider, defaultEnvironmentRefFor, DEFAULT_ENV_PREFIXES } from './providers/environment.ts';
export { LocalEncryptedProvider, defaultLocalRefFor } from './providers/local.ts';
export { InfisicalProvider, type InfisicalProviderOptions, type FetchLike } from './providers/infisical.ts';

export {
  resolveSecretsForSpawn,
  defaultProviderChain,
  type ResolveTarget,
  type ResolveSecretsOptions,
} from './chain.ts';

export { refreshRuntimeSecretEnv, type RefreshRuntimeSecretEnvOptions } from './runtime.ts';

export {
  diagnoseInfisicalAvailability,
  type InfisicalAvailability,
  type SecretRefsSettingsPayload,
} from './availability.ts';
