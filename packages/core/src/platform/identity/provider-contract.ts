/**
 * SecretProvider / CredentialImporter contracts (Connection Fabric CF-3).
 *
 * Interfaces only. Broker, leases, WorkGraph, and renderer RPC stay in later
 * PRs. ProviderMaterialization must not be serialized into renderer or
 * WorkGraph responses.
 */

import type {
  CredentialKind,
  CredentialRef,
  CredentialRefId,
  CredentialVersion,
  ProviderLocator,
  StorageMode,
} from './credential-types.ts';

export type FabricExecutionContext = 'main' | 'renderer' | 'remote' | 'headless';

export type ConnectionFabricErrorCode =
  | 'IMPORT_CONTEXT_DENIED'
  | 'IMPORT_STATE_INVALID'
  | 'IMPORT_ACCESS_DENIED'
  | 'IMPORT_CANDIDATE_UNKNOWN'
  | 'IMPORT_CONFLICT'
  | 'IMPORT_MODE_UNSUPPORTED'
  | 'IMPORT_VALIDATION_FAILED'
  | 'IMPORT_PROVIDER_WRITE_FAILED'
  | 'IMPORT_ROLLBACK_REQUIRED'
  | 'PROVIDER_OPERATION_UNSUPPORTED'
  | 'PROVIDER_LEASE_RESERVED'
  | 'PROVIDER_UNAVAILABLE'
  | 'GRANT_MISSING'
  | 'LEASE_DENIED'
  | 'LEASE_REVOKED'
  | 'DELIVERY_UNSUPPORTED'
  | 'REPAIR_REQUIRED';

const MAX_ERROR_LABEL_LENGTH = 64;

export function fabricErrorLabel(value: unknown): string {
  const text = typeof value === 'string' ? value : String(value);
  return text.length > MAX_ERROR_LABEL_LENGTH
    ? `${text.slice(0, MAX_ERROR_LABEL_LENGTH)}...`
    : text;
}

export class ConnectionFabricError extends Error {
  readonly code: ConnectionFabricErrorCode;

  constructor(code: ConnectionFabricErrorCode, detail?: string) {
    super(detail ? `${code}: ${fabricErrorLabel(detail)}` : code);
    this.name = 'ConnectionFabricError';
    this.code = code;
  }
}

export interface ProviderCapabilities {
  readonly kinds: readonly CredentialKind[];
  readonly modes: readonly StorageMode[];
  readonly supportsRotation: boolean;
  readonly supportsRevoke: boolean;
  readonly supportsHealth: boolean;
  readonly supportsVersioning: boolean;
  readonly supportsReference: boolean;
}

export type DeliveryMechanism =
  | 'trusted-http-header'
  | 'proxy'
  | 'mcp-tool-host'
  | 'git-credential-helper'
  | 'docker-credential-helper'
  | 'aws-credential-process'
  | 'ssh-agent'
  | 'stdin'
  | 'fd'
  | 'temporary-file'
  | 'browser-partition'
  | 'env-legacy';

export interface IntegrationDefinition {
  readonly id: string;
  readonly providerKind: string;
  readonly displayName: string;
  readonly supportedKinds: readonly CredentialKind[];
  readonly deliveryMechanisms: readonly DeliveryMechanism[];
  readonly capabilities: ProviderCapabilities;
}

export interface ExternalAccount {
  readonly id: string;
  readonly providerId: string;
  readonly tenant?: string;
  readonly displayName?: string;
  readonly status: 'connected' | 'expired' | 'error' | 'disconnected';
}

export interface ProviderCredentialMetadata {
  readonly kind: CredentialKind;
  readonly locator: ProviderLocator;
  readonly expiresAt?: number;
  readonly hasMaterial: boolean;
}

export interface AccountDiscoveryInput {
  readonly workspaceId: string;
}

export interface ProviderLeaseInput {
  readonly credentialRef: CredentialRef;
  readonly purpose: string;
}

/**
 * Broker-only handle. Must not be JSON-serialized to renderer/WorkGraph.
 * The brand exists so a leaked object is still not a raw secret.
 */
export interface ProviderMaterialization {
  readonly _brand: 'ProviderMaterialization';
  readonly credentialRefId: CredentialRefId;
  readonly providerId: string;
  readonly versionId: string;
}

export interface ProviderWriteInput {
  readonly kind: CredentialKind;
  readonly mode: StorageMode;
  readonly locator: ProviderLocator;
  readonly workspaceId: string;
  readonly requestedBy: string;
  readonly credentialRefId?: CredentialRefId;
  readonly sealedCopy?: SealedSecret;
  readonly versionFingerprint?: string;
  readonly expiresAt?: number;
}

export interface ProviderRevokeInput {
  readonly credentialRef: CredentialRef;
}

export interface ProviderRotateInput {
  readonly credentialRef: CredentialRef;
}

export interface ProviderHealthInput {
  readonly credentialRef: CredentialRef;
}

export interface HealthCheck {
  readonly id: string;
  readonly status: 'healthy' | 'expired' | 'unauthorized' | 'unreachable' | 'invalid';
  readonly detailCode?: string;
  readonly checkedAt: number;
}

/**
 * Copy-mode payload that never appears on inspect/preview/import results.
 * Created only after OS/provider access is granted.
 */
export interface SealedSecret {
  readonly _brand: 'SealedSecret';
  readonly kind: CredentialKind;
}

