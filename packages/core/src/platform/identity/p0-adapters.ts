/**
 * P0 local discovery adapters and an in-memory SecretProvider (CF-3).
 *
 * Adapters discover metadata only. Preview is masked. Copy material is a
 * SealedSecret that inspect() cannot read. resolveForLease is reserved for CF-4.
 */

import { createHash } from 'node:crypto';
import {
  createCredentialRefId,
  type CredentialKind,
  type CredentialRef,
  type CredentialRefId,
  type CredentialVersion,
  type ProviderLocator,
  type StorageMode,
} from './credential-types.ts';
import {
  ConnectionFabricError,
  P0_PROVIDER_CAPABILITIES,
  type CredentialImporter,
  type ExternalAccount,
  type HealthCheck,
  type ImportCandidate,
  type ImportCommitInput,
  type ImportCommitResult,
  type ImportDiscoveryInput,
  type ImportPreview,
  type ImportPreviewInput,
  type ImportRollbackInput,
  type ImportValidationInput,
  type ImportValidationResult,
  type IntegrationDefinition,
  type ProviderCredentialMetadata,
  type ProviderHealthInput,
  type ProviderLeaseInput,
  type ProviderMaterialization,
  type ProviderRevokeInput,
  type ProviderRotateInput,
  type ProviderWriteInput,
  type P0ImporterId,
  type SealedSecret,
  type SecretProvider,
} from './provider-contract.ts';

const VERSION_FINGERPRINT = /^[0-9a-f]{64}$/;
const ENV_FILE_NAME = /^\.env(?:\..+)?$/;
const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;
const SECRET_FIELD = /private[_-]?key|secret|password|token|value|credential/i;

export function metadataFingerprint(parts: readonly string[]): string {
  const hash = createHash('sha256');
  for (const part of parts) {
    hash.update(String(part.length));
    hash.update(':');
    hash.update(part);
    hash.update('\0');
  }
  return hash.digest('hex');
}

export function extractDotenvKeys(content: string): string[] {
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith('#')) continue;
    const withoutExport = line.startsWith('export ') ? line.slice(7).trim() : line;
    const eq = withoutExport.indexOf('=');
    if (eq <= 0) continue;
    const key = withoutExport.slice(0, eq).trim();
    if (!ENV_KEY.test(key) || seen.has(key)) continue;
    seen.add(key);
    keys.push(key);
  }
  return keys;
}

export function parseGitCredentialConfig(content: string): Array<{ host: string; helper: string }> {
  const found: Array<{ host: string; helper: string }> = [];
  let host = '*';
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    const section = line.match(/^\[credential(?:\s+"([^"]+)")?\]$/i);
    if (section) {
      host = section[1] ? stripGitUrl(section[1]) : '*';
      continue;
    }
    const helper = line.match(/^helper\s*=\s*(.+)$/i);
    if (helper?.[1]) {
      found.push({ host, helper: helper[1].trim() });
    }
  }
  return found;
}

function stripGitUrl(value: string): string {
  return value.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
}

export function parseDockerConfig(content: string): Array<{ registry: string; helper: string }> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content) as unknown;
  } catch {
    throw new ConnectionFabricError('IMPORT_VALIDATION_FAILED', 'docker config');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ConnectionFabricError('IMPORT_VALIDATION_FAILED', 'docker config');
  }
  const record = parsed as Record<string, unknown>;
  const found: Array<{ registry: string; helper: string }> = [];
  if (typeof record.credsStore === 'string' && record.credsStore.trim()) {
    found.push({ registry: '*', helper: record.credsStore.trim() });
  }
  if (record.credHelpers && typeof record.credHelpers === 'object' && !Array.isArray(record.credHelpers)) {
    for (const [registry, helper] of Object.entries(record.credHelpers as Record<string, unknown>)) {
      if (typeof helper === 'string' && helper.trim()) {
        found.push({ registry, helper: helper.trim() });
      }
    }
  }
  return found;
}

