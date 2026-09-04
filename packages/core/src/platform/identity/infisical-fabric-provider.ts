/**
 * CF-8 Infisical SecretProvider adapter (Connection Fabric contract).
 *
 * Distinct from packages/shared spawn-env InfisicalProvider. This adapter
 * stores locator metadata only; resolveForLease returns a branded handle.
 * Raw secret values never appear on inspect/health/write results.
 */

import { createHash } from 'node:crypto';
import {
  createCredentialRefId,
  type CredentialRef,
  type CredentialVersion,
  type ProviderLocator,
  type StorageMode,
} from './credential-types.ts';
import {
  ConnectionFabricError,
  type AccountDiscoveryInput,
  type CredentialImporter,
  type ExternalAccount,
  type HealthCheck,
  type ImportCandidate,
  type IntegrationDefinition,
  type ProviderCredentialMetadata,
  type ProviderHealthInput,
  type ProviderLeaseInput,
  type ProviderMaterialization,
  type ProviderRevokeInput,
  type ProviderRotateInput,
  type ProviderWriteInput,
  type SecretProvider,
} from './provider-contract.ts';

export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

const DEFAULT_BASE_URL = 'https://app.infisical.com';
const SUPPORTED_MODES: readonly StorageMode[] = ['reference', 'copy', 'mirror', 'managed', 'ephemeral'];

export interface InfisicalFabricProviderOptions {
  readonly baseUrl?: string;
  /** Machine-identity / service token — never exposed via inspect. */
  readonly token?: string;
  readonly projectId?: string;
  readonly environment?: string;
  readonly secretPath?: string;
  readonly fetch?: FetchLike;
  readonly now?: () => number;
}

interface StoredCredential {
  readonly locator: Extract<ProviderLocator, { type: 'infisical' }>;
  readonly kind: ProviderWriteInput['kind'];
  readonly mode: StorageMode;
  readonly version: CredentialVersion;
  readonly hasMaterial: boolean;
}

function locatorKey(locator: ProviderLocator): string {
  if (locator.type !== 'infisical') {
    throw new ConnectionFabricError('IMPORT_VALIDATION_FAILED', 'locator.type');
  }
  return `infisical:${locator.projectId}:${locator.environment}:${locator.secretPath}:${locator.secretKey}`;
}

function requireInfisicalLocator(
  locator: ProviderLocator,
): Extract<ProviderLocator, { type: 'infisical' }> {
  if (locator.type !== 'infisical') {
    throw new ConnectionFabricError('IMPORT_VALIDATION_FAILED', 'locator.type');
  }
  return locator;
}

function fingerprint(parts: readonly string[]): string {
  const hash = createHash('sha256');
  for (const part of parts) {
    hash.update(String(part.length));
    hash.update(':');
    hash.update(part);
    hash.update('\0');
  }
  return hash.digest('hex');
}

export class InfisicalFabricProvider implements SecretProvider {
  readonly id = 'infisical';
  readonly definition: IntegrationDefinition;

  private readonly baseUrl: string;
  private readonly token: string | undefined;
  private readonly defaultProjectId: string | undefined;
  private readonly defaultEnvironment: string | undefined;
  private readonly defaultSecretPath: string;
  private readonly fetchImpl: FetchLike | undefined;
  private readonly now: () => number;
  private readonly store = new Map<string, StoredCredential>();
  private sequence = 0;

