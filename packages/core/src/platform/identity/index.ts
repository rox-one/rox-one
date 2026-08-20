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
} from './types.ts';

export {
  IdentityStore,
  getIdentityStore,
  resetIdentityStoreCache,
  createDefaultProfile,
} from './store.ts';
export type { IdentityStoreOptions } from './store.ts';

export type {
  CredentialKind,
  CredentialRef,
  CredentialRefId,
  CredentialRefIdFactory,
  CredentialRefRegistryOptions,
  CredentialVersion,
  CredentialVersionStatus,
  ProviderLocator,
  RegisterCredentialRefInput,
  RegisterCredentialVersionInput,
  StorageMode,
} from './credential-types.ts';
export {
  CredentialRefRegistry,
  createCredentialRefId,
  isCredentialKind,
  isCredentialRefId,
  isStorageMode,
} from './credential-types.ts';

export type {
  AccountDiscoveryInput,
  ConnectionFabricErrorCode,
  CredentialImporter,
  DeliveryMechanism,
  ExternalAccount,
  FabricExecutionContext,
  HealthCheck,
  ImportCandidate,
  ImportCommitInput,
  ImportCommitResult,
  ImportDiscoveryInput,
  ImportPreview,
  ImportPreviewInput,
  ImportRollbackInput,
  ImportValidationInput,
  ImportValidationResult,
  IntegrationDefinition,
  P0ImporterId,
  ProviderCapabilities,
  ProviderCredentialMetadata,
  ProviderHealthInput,
  ProviderLeaseInput,
  ProviderMaterialization,
  ProviderRevokeInput,
  ProviderRotateInput,
  ProviderWriteInput,
  SealedSecret,
  SecretProvider,
} from './provider-contract.ts';
export {
  ConnectionFabricError,
  P0_IMPORTER_IDS,
  P0_PROVIDER_CAPABILITIES,
} from './provider-contract.ts';

export type { ImportConflict, ImportPhase } from './import-session.ts';
export { ImportSession } from './import-session.ts';

export type { CommittedImportRecord, ImportServiceOptions } from './import-service.ts';
export { ImportService } from './import-service.ts';

export type { DiscoveryHost, LegacyMetadataItem } from './p0-adapters.ts';
export {
  LocalMemorySecretProvider,
  createP0Importers,
  createP0ProviderStack,
  createSealedSecret,
  extractDotenvKeys,
  metadataFingerprint,
  parseAwsConfig,
  parseDockerConfig,
  parseGitCredentialConfig,
  redactGcpAdcPreview,
  unsealSecret,
} from './p0-adapters.ts';
export type { OsDiscoveryHostOptions } from './os-discovery-host.ts';
export { createOsDiscoveryHost } from './os-discovery-host.ts';

export type { AccessGrant, AccessGrantStatus } from './grants.ts';
export { JsonAccessGrantStore } from './grants.ts';
export type {
  AcquireLeaseInput,
  ConsumerIdentity,
  ConsumerKind,
  CredentialLease,
  DeliveryDescriptor,
  ExecuteTrustedHttpInput,
  InProcessCredentialBrokerOptions,
  TrustedHttpFetch,
} from './broker.ts';
export { InProcessCredentialBroker } from './broker.ts';
export type {
  BindConsumerInput,
  ConnectionAuditRecord,
  ConnectionBindingRecord,
  ConnectionRecord,
  CreateConnectionInput,
} from './workgraph.ts';
export { ConnectionWorkGraph } from './workgraph.ts';
export { revokeConnectionAndRevalidate } from './revalidation.ts';

export type {
  FetchLike as GithubFetchLike,
  GithubImportResult,
  GithubProviderStack,
  GithubVerticalResult,
  ImportGithubFromEnvOptions,
  RunGithubVerticalInput,
} from './github-vertical.ts';
export { importGithubFromEnv, runGithubVertical } from './github-vertical.ts';

export type {
  FetchLike as InfisicalFetchLike,
  InfisicalFabricProviderOptions,
} from './infisical-fabric-provider.ts';
export { InfisicalFabricProvider, createInfisicalImporter } from './infisical-fabric-provider.ts';