export function parseAwsConfig(content: string): Array<{
  profile: string;
  source: 'config' | 'credential_process' | 'sso';
}> {
  const found: Array<{ profile: string; source: 'config' | 'credential_process' | 'sso' }> = [];
  let profile: string | undefined;
  let source: 'config' | 'credential_process' | 'sso' = 'config';
  const flush = () => {
    if (!profile) return;
    const current = found.find((item) => item.profile === profile);
    if (current) {
      if (source !== 'config') current.source = source;
      return;
    }
    found.push({ profile, source });
  };
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    const named = line.match(/^\[profile\s+([^\]]+)\]$/i)?.[1];
    const isDefault = /^\[default\]$/i.test(line);
    if (named || isDefault) {
      flush();
      profile = isDefault ? 'default' : named;
      source = 'config';
      continue;
    }
    if (/^\[/.test(line)) {
      flush();
      profile = undefined;
      source = 'config';
      continue;
    }
    if (!profile) continue;
    if (/^credential_process\s*=/i.test(line)) source = 'credential_process';
    if (/^sso_/i.test(line)) source = 'sso';
  }
  flush();
  return found.filter((item) => item.profile.length > 0);
}

export function redactGcpAdcPreview(value: unknown): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return 'gcp_adc metadata';
  }
  const record = value as Record<string, unknown>;
  const type = typeof record.type === 'string' ? record.type : 'unknown';
  const email = typeof record.client_email === 'string' ? record.client_email : undefined;
  return email ? `gcp_adc type=${type} client_email=${email}` : `gcp_adc type=${type}`;
}

export interface LegacyMetadataItem {
  readonly id: string;
  readonly kind: CredentialKind;
  readonly label: string;
  readonly fingerprint?: string;
}

export interface DiscoveryHost {
  listLegacyMetadata?(): Promise<readonly LegacyMetadataItem[]>;
  listEnvFiles?(): Promise<readonly { path: string; content?: string; keys?: readonly string[] }[]>;
  listKeychainItems?(): Promise<readonly { service: string; account: string }[]>;
  listGitHelpers?(): Promise<readonly { host: string; helper: string }[]>;
  gitConfigText?(): Promise<string | undefined>;
  listDockerHelpers?(): Promise<readonly { registry: string; helper: string }[]>;
  dockerConfigText?(): Promise<string | undefined>;
  listAwsProfiles?(): Promise<readonly { profile: string; source?: string }[]>;
  awsConfigText?(): Promise<string | undefined>;
  listGcpAdc?(): Promise<readonly { source: string; metadata?: unknown }[]>;
  listSshIdentities?(): Promise<readonly { fingerprint: string; comment?: string }[]>;
  approveCopy?(candidateId: string): Promise<SealedSecret | undefined>;
}

function assertNoSecretFields(value: object, label: string): void {
  for (const key of Object.keys(value)) {
    if (SECRET_FIELD.test(key)) {
      throw new ConnectionFabricError('IMPORT_VALIDATION_FAILED', `${label}.${key}`);
    }
  }
}

function maskLabel(label: string): string {
  return `${label} ••••`;
}

export function createSealedSecret(kind: CredentialKind): SealedSecret {
  return { _brand: 'SealedSecret', kind };
}

interface StoredMaterial {
  readonly locator: ProviderLocator;
  readonly kind: CredentialKind;
  readonly mode: StorageMode;
  readonly version: CredentialVersion;
  readonly sealed?: SealedSecret;
}

export class LocalMemorySecretProvider implements SecretProvider {
  readonly id: string;
  readonly definition: IntegrationDefinition;
  private readonly store = new Map<string, StoredMaterial>();
  private sequence = 0;

  constructor(id = 'legacy-local') {
    const capabilities = P0_PROVIDER_CAPABILITIES['legacy-local'];
    this.id = id;
    this.definition = {
      id,
      providerKind: 'local',
      displayName: 'Legacy local credentials',
      supportedKinds: capabilities.kinds,
      deliveryMechanisms: ['trusted-http-header', 'stdin', 'env-legacy'],
      capabilities,
    };
  }