  constructor(options: InfisicalFabricProviderOptions = {}) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.token = options.token;
    this.defaultProjectId = options.projectId;
    this.defaultEnvironment = options.environment;
    this.defaultSecretPath = options.secretPath ?? '/';
    this.fetchImpl = options.fetch;
    this.now = options.now ?? Date.now;
    this.definition = {
      id: 'infisical',
      providerKind: 'infisical',
      displayName: 'Infisical',
      supportedKinds: ['api_key', 'bearer_token', 'opaque_bundle', 'basic_auth'],
      deliveryMechanisms: ['trusted-http-header', 'proxy', 'env-legacy'],
      capabilities: {
        kinds: ['api_key', 'bearer_token', 'opaque_bundle', 'basic_auth'],
        modes: SUPPORTED_MODES,
        supportsRotation: true,
        supportsRevoke: true,
        supportsHealth: true,
        supportsVersioning: true,
        supportsReference: true,
      },
    };
  }

  async discoverAccount(input: AccountDiscoveryInput): Promise<ExternalAccount> {
    if (this.fetchImpl && this.token) {
      const response = await this.fetchImpl(`${this.baseUrl}/api/v1/auth/token`, {
        method: 'GET',
        headers: this.authHeaders(),
      });
      if (response.status === 401 || response.status === 403) {
        throw new ConnectionFabricError('PROVIDER_UNAVAILABLE', `infisical auth ${response.status}`);
      }
      if (!response.ok) {
        throw new ConnectionFabricError('PROVIDER_UNAVAILABLE', `infisical HTTP ${response.status}`);
      }
    }

    const configured = Boolean(this.token && (this.defaultProjectId || input.workspaceId));
    return {
      id: `acct_infisical_${input.workspaceId}`,
      providerId: this.id,
      tenant: this.defaultProjectId ?? input.workspaceId,
      displayName: 'Infisical',
      status: configured ? 'connected' : 'disconnected',
    };
  }

  async inspect(ref: CredentialRef): Promise<ProviderCredentialMetadata> {
    const stored = this.store.get(locatorKey(ref.locator));
    if (!stored) throw new ConnectionFabricError('PROVIDER_UNAVAILABLE', ref.id);
    return {
      kind: stored.kind,
      locator: { ...stored.locator },
      hasMaterial: stored.hasMaterial,
      ...(stored.version.expiresAt !== undefined ? { expiresAt: stored.version.expiresAt } : {}),
    };
  }

  async resolveForLease(input: ProviderLeaseInput): Promise<ProviderMaterialization> {
    const stored = this.store.get(locatorKey(input.credentialRef.locator));
    if (!stored) throw new ConnectionFabricError('PROVIDER_UNAVAILABLE', input.credentialRef.id);
    return {
      _brand: 'ProviderMaterialization',
      credentialRefId: input.credentialRef.id,
      providerId: this.id,
      versionId: stored.version.id,
    };
  }

  async write(input: ProviderWriteInput): Promise<CredentialVersion> {
    if (!SUPPORTED_MODES.includes(input.mode)) {
      throw new ConnectionFabricError('IMPORT_MODE_UNSUPPORTED', input.mode);
    }
    const locator = requireInfisicalLocator(input.locator);
    const credentialRefId = input.credentialRefId ?? createCredentialRefId();
    const version: CredentialVersion = {
      id: `ver_${++this.sequence}`,
      credentialRefId,
      codec: 'infisical-locator/v1',
      fingerprint:
        input.versionFingerprint ??
        fingerprint([
          this.id,
          locator.projectId,
          locator.environment,
          locator.secretPath,
          locator.secretKey,
          input.mode,
        ]),
      createdAt: this.now(),
      status: 'active',
      ...(input.expiresAt !== undefined ? { expiresAt: input.expiresAt } : {}),
    };
    this.store.set(locatorKey(locator), {
      locator: { ...locator },
      kind: input.kind,
      mode: input.mode,
      version,
      // Locator points at provider-held material; never embed the raw secret.
      hasMaterial: true,
    });
    return { ...version };
  }

  async revoke(input: ProviderRevokeInput): Promise<void> {
    const locator = requireInfisicalLocator(input.credentialRef.locator);
    if (this.fetchImpl && this.token) {
      const url = this.secretUrl(locator);
      const response = await this.fetchImpl(url, {
        method: 'DELETE',
        headers: this.authHeaders(),
      });
      if (response.status === 401 || response.status === 403) {
        throw new ConnectionFabricError('PROVIDER_UNAVAILABLE', `infisical auth ${response.status}`);
      }
      if (response.status !== 200 && response.status !== 204 && response.status !== 404) {
        throw new ConnectionFabricError('PROVIDER_UNAVAILABLE', `infisical HTTP ${response.status}`);
      }
    }
    this.store.delete(locatorKey(locator));
    for (const [key, stored] of this.store) {
      if (stored.version.credentialRefId === input.credentialRef.id) {
        this.store.delete(key);
      }
    }
  }

  async rotate(input: ProviderRotateInput): Promise<CredentialVersion> {
    if (!this.fetchImpl || !this.token) {
      throw new ConnectionFabricError('PROVIDER_OPERATION_UNSUPPORTED', 'rotate');
    }
    const locator = requireInfisicalLocator(input.credentialRef.locator);
    const stored = this.store.get(locatorKey(locator));
    if (!stored) throw new ConnectionFabricError('PROVIDER_UNAVAILABLE', input.credentialRef.id);

    const response = await this.fetchImpl(this.secretUrl(locator), {
      method: 'POST',
      headers: {
        ...this.authHeaders(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        workspaceId: locator.projectId,
        environment: locator.environment,
        secretPath: locator.secretPath,
        secretKey: locator.secretKey,
        type: 'shared',
      }),
    });
    if (response.status === 401 || response.status === 403) {
      throw new ConnectionFabricError('PROVIDER_UNAVAILABLE', `infisical auth ${response.status}`);
    }
    if (!response.ok) {
      throw new ConnectionFabricError('PROVIDER_UNAVAILABLE', `infisical HTTP ${response.status}`);
    }

    const version: CredentialVersion = {
      id: `ver_${++this.sequence}`,
      credentialRefId: input.credentialRef.id,
      codec: 'infisical-locator/v1',
      fingerprint: fingerprint([
        this.id,
        'rotate',
        locator.projectId,
        locator.environment,
        locator.secretPath,
        locator.secretKey,
        String(this.now()),
      ]),
      createdAt: this.now(),
      status: 'active',
    };
    this.store.set(locatorKey(locator), {
      ...stored,
      version,
      hasMaterial: true,
    });
    return { ...version };
  }

  async health(input: ProviderHealthInput): Promise<HealthCheck> {
    const checkedAt = this.now();
    const key = locatorKey(input.credentialRef.locator);
    const stored = this.store.get(key);
    if (!stored) {
      return { id: `health_${this.id}`, status: 'unreachable', detailCode: 'PROVIDER_UNAVAILABLE', checkedAt };
    }

    if (!this.fetchImpl || !this.token) {
      return { id: `health_${this.id}`, status: 'healthy', checkedAt };
    }

    const locator = requireInfisicalLocator(input.credentialRef.locator);
    let response: Response;
    try {
      response = await this.fetchImpl(this.rawSecretUrl(locator), {
        method: 'GET',
        headers: this.authHeaders(),
      });
    } catch {
      return { id: `health_${this.id}`, status: 'unreachable', detailCode: 'PROVIDER_UNAVAILABLE', checkedAt };
    }

    if (response.status === 401 || response.status === 403) {
      throw new ConnectionFabricError('PROVIDER_UNAVAILABLE', `infisical auth ${response.status}`);
    }
    if (response.status === 404) {
      return { id: `health_${this.id}`, status: 'invalid', detailCode: 'PROVIDER_UNAVAILABLE', checkedAt };
    }
    if (!response.ok) {
      return { id: `health_${this.id}`, status: 'unreachable', detailCode: `HTTP_${response.status}`, checkedAt };
    }
    return { id: `health_${this.id}`, status: 'healthy', checkedAt };
  }

  private authHeaders(): Record<string, string> {
    if (!this.token) {
      throw new ConnectionFabricError('PROVIDER_UNAVAILABLE', 'infisical token');
    }
    return { Authorization: `Bearer ${this.token}` };
  }

  private secretUrl(locator: Extract<ProviderLocator, { type: 'infisical' }>): string {
    const params = new URLSearchParams({
      workspaceId: locator.projectId,
      environment: locator.environment,
      secretPath: locator.secretPath,
    });
    return `${this.baseUrl}/api/v3/secrets/${encodeURIComponent(locator.secretKey)}?${params.toString()}`;
  }

  private rawSecretUrl(locator: Extract<ProviderLocator, { type: 'infisical' }>): string {
    const params = new URLSearchParams({
      workspaceId: locator.projectId,
      environment: locator.environment,
      secretPath: locator.secretPath,
    });
    return `${this.baseUrl}/api/v3/secrets/raw/${encodeURIComponent(locator.secretKey)}?${params.toString()}`;
  }
}

