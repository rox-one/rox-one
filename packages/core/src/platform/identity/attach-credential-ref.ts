import type { ServiceConnection } from './types.ts';
import {
  CredentialRefRegistry,
  isCredentialRefRegistry,
  isCredentialRefId,
  type CredentialKind,
  type ProviderLocator,
} from './credential-types.ts';

const CONNECTION_FIELDS = ['id', 'workspaceId', 'provider', 'accountLabel', 'credentialRef', 'status', 'readOnly'] as const;
const INPUT_FIELDS = ['kind', 'providerId', 'locator', 'now'] as const;
const LOCATOR_FIELDS = ['type', 'key', 'service', 'account', 'path', 'host', 'registry', 'profile', 'source', 'fingerprint', 'projectId', 'environment', 'secretPath', 'secretKey', 'provider', 'locator'] as const;

function snapshotAllowedFields<T extends object>(value: T, allowed: readonly string[], label: string): T {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new Error(`Invalid credential metadata: ${label}`);
  }
  const record: Record<string, unknown> = Object.create(null);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== 'string' || !allowed.includes(key) || descriptor?.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
      throw new Error(`Invalid credential metadata field: ${String(key)}`);
    }
    record[key] = descriptor.value;
  }
  return record as T;
}

export interface AttachCredentialRefInput {
  readonly kind: CredentialKind;
  readonly providerId: string;
  readonly locator: ProviderLocator;
  readonly now?: number;
}

export function attachCredentialRef(
  connection: ServiceConnection,
  registry: CredentialRefRegistry,
  input: AttachCredentialRefInput,
): ServiceConnection {
  const connectionRecord = snapshotAllowedFields(connection, CONNECTION_FIELDS, 'connection');
  const inputRecord = snapshotAllowedFields(input, INPUT_FIELDS, 'input');
  snapshotAllowedFields(inputRecord.locator, LOCATOR_FIELDS, 'locator');
  if (!isCredentialRefRegistry(registry)) {
    throw new Error('Invalid credential metadata: registry');
  }
  const ref = CredentialRefRegistry.prototype.register.call(registry, {
    kind: inputRecord.kind,
    providerId: inputRecord.providerId,
    locator: inputRecord.locator,
    now: inputRecord.now,
  });
  if (!isCredentialRefId(ref.id)) {
    throw new Error('Invalid credential metadata: id');
  }
  return { ...connectionRecord, credentialRef: ref.id };
}