  async discoverAccount(input: { workspaceId: string }): Promise<ExternalAccount> {
    return {
      id: `acct_${this.id}`,
      providerId: this.id,
      displayName: this.definition.displayName,
      tenant: input.workspaceId,
      status: 'connected',
    };
  }

  async inspect(ref: CredentialRef): Promise<ProviderCredentialMetadata> {
    const stored = this.store.get(locatorKey(ref.locator));
    if (!stored) throw new ConnectionFabricError('PROVIDER_UNAVAILABLE', ref.id);
    return {
      kind: stored.kind,
      locator: { ...stored.locator } as ProviderLocator,
      hasMaterial: stored.mode !== 'reference',
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
    if (!this.definition.capabilities.modes.includes(input.mode)) {
      throw new ConnectionFabricError('IMPORT_MODE_UNSUPPORTED', input.mode);
    }
    if (input.mode === 'copy' && !input.sealedCopy) {
      throw new ConnectionFabricError('IMPORT_VALIDATION_FAILED', 'sealed copy required');
    }
    if (input.mode === 'copy' && input.sealedCopy?.kind !== input.kind) {
      throw new ConnectionFabricError('IMPORT_VALIDATION_FAILED', 'sealed kind');
    }
    const fingerprint = input.versionFingerprint ?? metadataFingerprint([this.id, locatorKey(input.locator)]);
    if (!VERSION_FINGERPRINT.test(fingerprint)) {
      throw new ConnectionFabricError('IMPORT_VALIDATION_FAILED', 'fingerprint');
    }
    const credentialRefId = input.credentialRefId ?? createCredentialRefId();
    const version: CredentialVersion = {
      id: `ver_${++this.sequence}`,
      credentialRefId,
      codec: 'stored-credential/v1',
      fingerprint,
      createdAt: Date.now(),
      status: 'active',
      ...(input.expiresAt !== undefined ? { expiresAt: input.expiresAt } : {}),
    };
    this.store.set(locatorKey(input.locator), {
      locator: { ...input.locator } as ProviderLocator,
      kind: input.kind,
      mode: input.mode,
      version,
      ...(input.sealedCopy ? { sealed: input.sealedCopy } : {}),
    });
    return { ...version };
  }

  async revoke(input: ProviderRevokeInput): Promise<void> {
    this.store.delete(locatorKey(input.credentialRef.locator));
    for (const [key, stored] of this.store) {
      if (stored.version.credentialRefId === input.credentialRef.id) {
        this.store.delete(key);
      }
    }
  }

  async rotate(_input: ProviderRotateInput): Promise<CredentialVersion> {
    throw new ConnectionFabricError('PROVIDER_OPERATION_UNSUPPORTED', 'rotate');
  }

  async health(input: ProviderHealthInput): Promise<HealthCheck> {
    const stored = this.store.get(locatorKey(input.credentialRef.locator));
    return {
      id: `health_${this.id}`,
      checkedAt: Date.now(),
      status: stored ? 'healthy' : 'unreachable',
      ...(stored ? {} : { detailCode: 'PROVIDER_UNAVAILABLE' }),
    };
  }

  /** Test helper: prove inspect never exposes the sealed brand payload. */
  peekHasSealed(locator: ProviderLocator): boolean {
    return this.store.get(locatorKey(locator))?.sealed?._brand === 'SealedSecret';
  }
}

function locatorKey(locator: ProviderLocator): string {
  switch (locator.type) {
    case 'local':
      return `local:${locator.key}`;
    case 'keychain':
      return `keychain:${locator.service}/${locator.account}`;
    case 'dotenv':
      return `dotenv:${locator.path}:${locator.key}`;
    case 'git_helper':
      return `git:${locator.host}`;
    case 'docker_helper':
      return `docker:${locator.registry}`;
    case 'aws_profile':
      return `aws:${locator.profile}`;
    case 'gcp_adc':
      return `gcp:${locator.source}`;
    case 'ssh_agent':
      return `ssh:${locator.fingerprint}`;
    case 'infisical':
      return `infisical:${locator.projectId}:${locator.environment}:${locator.secretPath}:${locator.secretKey}`;
    case 'opaque':
      return `opaque:${locator.provider}:${locator.locator}`;
  }
}

class MetadataImporter implements CredentialImporter {
  readonly id: string;
  readonly sourceKind: string;
  private readonly host: DiscoveryHost;
  private readonly target: SecretProvider;
  private readonly allowedModes: readonly StorageMode[];
  private readonly defaultKind: CredentialKind;
  private readonly defaultMode: StorageMode;
  private readonly discoverFn: () => Promise<ImportCandidate[]>;
  private readonly previewFn: (candidate: ImportCandidate, targetProviderId: string) => ImportPreview;
  private lastCommit: ImportCommitResult | undefined;
  private lastLocator: ProviderLocator | undefined;