export interface SecretProvider {
  readonly id: string;
  readonly definition: IntegrationDefinition;
  discoverAccount(input: AccountDiscoveryInput): Promise<ExternalAccount>;
  inspect(ref: CredentialRef): Promise<ProviderCredentialMetadata>;
  resolveForLease(input: ProviderLeaseInput): Promise<ProviderMaterialization>;
  write(input: ProviderWriteInput): Promise<CredentialVersion>;
  revoke(input: ProviderRevokeInput): Promise<void>;
  rotate(input: ProviderRotateInput): Promise<CredentialVersion>;
  health(input: ProviderHealthInput): Promise<HealthCheck>;
}

export interface ImportCandidate {
  readonly id: string;
  readonly sourceId: string;
  readonly kind: CredentialKind;
  readonly label: string;
  readonly locator?: ProviderLocator;
  readonly fingerprint?: string;
  readonly expiresAt?: number;
  readonly conflictKey: string;
}

export interface ImportPreview {
  readonly candidateId: string;
  readonly inferredKind: CredentialKind;
  readonly targetProviderId: string;
  readonly proposedMode: StorageMode;
  readonly maskedSummary: string;
  readonly warnings: readonly string[];
}

export interface ImportDiscoveryInput {
  readonly sourceId: string;
  readonly workspaceId: string;
}

export interface ImportPreviewInput {
  readonly candidateId: string;
  readonly targetProviderId: string;
}

export interface ImportValidationInput {
  readonly candidateId: string;
  readonly targetProviderId: string;
  readonly mode: StorageMode;
}

export interface ImportValidationResult {
  readonly ok: boolean;
  readonly errorCode?: ConnectionFabricErrorCode;
  readonly warnings: readonly string[];
}

export interface ImportCommitInput {
  readonly candidateId: string;
  readonly targetProviderId: string;
  readonly mode: StorageMode;
  readonly workspaceId: string;
  readonly requestedBy: string;
  readonly credentialRefId?: CredentialRefId;
  readonly versionFingerprint?: string;
  readonly sealedCopy?: SealedSecret;
}

export interface ImportCommitResult {
  readonly credentialRefId: CredentialRefId;
  readonly versionId: string;
  readonly mode: StorageMode;
  readonly reusedExisting: boolean;
  readonly warnings: readonly string[];
}

export interface ImportRollbackInput {
  readonly commit?: ImportCommitResult;
  readonly candidateId?: string;
}

export interface CredentialImporter {
  readonly id: string;
  readonly sourceKind: string;
  discover(input: ImportDiscoveryInput): Promise<ImportCandidate[]>;
  preview(input: ImportPreviewInput): Promise<ImportPreview>;
  validate(input: ImportValidationInput): Promise<ImportValidationResult>;
  commit(input: ImportCommitInput): Promise<ImportCommitResult>;
  rollback(input: ImportRollbackInput): Promise<void>;
}

const ALL_KINDS: readonly CredentialKind[] = [
  'api_key',
  'oauth2_token_set',
  'bearer_token',
  'basic_auth',
  'aws_credential_source',
  'gcp_adc',
  'ssh_agent_identity',
  'x509_identity',
  'opaque_bundle',
  'browser_session',
];

const LOCAL_MODES: readonly StorageMode[] = ['reference', 'copy', 'ephemeral'];

/** Spec capability matrix, first-phase P0 only. Not a permission grant. */
export const P0_PROVIDER_CAPABILITIES = {
  'legacy-local': {
    kinds: ALL_KINDS,
    modes: LOCAL_MODES,
    supportsRotation: false,
    supportsRevoke: true,
    supportsHealth: true,
    supportsVersioning: true,
    supportsReference: true,
  },
  'macos-keychain': {
    kinds: ALL_KINDS,
    modes: ['reference', 'copy', 'ephemeral'] as const,
    supportsRotation: false,
    supportsRevoke: true,
    supportsHealth: true,
    supportsVersioning: true,
    supportsReference: true,
  },
  'git-credential': {
    kinds: ['basic_auth', 'bearer_token', 'opaque_bundle'] as const,
    modes: ['reference', 'copy'] as const,
    supportsRotation: false,
    supportsRevoke: true,
    supportsHealth: true,
    supportsVersioning: false,
    supportsReference: true,
  },
  'docker-credential': {
    kinds: ['basic_auth', 'bearer_token', 'opaque_bundle'] as const,
    modes: ['reference', 'copy'] as const,
    supportsRotation: false,
    supportsRevoke: true,
    supportsHealth: true,
    supportsVersioning: false,
    supportsReference: true,
  },
  'aws-profile': {
    kinds: ['aws_credential_source'] as const,
    modes: ['reference', 'copy', 'ephemeral'] as const,
    supportsRotation: false,
    supportsRevoke: true,
    supportsHealth: true,
    supportsVersioning: true,
    supportsReference: true,
  },
  'gcp-adc': {
    kinds: ['gcp_adc'] as const,
    modes: ['reference', 'copy', 'ephemeral'] as const,
    supportsRotation: false,
    supportsRevoke: true,
    supportsHealth: true,
    supportsVersioning: true,
    supportsReference: true,
  },
  'ssh-agent': {
    kinds: ['ssh_agent_identity'] as const,
    modes: ['reference'] as const,
    supportsRotation: false,
    supportsRevoke: true,
    supportsHealth: true,
    supportsVersioning: false,
    supportsReference: true,
  },
} as const satisfies Record<string, ProviderCapabilities>;

export const P0_IMPORTER_IDS = [
  'legacy-local',
  'dotenv',
  'macos-keychain',
  'git-credential',
  'docker-credential',
  'aws-profile',
  'gcp-adc',
  'ssh-agent',
] as const;

export type P0ImporterId = (typeof P0_IMPORTER_IDS)[number];
