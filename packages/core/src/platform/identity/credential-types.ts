/**
 * Provider-neutral credential metadata contracts (Connection Fabric CF-1).
 *
 * These types intentionally contain no secret payload. Secret material belongs
 * to a provider envelope and is never accepted by the metadata registry.
 */

export type StorageMode = 'reference' | 'copy' | 'mirror' | 'managed' | 'ephemeral';

export type CredentialKind =
  | 'api_key'
  | 'oauth2_token_set'
  | 'bearer_token'
  | 'basic_auth'
  | 'aws_credential_source'
  | 'gcp_adc'
  | 'ssh_agent_identity'
  | 'x509_identity'
  | 'opaque_bundle'
  | 'browser_session';

export type CredentialRefId = `cred_${string}`;

export type ProviderLocator =
  | { type: 'local'; key: string }
  | { type: 'keychain'; service: string; account: string }
  | { type: 'dotenv'; path: string; key: string }
  | { type: 'git_helper'; host: string }
  | { type: 'docker_helper'; registry: string }
  | { type: 'aws_profile'; profile: string }
  | { type: 'gcp_adc'; source: string }
  | { type: 'ssh_agent'; fingerprint: string }
  | { type: 'infisical'; projectId: string; environment: string; secretPath: string; secretKey: string }
  | { type: 'opaque'; provider: string; locator: string };

export type CredentialVersionStatus = 'active' | 'superseded' | 'revoked' | 'invalid';

export interface CredentialRef {
  readonly id: CredentialRefId;
  readonly kind: CredentialKind;
  readonly providerId: string;
  readonly locator: ProviderLocator;
  readonly currentVersionId?: string;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface CredentialVersion {
  readonly id: string;
  readonly credentialRefId: CredentialRefId;
  readonly codec: string;
  readonly fingerprint: string;
  readonly providerVersion?: string;
  readonly createdAt: number;
  readonly expiresAt?: number;
  readonly status: CredentialVersionStatus;
}

export interface RegisterCredentialRefInput {
  readonly id?: CredentialRefId;
  readonly kind: CredentialKind;
  readonly providerId: string;
  readonly locator: ProviderLocator;
  readonly now?: number;
}

export interface RegisterCredentialVersionInput {
  readonly id?: string;
  readonly credentialRefId: CredentialRefId;
  readonly codec: string;
  readonly fingerprint: string;
  readonly providerVersion?: string;
  readonly createdAt?: number;
  readonly expiresAt?: number;
  readonly status?: CredentialVersionStatus;
}

export type CredentialRefIdFactory = () => CredentialRefId;

/**
 * Lowercase-only: the `CredentialRefId` template type requires a lowercase
 * `cred_` prefix and `randomUUID` emits lowercase hex, so accepting other
 * casings would let two spellings of one UUID register as distinct refs.
 */
const CREDENTIAL_REF_ID_PATTERN =
  /^cred_[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const CREDENTIAL_KINDS: readonly CredentialKind[] = [
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

const VERSION_STATUSES: readonly CredentialVersionStatus[] = [
  'active',
  'superseded',
  'revoked',
  'invalid',
];

const STORAGE_MODES: readonly StorageMode[] = [
  'reference',
  'copy',
  'mirror',
  'managed',
  'ephemeral',
];

const REGISTER_REF_FIELDS = new Set([
  'id',
  'kind',
  'providerId',
  'locator',
  'now',
]);

const REGISTER_VERSION_FIELDS = new Set([
  'id',
  'credentialRefId',
  'codec',
  'fingerprint',
  'providerVersion',
  'createdAt',
  'expiresAt',
  'status',
]);

const VERSION_TRANSITIONS: Record<CredentialVersionStatus, readonly CredentialVersionStatus[]> = {
  active: ['active', 'superseded', 'revoked', 'invalid'],
  superseded: ['superseded', 'revoked', 'invalid'],
  revoked: ['revoked'],
  invalid: ['invalid'],
};

const MAX_METADATA_STRING_LENGTH = 4_096;
const MAX_ERROR_LABEL_LENGTH = 64;
const VERSION_FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/;

/**
 * Callers control both object keys and identifiers, so echoing them verbatim
 * lets a single rejected call write an unbounded string into logs.
 */
function errorLabel(value: unknown): string {
  const text = typeof value === 'string' ? value : String(value);
  return text.length > MAX_ERROR_LABEL_LENGTH
    ? `${text.slice(0, MAX_ERROR_LABEL_LENGTH)}...`
    : text;
}

export function isCredentialRefId(value: unknown): value is CredentialRefId {
  return typeof value === 'string' && CREDENTIAL_REF_ID_PATTERN.test(value);
}

export function createCredentialRefId(): CredentialRefId {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (!uuid) throw new Error('Secure random UUID is unavailable');
  return `cred_${uuid}` as CredentialRefId;
}

export function isCredentialKind(value: unknown): value is CredentialKind {
  return typeof value === 'string' && CREDENTIAL_KINDS.includes(value as CredentialKind);
}

export function isStorageMode(value: unknown): value is StorageMode {
  return typeof value === 'string' && STORAGE_MODES.includes(value as StorageMode);
}

function isVersionStatus(value: unknown): value is CredentialVersionStatus {
  return typeof value === 'string' && VERSION_STATUSES.includes(value as CredentialVersionStatus);
}

function nonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new Error(`Invalid credential metadata: ${field}`);
  }
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > MAX_METADATA_STRING_LENGTH) {
    throw new Error(`Invalid credential metadata: ${field}`);
  }
  return normalized;
}