export interface InfisicalImporterEnv {
  readonly INFISICAL_PROJECT_ID?: string;
  readonly INFISICAL_ENVIRONMENT?: string;
  readonly INFISICAL_SECRET_PATH?: string;
  readonly INFISICAL_SECRET_KEY?: string;
}

/**
 * Metadata-only Infisical importer. Locators come from env; tokens never
 * appear on discover/preview/commit results.
 */
export function createInfisicalImporter(
  provider: InfisicalFabricProvider,
  env: InfisicalImporterEnv = process.env as InfisicalImporterEnv,
): CredentialImporter {
  let last: ImportCandidate | undefined;

  const fromEnv = (): ImportCandidate[] => {
    const projectId = env.INFISICAL_PROJECT_ID;
    const environment = env.INFISICAL_ENVIRONMENT;
    const secretPath = env.INFISICAL_SECRET_PATH ?? '/';
    const secretKey = env.INFISICAL_SECRET_KEY;
    if (!projectId || !environment) return [];
    const key = secretKey && secretKey.length > 0 ? secretKey : 'default';
    const locator: Extract<ProviderLocator, { type: 'infisical' }> = {
      type: 'infisical',
      projectId,
      environment,
      secretPath,
      secretKey: key,
    };
    return [
      {
        id: `infisical:${projectId}:${environment}:${secretPath}:${key}`,
        sourceId: 'infisical',
        kind: 'api_key',
        label: secretKey && secretKey.length > 0 ? secretKey : 'infisical',
        locator,
        conflictKey: `infisical:${projectId}:${environment}:${secretPath}:${key}`,
      },
    ];
  };

  return {
    id: 'infisical',
    sourceKind: 'infisical',
    async discover() {
      const candidates = fromEnv();
      last = candidates[0];
      return candidates;
    },
    async preview(input) {
      const candidate = last && last.id === input.candidateId ? last : fromEnv().find((item) => item.id === input.candidateId);
      if (!candidate) throw new ConnectionFabricError('IMPORT_CANDIDATE_UNKNOWN', input.candidateId);
      return {
        candidateId: candidate.id,
        inferredKind: candidate.kind,
        targetProviderId: input.targetProviderId,
        proposedMode: 'reference',
        maskedSummary: `${candidate.label}@${(candidate.locator as { projectId: string }).projectId}`,
        warnings: ['locator metadata only; secret stays in Infisical'],
      };
    },
    async validate(input) {
      const candidate = last && last.id === input.candidateId ? last : fromEnv().find((item) => item.id === input.candidateId);
      if (!candidate) {
        return { ok: false, errorCode: 'IMPORT_CANDIDATE_UNKNOWN', warnings: [] };
      }
      if (input.mode !== 'reference' && input.mode !== 'managed' && input.mode !== 'copy') {
        return { ok: false, errorCode: 'IMPORT_MODE_UNSUPPORTED', warnings: [] };
      }
      return { ok: true, warnings: ['copy is stored as a locator reference; secret stays in Infisical'] };
    },
    async commit(input) {
      const candidate = last && last.id === input.candidateId ? last : fromEnv().find((item) => item.id === input.candidateId);
      if (!candidate) throw new ConnectionFabricError('IMPORT_CANDIDATE_UNKNOWN', input.candidateId);
      const mode = input.mode === 'managed' ? 'managed' : 'reference';
      if (!candidate.locator) {
        throw new ConnectionFabricError('IMPORT_VALIDATION_FAILED', input.candidateId);
      }
      const version = await provider.write({
        kind: candidate.kind,
        mode,
        locator: candidate.locator,
        workspaceId: input.workspaceId,
        requestedBy: input.requestedBy,
        credentialRefId: input.credentialRefId,
        versionFingerprint: input.versionFingerprint,
      });
      return {
        credentialRefId: version.credentialRefId,
        versionId: version.id,
        mode,
        reusedExisting: false,
        warnings: ['locator metadata only; secret stays in Infisical'],
      };
    },
    async rollback() {
      // Locator-only import; Infisical remains source of truth.
    },
  };
}
