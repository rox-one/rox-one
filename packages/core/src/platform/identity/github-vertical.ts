/**
 * CF-7 GitHub vertical: dotenv/env import → Connection → grant → lease →
 * brokered GET /user. The Bearer token is used only inside runGithubVertical
 * and never appears on return values.
 */

import { createHash, randomUUID } from 'node:crypto';
import type { ConsumerIdentity } from './broker.ts';
import { InProcessCredentialBroker } from './broker.ts';
import type { CredentialKind, CredentialRef, CredentialRefId, ProviderLocator, StorageMode } from './credential-types.ts';
import { JsonAccessGrantStore } from './grants.ts';
import type { P0ImporterMap } from './p0-adapters.ts';
import { createSealedSecret, type LocalMemorySecretProvider } from './p0-adapters.ts';
import { ConnectionFabricError, type SealedSecret } from './provider-contract.ts';
import { ConnectionWorkGraph } from './workgraph.ts';

const DEFAULT_TOKEN_ENV_KEYS = ['GH_TOKEN', 'GITHUB_TOKEN'] as const;
const DEFAULT_ACTION = 'github.request';
const DEFAULT_PURPOSE = 'github.api.user';
const DEFAULT_RESOURCES = ['api.github.com/user'] as const;
const DEFAULT_TTL_MS = 30_000;
const GITHUB_USER_URL = 'https://api.github.com/user';

export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export interface GithubProviderStack {
  readonly provider: LocalMemorySecretProvider;
  readonly importers: P0ImporterMap;
}

export interface ImportGithubFromEnvOptions {
  readonly workspaceId: string;
  readonly requestedBy: string;
  readonly tokenEnvKeys?: readonly string[];
  readonly mode?: Extract<StorageMode, 'reference' | 'copy'>;
  /** Synthetic dotenv path when no host candidate exists (tests). */
  readonly envPath?: string;
  /**
   * Test/operator path: presence enables import without reading env values.
   * The string itself is never stored on CredentialRef / Connection / result.
   */
  readonly injectedToken?: string;
  readonly sealedCopy?: SealedSecret;
}

export interface GithubImportResult {
  readonly credentialRefId: CredentialRefId;
  readonly versionId: string;
  readonly mode: StorageMode;
  readonly locator: ProviderLocator;
  readonly kind: CredentialKind;
  readonly providerId: string;
}

export interface RunGithubVerticalInput {
  readonly workspaceId: string;
  readonly requestedBy: string;
  readonly consumer: ConsumerIdentity;
  readonly stack: GithubProviderStack;
  readonly graph?: ConnectionWorkGraph;
  readonly grants?: JsonAccessGrantStore;
  readonly broker?: InProcessCredentialBroker;
  readonly tokenEnvKeys?: readonly string[];
  readonly mode?: Extract<StorageMode, 'reference' | 'copy'>;
  readonly envPath?: string;
  /**
   * Bearer material for the single brokered GitHub call inside this function.
   * Never returned, never written onto Connection/grant/lease results.
   */
  readonly injectedToken: string;
  readonly fetch: FetchLike;
  readonly purpose?: string;
  readonly action?: string;
  readonly resources?: readonly string[];
  readonly ttl?: number;
  /** When false, skip AccessGrant creation so acquireLease fails closed. */
  readonly createGrant?: boolean;
  readonly sealedCopy?: SealedSecret;
}