function versionFingerprint(value: unknown): string {
  if (typeof value !== 'string' || !VERSION_FINGERPRINT_PATTERN.test(value)) {
    throw new Error('Invalid credential version fingerprint');
  }
  return value;
}

function finiteTimestamp(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`Invalid credential metadata: ${field}`);
  }
  return value;
}

function assertExactKeys(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  errorPrefix: string,
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`${errorPrefix}: ${errorLabel(key)}`);
  }
}

function validateLocator(locator: ProviderLocator): ProviderLocator {
  if (!locator || typeof locator !== 'object' || Array.isArray(locator)) {
    throw new Error('Invalid credential metadata: locator');
  }

  const record = locator as unknown as Record<string, unknown>;
  switch (record.type) {
    case 'local':
      assertExactKeys(record, new Set(['type', 'key']), 'Invalid credential locator field');
      return { type: 'local', key: nonEmptyString(record.key, 'locator.key') };
    case 'keychain':
      assertExactKeys(
        record,
        new Set(['type', 'service', 'account']),
        'Invalid credential locator field',
      );
      return {
        type: 'keychain',
        service: nonEmptyString(record.service, 'locator.service'),
        account: nonEmptyString(record.account, 'locator.account'),
      };
    case 'dotenv':
      assertExactKeys(record, new Set(['type', 'path', 'key']), 'Invalid credential locator field');
      return {
        type: 'dotenv',
        path: nonEmptyString(record.path, 'locator.path'),
        key: nonEmptyString(record.key, 'locator.key'),
      };
    case 'git_helper':
      assertExactKeys(record, new Set(['type', 'host']), 'Invalid credential locator field');
      return { type: 'git_helper', host: nonEmptyString(record.host, 'locator.host') };
    case 'docker_helper':
      assertExactKeys(record, new Set(['type', 'registry']), 'Invalid credential locator field');
      return {
        type: 'docker_helper',
        registry: nonEmptyString(record.registry, 'locator.registry'),
      };
    case 'aws_profile':
      assertExactKeys(record, new Set(['type', 'profile']), 'Invalid credential locator field');
      return { type: 'aws_profile', profile: nonEmptyString(record.profile, 'locator.profile') };
    case 'gcp_adc':
      assertExactKeys(record, new Set(['type', 'source']), 'Invalid credential locator field');
      return { type: 'gcp_adc', source: nonEmptyString(record.source, 'locator.source') };
    case 'ssh_agent':
      assertExactKeys(
        record,
        new Set(['type', 'fingerprint']),
        'Invalid credential locator field',
      );
      return {
        type: 'ssh_agent',
        fingerprint: nonEmptyString(record.fingerprint, 'locator.fingerprint'),
      };
    case 'infisical':
      assertExactKeys(
        record,
        new Set(['type', 'projectId', 'environment', 'secretPath', 'secretKey']),
        'Invalid credential locator field',
      );
      return {
        type: 'infisical',
        projectId: nonEmptyString(record.projectId, 'locator.projectId'),
        environment: nonEmptyString(record.environment, 'locator.environment'),
        secretPath: nonEmptyString(record.secretPath, 'locator.secretPath'),
        secretKey: nonEmptyString(record.secretKey, 'locator.secretKey'),
      };
    case 'opaque':
      assertExactKeys(
        record,
        new Set(['type', 'provider', 'locator']),
        'Invalid credential locator field',
      );
      return {
        type: 'opaque',
        provider: nonEmptyString(record.provider, 'locator.provider'),
        locator: nonEmptyString(record.locator, 'locator.locator'),
      };
    default:
      throw new Error('Invalid credential metadata: locator.type');
  }
}