  constructor(options: {
    id: string;
    sourceKind: string;
    host: DiscoveryHost;
    target: SecretProvider;
    allowedModes: readonly StorageMode[];
    defaultKind: CredentialKind;
    defaultMode: StorageMode;
    discover: () => Promise<ImportCandidate[]>;
    preview: (candidate: ImportCandidate, targetProviderId: string) => ImportPreview;
  }) {
    this.id = options.id;
    this.sourceKind = options.sourceKind;
    this.host = options.host;
    this.target = options.target;
    this.allowedModes = options.allowedModes;
    this.defaultKind = options.defaultKind;
    this.defaultMode = options.defaultMode;
    this.discoverFn = options.discover;
    this.previewFn = options.preview;
  }

  async discover(_input: ImportDiscoveryInput): Promise<ImportCandidate[]> {
    const candidates = await this.discoverFn();
    for (const candidate of candidates) {
      assertNoSecretFields(candidate, this.id);
      if (candidate.locator) assertNoSecretFields(candidate.locator, this.id);
    }
    return candidates;
  }

  async preview(input: ImportPreviewInput): Promise<ImportPreview> {
    const candidates = await this.discoverFn();
    const candidate = candidates.find((item) => item.id === input.candidateId);
    if (!candidate) throw new ConnectionFabricError('IMPORT_CANDIDATE_UNKNOWN', input.candidateId);
    const preview = this.previewFn(candidate, input.targetProviderId);
    if (SECRET_FIELD.test(preview.maskedSummary) && /sk-|ghp_|AKIA|BEGIN/.test(preview.maskedSummary)) {
      throw new ConnectionFabricError('IMPORT_VALIDATION_FAILED', 'preview leak');
    }
    return preview;
  }

  async validate(input: ImportValidationInput): Promise<ImportValidationResult> {
    if (!this.allowedModes.includes(input.mode)) {
      return { ok: false, errorCode: 'IMPORT_MODE_UNSUPPORTED', warnings: [] };
    }
    const candidates = await this.discoverFn();
    if (!candidates.some((item) => item.id === input.candidateId)) {
      return { ok: false, errorCode: 'IMPORT_CANDIDATE_UNKNOWN', warnings: [] };
    }
    return { ok: true, warnings: [] };
  }

  async commit(input: ImportCommitInput): Promise<ImportCommitResult> {
    const validation = await this.validate(input);
    if (!validation.ok) {
      throw new ConnectionFabricError(validation.errorCode ?? 'IMPORT_VALIDATION_FAILED');
    }
    const candidates = await this.discoverFn();
    const candidate = candidates.find((item) => item.id === input.candidateId);
    if (!candidate) throw new ConnectionFabricError('IMPORT_CANDIDATE_UNKNOWN', input.candidateId);
    const locator = candidate.locator;
    if (!locator) throw new ConnectionFabricError('IMPORT_VALIDATION_FAILED', 'locator');

    let sealedCopy = input.sealedCopy;
    if (input.mode === 'copy' && !sealedCopy) {
      sealedCopy = await this.host.approveCopy?.(candidate.id);
    }
    if (input.mode === 'copy' && !sealedCopy) {
      throw new ConnectionFabricError('IMPORT_ACCESS_DENIED', 'copy material');
    }

    let version: CredentialVersion;
    try {
      version = await this.target.write({
        kind: candidate.kind,
        mode: input.mode,
        locator,
        workspaceId: input.workspaceId,
        requestedBy: input.requestedBy,
        ...(input.credentialRefId ? { credentialRefId: input.credentialRefId } : {}),
        ...(sealedCopy ? { sealedCopy } : {}),
        ...(input.versionFingerprint ? { versionFingerprint: input.versionFingerprint } : {}),
        ...(candidate.expiresAt !== undefined ? { expiresAt: candidate.expiresAt } : {}),
      });
    } catch (error) {
      if (error instanceof ConnectionFabricError) throw error;
      throw new ConnectionFabricError('IMPORT_PROVIDER_WRITE_FAILED');
    }

    const result: ImportCommitResult = {
      credentialRefId: version.credentialRefId,
      versionId: version.id,
      mode: input.mode,
      reusedExisting: false,
      warnings: validation.warnings,
    };
    this.lastCommit = result;
    this.lastLocator = locator;
    return result;
  }