export interface GithubVerticalResult {
  readonly login: string;
  readonly leaseId: string;
  readonly connectionId: string;
  readonly credentialRefId: CredentialRefId;
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

function assertNoTokenLeak(value: unknown, token: string): void {
  const serialized = JSON.stringify(value);
  if (serialized.includes(token)) {
    throw new ConnectionFabricError('IMPORT_VALIDATION_FAILED', 'token leak');
  }
  if (/ghp_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+/.test(serialized)) {
    throw new ConnectionFabricError('IMPORT_VALIDATION_FAILED', 'token pattern leak');
  }
}

function sealGithubToken(
  kind: CredentialKind,
  token: string | undefined,
  sealed?: SealedSecret,
): SealedSecret | undefined {
  if (sealed) return sealed;
  if (token !== undefined) return createSealedSecret(kind, token);
  return undefined;
}

/**
 * Import a GitHub token candidate from dotenv discovery or an injected test
 * locator. Stores sealed/reference metadata only — never the raw token.
 */
export async function importGithubFromEnv(
  stack: GithubProviderStack,
  options: ImportGithubFromEnvOptions,
): Promise<GithubImportResult> {
  const keys = options.tokenEnvKeys ?? DEFAULT_TOKEN_ENV_KEYS;
  const mode = options.mode ?? 'copy';
  const kind: CredentialKind = 'api_key';

  const discovered = await stack.importers.dotenv.discover({
    sourceId: 'dotenv',
    workspaceId: options.workspaceId,
  });
  const candidate = discovered.find((item) => keys.includes(item.label));

  if (candidate?.locator) {
    if (mode === 'copy') {
      const sealed = sealGithubToken(kind, options.injectedToken, options.sealedCopy);
      const commit = await stack.importers.dotenv.commit({
        candidateId: candidate.id,
        targetProviderId: stack.provider.id,
        mode: 'copy',
        workspaceId: options.workspaceId,
        requestedBy: options.requestedBy,
        ...(sealed ? { sealedCopy: sealed } : {}),
      });
      return {
        credentialRefId: commit.credentialRefId,
        versionId: commit.versionId,
        mode: commit.mode,
        locator: candidate.locator,
        kind,
        providerId: stack.provider.id,
      };
    }

    const version = await stack.provider.write({
      kind,
      mode: 'reference',
      locator: candidate.locator,
      workspaceId: options.workspaceId,
      requestedBy: options.requestedBy,
      versionFingerprint: fingerprint(['github', 'reference', candidate.locator.type, candidate.label]),
    });
    return {
      credentialRefId: version.credentialRefId,
      versionId: version.id,
      mode: 'reference',
      locator: candidate.locator,
      kind,
      providerId: stack.provider.id,
    };
  }

  if (options.injectedToken === undefined && options.sealedCopy === undefined) {
    throw new ConnectionFabricError('IMPORT_CANDIDATE_UNKNOWN', keys.join('|'));
  }

  const key = keys[0] ?? 'GH_TOKEN';
  const locator: ProviderLocator = {
    type: 'dotenv',
    path: options.envPath ?? '/repo/.env',
    key,
  };
  const sealed = mode === 'copy' ? sealGithubToken(kind, options.injectedToken, options.sealedCopy) : undefined;
  if (mode === 'copy' && !sealed) {
    throw new ConnectionFabricError('IMPORT_ACCESS_DENIED', 'copy material');
  }
  const version = await stack.provider.write({
    kind,
    mode,
    locator,
    workspaceId: options.workspaceId,
    requestedBy: options.requestedBy,
    versionFingerprint: fingerprint(['github', mode, locator.path, locator.key]),
    ...(sealed ? { sealedCopy: sealed } : {}),
  });
  return {
    credentialRefId: version.credentialRefId,
    versionId: version.id,
    mode,
    locator,
    kind,
    providerId: stack.provider.id,
  };
}

/**
 * End-to-end GitHub vertical: import → Connection → grant → lease → GET /user.
 * Returns metadata only; the Bearer token never leaves this function's scope.
 */
export async function runGithubVertical(input: RunGithubVerticalInput): Promise<GithubVerticalResult> {
  const token = input.injectedToken;
  if (typeof token !== 'string' || token.trim().length === 0) {
    throw new ConnectionFabricError('IMPORT_VALIDATION_FAILED', 'injectedToken');
  }

  const imported = await importGithubFromEnv(input.stack, {
    workspaceId: input.workspaceId,
    requestedBy: input.requestedBy,
    tokenEnvKeys: input.tokenEnvKeys,
    mode: input.mode,
    envPath: input.envPath,
    injectedToken: token,
    sealedCopy: input.sealedCopy,
  });

  const ref: CredentialRef = {
    id: imported.credentialRefId,
    kind: imported.kind,
    providerId: imported.providerId,
    locator: imported.locator,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  const graph = input.graph ?? new ConnectionWorkGraph();
  const grants = input.grants ?? new JsonAccessGrantStore();
  const action = input.action ?? DEFAULT_ACTION;
  const resources = input.resources ?? DEFAULT_RESOURCES;
  const purpose = input.purpose ?? DEFAULT_PURPOSE;
  const createGrant = input.createGrant !== false;

  const connection = await graph.createConnection({
    workspaceId: input.workspaceId,
    integrationId: 'github',
    credentialRefId: imported.credentialRefId,
    storageMode: imported.mode,
    scopes: ['read:user'],
  });

  await graph.bindConsumer({
    workspaceId: input.workspaceId,
    connectionId: connection.id,
    consumerId: input.consumer.id,
    purpose,
    allowedActions: [action],
    resources: [...resources],
  });

  if (createGrant) {
    grants.put({
      id: `grant_${randomUUID()}`,
      workspaceId: input.workspaceId,
      consumerId: input.consumer.id,
      credentialRefId: imported.credentialRefId,
      actions: [action],
      resources: [...resources],
      status: 'active',
    });
  }

  const broker =
    input.broker ??
    new InProcessCredentialBroker({
      grants,
      providers: { [input.stack.provider.id]: input.stack.provider },
      resolveRef: async (id) => (id === ref.id ? ref : undefined),
    });

  const lease = await broker.acquireLease({
    credentialRef: imported.credentialRefId,
    consumer: input.consumer,
    purpose,
    action,
    resources: [...resources],
    audience: 'api.github.com',
    ttl: input.ttl ?? DEFAULT_TTL_MS,
    requestedMechanism: 'trusted-http-header',
  });

  let response: Response;
  try {
    response = await broker.executeTrustedHttp({
      leaseId: lease.id,
      url: GITHUB_USER_URL,
      method: 'GET',
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'rox-connection-fabric',
      },
      fetch: input.fetch,
    });
  } catch (error) {
    if (error instanceof ConnectionFabricError) throw error;
    throw new ConnectionFabricError(
      'PROVIDER_UNAVAILABLE',
      error instanceof Error ? error.message : 'github fetch',
    );
  }

  if (response.status === 401 || response.status === 403) {
    throw new ConnectionFabricError('LEASE_DENIED', `github HTTP ${response.status}`);
  }
  if (!response.ok) {
    throw new ConnectionFabricError('PROVIDER_UNAVAILABLE', `github HTTP ${response.status}`);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new ConnectionFabricError('PROVIDER_UNAVAILABLE', 'github non-json');
  }

  const login =
    body && typeof body === 'object' && !Array.isArray(body) && typeof (body as { login?: unknown }).login === 'string'
      ? (body as { login: string }).login.trim()
      : '';
  if (!login) {
    throw new ConnectionFabricError('IMPORT_VALIDATION_FAILED', 'github login');
  }

  const result: GithubVerticalResult = {
    login,
    leaseId: lease.id,
    connectionId: connection.id,
    credentialRefId: imported.credentialRefId,
  };
  assertNoTokenLeak(result, token);
  return result;
}