function cloneLocator(locator: ProviderLocator): ProviderLocator {
  return { ...locator } as ProviderLocator;
}

function cloneRef(ref: CredentialRef): CredentialRef {
  return { ...ref, locator: cloneLocator(ref.locator) };
}

function cloneVersion(version: CredentialVersion): CredentialVersion {
  return { ...version };
}

/**
 * Metadata-only registry.
 *
 * Runtime checks reject unknown fields at both the credential and locator
 * levels, so a structurally wider object containing a secret cannot be
 * silently accepted and persisted.
 */
export class CredentialRefRegistry {
  private readonly refs = new Map<CredentialRefId, CredentialRef>();
  private readonly versions = new Map<string, CredentialVersion>();
  private readonly idFactory: CredentialRefIdFactory;
  private sequence = 0;

  constructor(idFactory: CredentialRefIdFactory = createCredentialRefId) {
    this.idFactory = idFactory;
  }

  register(input: RegisterCredentialRefInput): CredentialRef {
    assertExactKeys(
      input as unknown as Record<string, unknown>,
      REGISTER_REF_FIELDS,
      'Invalid credential metadata field',
    );

    const id = input.id ?? this.idFactory();
    if (!isCredentialRefId(id)) throw new Error('Invalid credential metadata: id');
    if (this.refs.has(id)) throw new Error(`CredentialRef already exists: ${errorLabel(id)}`);
    if (!isCredentialKind(input.kind)) throw new Error('Invalid credential metadata: kind');

    const providerId = nonEmptyString(input.providerId, 'providerId');
    const locator = validateLocator(input.locator);
    const createdAt = finiteTimestamp(input.now ?? Date.now(), 'createdAt');
    const ref: CredentialRef = {
      id,
      kind: input.kind,
      providerId,
      locator,
      createdAt,
      updatedAt: createdAt,
    };

    this.refs.set(id, ref);
    return cloneRef(ref);
  }

  get(id: CredentialRefId): CredentialRef | undefined {
    const ref = this.refs.get(id);
    return ref ? cloneRef(ref) : undefined;
  }