  async rollback(_input: ImportRollbackInput): Promise<void> {
    const commit = this.lastCommit;
    const locator = this.lastLocator;
    if (!commit || !locator) return;
    const ref: CredentialRef = {
      id: commit.credentialRefId,
      kind: this.defaultKind,
      providerId: this.target.id,
      locator,
      createdAt: 0,
      updatedAt: 0,
    };
    await this.target.revoke({ credentialRef: ref });
    this.lastCommit = undefined;
    this.lastLocator = undefined;
  }
}

function candidateId(source: string, key: string): string {
  return `${source}:${key}`;
}

export type P0ImporterMap = Record<P0ImporterId, CredentialImporter>;

export function createP0Importers(
  host: DiscoveryHost,
  target: SecretProvider,
): P0ImporterMap {
  const legacy = new MetadataImporter({
    id: 'legacy-local',
    sourceKind: 'credentials.enc',
    host,
    target,
    allowedModes: ['reference', 'copy'],
    defaultKind: 'opaque_bundle',
    defaultMode: 'reference',
    discover: async () => {
      const items = (await host.listLegacyMetadata?.()) ?? [];
      return items.map((item) => ({
        id: candidateId('legacy-local', item.id),
        sourceId: 'legacy-local',
        kind: item.kind,
        label: item.label,
        locator: { type: 'local', key: item.id },
        conflictKey: `legacy:${item.id}`,
        ...(item.fingerprint ? { fingerprint: item.fingerprint } : {}),
      }));
    },
    preview: (candidate, targetProviderId) => ({
      candidateId: candidate.id,
      inferredKind: candidate.kind,
      targetProviderId,
      proposedMode: 'reference',
      maskedSummary: maskLabel(candidate.label),
      warnings: ['source is not deleted; CF-2 owns dual-read migration'],
    }),
  });

  const dotenv = new MetadataImporter({
    id: 'dotenv',
    sourceKind: '.env',
    host,
    target,
    allowedModes: ['copy'],
    defaultKind: 'api_key',
    defaultMode: 'copy',
    discover: async () => {
      const files = (await host.listEnvFiles?.()) ?? [];
      const candidates: ImportCandidate[] = [];
      for (const file of files) {
        const base = file.path.split(/[/\\]/).pop() ?? '';
        if (!ENV_FILE_NAME.test(base) || file.path.includes('..')) {
          throw new ConnectionFabricError('IMPORT_VALIDATION_FAILED', 'env path');
        }
        const keys = file.keys ?? (file.content !== undefined ? extractDotenvKeys(file.content) : []);
        for (const key of keys) {
          candidates.push({
            id: candidateId('dotenv', `${file.path}:${key}`),
            sourceId: 'dotenv',
            kind: 'api_key',
            label: key,
            locator: { type: 'dotenv', path: file.path, key },
            conflictKey: `dotenv:${file.path}:${key}`,
            fingerprint: metadataFingerprint(['dotenv', file.path, key]),
          });
        }
      }
      return candidates;
    },
    preview: (candidate, targetProviderId) => ({
      candidateId: candidate.id,
      inferredKind: 'api_key',
      targetProviderId,
      proposedMode: 'copy',
      maskedSummary: `${candidate.label}=••••`,
      warnings: ['no shell expansion', 'values are never returned to preview'],
    }),
  });

  const keychain = new MetadataImporter({
    id: 'macos-keychain',
    sourceKind: 'macos-keychain',
    host,
    target,
    allowedModes: ['reference', 'copy'],
    defaultKind: 'opaque_bundle',
    defaultMode: 'reference',
    discover: async () => {
      const items = (await host.listKeychainItems?.()) ?? [];
      return items.map((item) => ({
        id: candidateId('macos-keychain', `${item.service}/${item.account}`),
        sourceId: 'macos-keychain',
        kind: 'opaque_bundle' as const,
        label: `${item.service} / ${item.account}`,
        locator: { type: 'keychain', service: item.service, account: item.account },
        conflictKey: `keychain:${item.service}/${item.account}`,
        fingerprint: metadataFingerprint(['keychain', item.service, item.account]),
      }));
    },
    preview: (candidate, targetProviderId) => ({
      candidateId: candidate.id,
      inferredKind: candidate.kind,
      targetProviderId,
      proposedMode: 'reference',
      maskedSummary: maskLabel(candidate.label),
      warnings: ['Keychain remains the preferred Personal Local provider'],
    }),
  });

  const git = new MetadataImporter({
    id: 'git-credential',
    sourceKind: 'git-credential-helper',
    host,
    target,
    allowedModes: ['reference', 'copy'],
    defaultKind: 'basic_auth',
    defaultMode: 'reference',
    discover: async () => {
      const fromHost = (await host.listGitHelpers?.()) ?? [];
      const fromText = host.gitConfigText ? parseGitCredentialConfig((await host.gitConfigText()) ?? '') : [];
      const items = fromHost.length > 0 ? fromHost : fromText;
      return items.map((item) => ({
        id: candidateId('git-credential', item.host),
        sourceId: 'git-credential',
        kind: 'basic_auth' as const,
        label: `${item.host} (${item.helper})`,
        locator: { type: 'git_helper', host: item.host },
        conflictKey: `git:${item.host}`,
        fingerprint: metadataFingerprint(['git', item.host, item.helper]),
      }));
    },
    preview: (candidate, targetProviderId) => ({
      candidateId: candidate.id,
      inferredKind: 'basic_auth',
      targetProviderId,
      proposedMode: 'reference',
      maskedSummary: maskLabel(candidate.label),
      warnings: ['helper stdout is never returned to preview'],
    }),
  });

  const docker = new MetadataImporter({
    id: 'docker-credential',
    sourceKind: 'docker-credential-helper',
    host,
    target,
    allowedModes: ['reference', 'copy'],
    defaultKind: 'basic_auth',
    defaultMode: 'reference',
    discover: async () => {
      const fromHost = (await host.listDockerHelpers?.()) ?? [];
      const fromText = host.dockerConfigText
        ? parseDockerConfig((await host.dockerConfigText()) ?? '{}')
        : [];
      const items = fromHost.length > 0 ? fromHost : fromText;
      return items.map((item) => ({
        id: candidateId('docker-credential', item.registry),
        sourceId: 'docker-credential',
        kind: 'basic_auth' as const,
        label: `${item.registry} (${item.helper})`,
        locator: { type: 'docker_helper', registry: item.registry },
        conflictKey: `docker:${item.registry}`,
        fingerprint: metadataFingerprint(['docker', item.registry, item.helper]),
      }));
    },
    preview: (candidate, targetProviderId) => ({
      candidateId: candidate.id,
      inferredKind: 'basic_auth',
      targetProviderId,
      proposedMode: 'reference',
      maskedSummary: maskLabel(candidate.label),
      warnings: ['helper argv/environment are not forwarded to renderer'],
    }),
  });

  const aws = new MetadataImporter({
    id: 'aws-profile',
    sourceKind: 'aws-shared-config',
    host,
    target,
    allowedModes: ['reference', 'copy'],
    defaultKind: 'aws_credential_source',
    defaultMode: 'reference',
    discover: async () => {
      const fromHost = (await host.listAwsProfiles?.()) ?? [];
      const fromText = host.awsConfigText ? parseAwsConfig((await host.awsConfigText()) ?? '') : [];
      const items =
        fromHost.length > 0
          ? fromHost.map((item) => ({ profile: item.profile, source: item.source ?? 'config' }))
          : fromText;
      return items.map((item) => ({
        id: candidateId('aws-profile', item.profile),
        sourceId: 'aws-profile',
        kind: 'aws_credential_source' as const,
        label: item.profile,
        locator: { type: 'aws_profile', profile: item.profile },
        conflictKey: `aws:${item.profile}`,
        fingerprint: metadataFingerprint(['aws', item.profile, item.source]),
      }));
    },
    preview: (candidate, targetProviderId) => ({
      candidateId: candidate.id,
      inferredKind: 'aws_credential_source',
      targetProviderId,
      proposedMode: 'reference',
      maskedSummary: `aws profile ${candidate.label} ••••`,
      warnings: ['static keys are not copied into preview'],
    }),
  });

  const gcp = new MetadataImporter({
    id: 'gcp-adc',
    sourceKind: 'gcp-adc',
    host,
    target,
    allowedModes: ['reference', 'copy'],
    defaultKind: 'gcp_adc',
    defaultMode: 'reference',
    discover: async () => {
      const items = (await host.listGcpAdc?.()) ?? [];
      return items.map((item) => ({
        id: candidateId('gcp-adc', item.source),
        sourceId: 'gcp-adc',
        kind: 'gcp_adc' as const,
        label: item.metadata !== undefined ? redactGcpAdcPreview(item.metadata) : item.source,
        locator: { type: 'gcp_adc', source: item.source },
        conflictKey: `gcp:${item.source}`,
        fingerprint: metadataFingerprint(['gcp', item.source]),
      }));
    },
    preview: (candidate, targetProviderId) => ({
      candidateId: candidate.id,
      inferredKind: 'gcp_adc',
      targetProviderId,
      proposedMode: 'reference',
      maskedSummary: maskLabel(candidate.label),
      warnings: ['ADC JSON private_key is never included in preview'],
    }),
  });

  const ssh = new MetadataImporter({
    id: 'ssh-agent',
    sourceKind: 'ssh-agent',
    host,
    target,
    allowedModes: ['reference'],
    defaultKind: 'ssh_agent_identity',
    defaultMode: 'reference',
    discover: async () => {
      const items = (await host.listSshIdentities?.()) ?? [];
      return items.map((item) => ({
        id: candidateId('ssh-agent', item.fingerprint),
        sourceId: 'ssh-agent',
        kind: 'ssh_agent_identity' as const,
        label: item.comment ?? item.fingerprint,
        locator: { type: 'ssh_agent', fingerprint: item.fingerprint },
        conflictKey: `ssh:${item.fingerprint}`,
        fingerprint: metadataFingerprint(['ssh', item.fingerprint]),
      }));
    },
    preview: (candidate, targetProviderId) => ({
      candidateId: candidate.id,
      inferredKind: 'ssh_agent_identity',
      targetProviderId,
      proposedMode: 'reference',
      maskedSummary: `ssh ${candidate.locator && candidate.locator.type === 'ssh_agent' ? candidate.locator.fingerprint : 'identity'} ••••`,
      warnings: ['private keys are never imported'],
    }),
  });

  return {
    'legacy-local': legacy,
    dotenv,
    'macos-keychain': keychain,
    'git-credential': git,
    'docker-credential': docker,
    'aws-profile': aws,
    'gcp-adc': gcp,
    'ssh-agent': ssh,
  };
}

export function createP0ProviderStack(host: DiscoveryHost = {}): {
  provider: LocalMemorySecretProvider;
  importers: P0ImporterMap;
} {
  const provider = new LocalMemorySecretProvider();
  return { provider, importers: createP0Importers(host, provider) };
}
