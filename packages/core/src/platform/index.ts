/**
 * @craft-agent/core — platform layer.
 *
 * Pure-TS registries and model for the unified shell (spec suite
 * 2026-08-07-unified-shell): panels & rails (S-03), surface tabs (S-02),
 * commands (S-04 §3.5), resources (S-04 §3.6), context keys & the when-language
 * (S-04 §3.7, S-03 §3.9). React hosts and URL truth live in the renderer; this
 * layer has zero app deps.
 */

export type { Disposable } from './types.ts';
export * from './context-keys/index.ts';
export * from './panels/index.ts';
export * from './modes/index.ts';
export * from './workbench/index.ts';
export * from './commands/index.ts';
export * from './resources/index.ts';
export * from './surfaces/index.ts';
export type {
  Profile,
  ProfileMode,
  WorkspaceMembership,
  WorkspaceRole,
  ServiceConnection,
  ServiceConnectionStatus,
  ServiceProvider,
  Entitlement,
  EntitlementStatus,
  IdentityState,
  IdentityFile,
  UpdateProfileInput,
  ConnectServiceInput,
  DisconnectServiceInput,
} from './identity/types.ts';

export type {
  CredentialKind,
  CredentialRef,
  CredentialRefId,
  CredentialRefIdFactory,
  CredentialVersion,
  CredentialVersionStatus,
  ProviderLocator,
  RegisterCredentialRefInput,
  RegisterCredentialVersionInput,
  StorageMode,
} from './identity/credential-types.ts';
export {
  CredentialRefRegistry,
  createCredentialRefId,
  isCredentialKind,
  isCredentialRefId,
  isStorageMode,
} from './identity/credential-types.ts';
export type {
  CredentialImporter,
  FabricExecutionContext,
  ImportCandidate,
  ImportPreview,
  ProviderCapabilities,
  SecretProvider,
} from './identity/provider-contract.ts';
export {
  ConnectionFabricError,
  P0_IMPORTER_IDS,
  P0_PROVIDER_CAPABILITIES,
} from './identity/provider-contract.ts';
export { ImportSession } from './identity/import-session.ts';
export { ImportService } from './identity/import-service.ts';
export {
  LocalMemorySecretProvider,
  createP0ProviderStack,
  createSealedSecret,
  extractDotenvKeys,
} from './identity/p0-adapters.ts';
export { JsonAccessGrantStore } from './identity/grants.ts';
export { InProcessCredentialBroker } from './identity/broker.ts';