  list(): CredentialRef[] {
    return [...this.refs.values()]
      .sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id))
      .map(cloneRef);
  }

  updateProvider(
    id: CredentialRefId,
    providerId: string,
    locator: ProviderLocator,
    now = Date.now(),
  ): CredentialRef {
    const current = this.requireRef(id);
    const updated: CredentialRef = {
      ...current,
      providerId: nonEmptyString(providerId, 'providerId'),
      locator: validateLocator(locator),
      // Same clamp as setVersionStatus: `updatedAt` only ever moves forward.
      updatedAt: Math.max(current.updatedAt, finiteTimestamp(now, 'updatedAt')),
    };

    this.refs.set(id, updated);
    return cloneRef(updated);
  }

  registerVersion(input: RegisterCredentialVersionInput): CredentialVersion {
    assertExactKeys(
      input as unknown as Record<string, unknown>,
      REGISTER_VERSION_FIELDS,
      'Invalid credential version field',
    );
    if (input.status !== undefined && !isVersionStatus(input.status)) {
      throw new Error('Invalid credential version status');
    }

    if (!isCredentialRefId(input.credentialRefId)) {
      throw new Error('Invalid credential metadata: credentialRefId');
    }
    this.requireRef(input.credentialRefId);
    // Normalize before the collision check: the stored key is the trimmed id,
    // so checking the raw input would let " ver_1" overwrite "ver_1" and
    // resurrect a terminal version.
    let id: string;
    if (input.id === undefined) {
      do {
        id = `ver_${++this.sequence}`;
      } while (this.versions.has(id));
    } else {
      id = nonEmptyString(input.id, 'version.id');
      if (this.versions.has(id)) {
        throw new Error(`CredentialVersion already exists: ${errorLabel(id)}`);
      }
    }

    const createdAt = finiteTimestamp(input.createdAt ?? Date.now(), 'version.createdAt');
    const expiresAt =
      input.expiresAt === undefined
        ? undefined
        : finiteTimestamp(input.expiresAt, 'version.expiresAt');
    if (expiresAt !== undefined && expiresAt < createdAt) {
      throw new Error('Invalid credential version: expiresAt precedes createdAt');
    }

    const version: CredentialVersion = {
      id,
      credentialRefId: input.credentialRefId,
      codec: nonEmptyString(input.codec, 'version.codec'),
      fingerprint: versionFingerprint(input.fingerprint),
      ...(input.providerVersion
        ? { providerVersion: nonEmptyString(input.providerVersion, 'version.providerVersion') }
        : {}),
      createdAt,
      ...(expiresAt !== undefined ? { expiresAt } : {}),
      status: input.status ?? 'active',
    };

    if (version.status === 'active') {
      const ref = this.requireRef(version.credentialRefId);
      if (ref.currentVersionId && ref.currentVersionId !== version.id) {
        const previous = this.versions.get(ref.currentVersionId);
        if (previous?.status === 'active' && previous.createdAt > version.createdAt) {
          throw new Error('Active credential version is older than the current version');
        }
      }
    }

    this.versions.set(version.id, version);
    if (version.status === 'active') {
      const ref = this.requireRef(version.credentialRefId);
      if (ref.currentVersionId && ref.currentVersionId !== version.id) {
        const previous = this.versions.get(ref.currentVersionId);
        if (previous?.status === 'active') {
          this.versions.set(previous.id, { ...previous, status: 'superseded' });
        }
      }
      this.refs.set(ref.id, {
        ...ref,
        currentVersionId: version.id,
        updatedAt: Math.max(ref.updatedAt, version.createdAt),
      });
    }

    return cloneVersion(version);
  }

  getVersion(id: string): CredentialVersion | undefined {
    const version = this.versions.get(id);
    return version ? cloneVersion(version) : undefined;
  }

  listVersions(credentialRefId: CredentialRefId): CredentialVersion[] {
    this.requireRef(credentialRefId);
    return [...this.versions.values()]
      .filter((version) => version.credentialRefId === credentialRefId)
      .sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id))
      .map(cloneVersion);
  }

  setVersionStatus(
    id: string,
    status: CredentialVersionStatus,
    now = Date.now(),
  ): CredentialVersion {
    if (!isVersionStatus(status)) throw new Error('Invalid credential version status');

    const current = this.versions.get(id);
    if (!current) throw new Error(`CredentialVersion not found: ${errorLabel(id)}`);
    if (!VERSION_TRANSITIONS[current.status].includes(status)) {
      throw new Error(`Invalid credential version transition: ${current.status} -> ${status}`);
    }
    if (current.status === status) return cloneVersion(current);

    const ref = this.refs.get(current.credentialRefId);
    let refUpdate: CredentialRef | undefined;
    if (
      (status === 'revoked' || status === 'invalid' || status === 'superseded') &&
      ref?.currentVersionId === id
    ) {
      // Clamp forward rather than reject. A future-dated version or a
      // backwards-stepping clock must never be able to block revocation —
      // refusing to retire a compromised credential is worse than a
      // timestamp that stands still.
      refUpdate = {
        ...ref,
        currentVersionId: undefined,
        updatedAt: Math.max(ref.updatedAt, finiteTimestamp(now, 'updatedAt')),
      };
    }

    const next: CredentialVersion = { ...current, status };
    this.versions.set(id, next);
    if (refUpdate) this.refs.set(refUpdate.id, refUpdate);

    return cloneVersion(next);
  }

  private requireRef(id: CredentialRefId): CredentialRef {
    const ref = this.refs.get(id);
    if (!ref) throw new Error(`CredentialRef not found: ${errorLabel(id)}`);
    return ref;
  }
}
