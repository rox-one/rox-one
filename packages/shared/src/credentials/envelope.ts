import { createHmac, timingSafeEqual } from 'node:crypto';
import type { CredentialKind } from '@craft-agent/core/platform';
import type { StoredCredential } from './types.ts';

export const CREDENTIAL_ENVELOPE_FORMAT = 'rox-credential-envelope' as const;
export const CREDENTIAL_ENVELOPE_VERSION = 1 as const;
export const CREDENTIAL_ENVELOPE_CODEC = 'stored-credential/v1' as const;
export const CREDENTIAL_ENVELOPE_FINGERPRINT_ALGORITHM = 'hmac-sha256' as const;

export interface CredentialEnvelopeV1 {
  readonly format: typeof CREDENTIAL_ENVELOPE_FORMAT;
  readonly version: typeof CREDENTIAL_ENVELOPE_VERSION;
  readonly codec: typeof CREDENTIAL_ENVELOPE_CODEC;
  readonly fingerprintAlgorithm: typeof CREDENTIAL_ENVELOPE_FINGERPRINT_ALGORITHM;
  readonly kind: CredentialKind;
  readonly payload: StoredCredential;
  readonly fingerprint: string;
}

export interface CredentialEnvelopeInput {
  readonly kind: CredentialKind;
  readonly payload: StoredCredential;
}

/**
 * The key is installation/provider material and MUST NOT be serialized with the
 * envelope. `binding` is stable metadata such as credentialRef + provider
 * version; it prevents equal payloads in unrelated credentials from sharing a
 * public comparison digest.
 */
export interface CredentialEnvelopeContext {
  readonly fingerprintKey: Uint8Array;
  readonly binding: string;
}

const STRING_FIELDS = new Set([
  'value',
  'refreshToken',
  'clientId',
  'clientSecret',
  'tokenType',
  'idToken',
  'awsAccessKeyId',
  'awsRegion',
  'awsSessionToken',
  'gcpProjectId',
  'gcpRegion',
  'serviceAccountEmail',
]);

const ALLOWED_PAYLOAD_FIELDS = new Set([...STRING_FIELDS, 'expiresAt', 'source']);
const ENVELOPE_FIELDS = new Set([
  'format',
  'version',
  'codec',
  'fingerprintAlgorithm',
  'kind',
  'payload',
  'fingerprint',
]);
const ENVELOPE_INPUT_FIELDS = new Set(['kind', 'payload']);
const CONTEXT_FIELDS = new Set(['fingerprintKey', 'binding']);
const FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/;
const MAX_CREDENTIAL_FIELD_LENGTH = 1_048_576;
const MAX_CREDENTIAL_ENVELOPE_LENGTH = 1_100_000;
const MAX_BINDING_LENGTH = 4_096;

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCredentialKind(value: unknown): value is CredentialKind {
  return typeof value === 'string' && CREDENTIAL_KINDS.includes(value as CredentialKind);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>): boolean {
  return Object.keys(value).every((key) => allowed.has(key));
}

function canonicalize(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error('Credential payload contains a non-finite number');
    }
    return JSON.stringify(value);
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`)
      .join(',')}}`;
  }
  throw new Error('Credential payload contains an unsupported value');
}

function normalizePayload(value: unknown): StoredCredential {
  if (
    !isRecord(value) ||
    typeof value.value !== 'string' ||
    value.value.length === 0 ||
    value.value.length > MAX_CREDENTIAL_FIELD_LENGTH
  ) {
    throw new Error('Credential payload must contain a bounded non-empty scalar value');
  }
  if (!hasOnlyKeys(value, ALLOWED_PAYLOAD_FIELDS)) {
    throw new Error('Credential payload contains an unsupported field');
  }

  const payload: Record<string, unknown> = { value: value.value };
  for (const key of Object.keys(value)) {
    if (key === 'value') continue;
    const field = value[key];

    if (STRING_FIELDS.has(key)) {
      if (typeof field !== 'string' || field.length > MAX_CREDENTIAL_FIELD_LENGTH) {
        throw new Error(`Credential payload field must be a bounded scalar: ${key}`);
      }
      payload[key] = field;
      continue;
    }

    if (key === 'expiresAt') {
      if (typeof field !== 'number' || !Number.isFinite(field) || field < 0) {
        throw new Error('Credential payload field must be a finite timestamp: expiresAt');
      }
      payload[key] = field;
      continue;
    }

    if (key === 'source') {
      if (field !== 'native' && field !== 'cli') {
        throw new Error('Credential payload source is invalid');
      }
      payload[key] = field;
    }
  }

  return payload as unknown as StoredCredential;
}

function normalizeContext(value: CredentialEnvelopeContext): CredentialEnvelopeContext {
  const record = value as unknown as Record<string, unknown>;
  if (!hasOnlyKeys(record, CONTEXT_FIELDS)) {
    throw new Error('Credential envelope context contains an unsupported field');
  }
  if (!(value.fingerprintKey instanceof Uint8Array) || value.fingerprintKey.byteLength < 32) {
    throw new Error('Credential envelope fingerprint key must contain at least 32 bytes');
  }
  if (typeof value.binding !== 'string') {
    throw new Error('Credential envelope binding is invalid');
  }
  const binding = value.binding.trim();
  if (binding.length === 0 || binding.length > MAX_BINDING_LENGTH) {
    throw new Error('Credential envelope binding is invalid');
  }
  return {
    fingerprintKey: new Uint8Array(value.fingerprintKey),
    binding,
  };
}

function hexToBytes(value: string): Uint8Array {
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < value.length; index += 2) {
    bytes[index / 2] = Number.parseInt(value.slice(index, index + 2), 16);
  }
  return bytes;
}

function fingerprintsEqual(left: string, right: string): boolean {
  if (!FINGERPRINT_PATTERN.test(left) || !FINGERPRINT_PATTERN.test(right)) return false;
  return timingSafeEqual(hexToBytes(left), hexToBytes(right));
}

/**
 * Keyed, context-bound HMAC-SHA-256 version fingerprint.
 *
 * The digest can leave the provider boundary as metadata; the key and payload
 * cannot. This avoids publishing a directly dictionary-testable raw secret
 * hash and makes fingerprints credential/provider-version specific.
 */
export function credentialPayloadFingerprint(
  kind: CredentialKind,
  payload: StoredCredential,
  context: CredentialEnvelopeContext,
): string {
  if (!isCredentialKind(kind)) throw new Error('Credential envelope kind is invalid');
  const normalizedPayload = normalizePayload(payload);
  const normalizedContext = normalizeContext(context);

  return createHmac('sha256', normalizedContext.fingerprintKey)
    .update(
      canonicalize({
        binding: normalizedContext.binding,
        kind,
        payload: normalizedPayload,
      }),
    )
    .digest('hex');
}

export function encodeCredentialEnvelope(
  input: CredentialEnvelopeInput,
  context: CredentialEnvelopeContext,
): string {
  const record = input as unknown as Record<string, unknown>;
  if (!hasOnlyKeys(record, ENVELOPE_INPUT_FIELDS)) {
    throw new Error('Credential envelope input contains an unsupported field');
  }
  if (!isCredentialKind(input.kind)) throw new Error('Credential envelope kind is invalid');

  const payload = normalizePayload(input.payload);
  const envelope: CredentialEnvelopeV1 = {
    format: CREDENTIAL_ENVELOPE_FORMAT,
    version: CREDENTIAL_ENVELOPE_VERSION,
    codec: CREDENTIAL_ENVELOPE_CODEC,
    fingerprintAlgorithm: CREDENTIAL_ENVELOPE_FINGERPRINT_ALGORITHM,
    kind: input.kind,
    payload,
    fingerprint: credentialPayloadFingerprint(input.kind, payload, context),
  };

  const serialized = JSON.stringify(envelope);
  if (serialized.length > MAX_CREDENTIAL_ENVELOPE_LENGTH) {
    throw new Error('Credential envelope exceeds the size limit');
  }
  return serialized;
}

/**
 * Decode only the current envelope. Invalid input returns null so callers can
 * preserve the legacy source and enter repair flow instead of guessing.
 */
export function decodeCredentialEnvelope(
  serialized: string,
  context: CredentialEnvelopeContext,
): CredentialEnvelopeV1 | null {
  try {
    if (serialized.length > MAX_CREDENTIAL_ENVELOPE_LENGTH) return null;
    const parsed: unknown = JSON.parse(serialized);
    if (!isRecord(parsed) || !hasOnlyKeys(parsed, ENVELOPE_FIELDS)) return null;
    if (
      parsed.format !== CREDENTIAL_ENVELOPE_FORMAT ||
      parsed.version !== CREDENTIAL_ENVELOPE_VERSION ||
      parsed.codec !== CREDENTIAL_ENVELOPE_CODEC ||
      parsed.fingerprintAlgorithm !== CREDENTIAL_ENVELOPE_FINGERPRINT_ALGORITHM ||
      !isCredentialKind(parsed.kind) ||
      typeof parsed.fingerprint !== 'string' ||
      !FINGERPRINT_PATTERN.test(parsed.fingerprint)
    ) {
      return null;
    }

    const payload = normalizePayload(parsed.payload);
    const fingerprint = credentialPayloadFingerprint(parsed.kind, payload, context);
    if (!fingerprintsEqual(fingerprint, parsed.fingerprint)) return null;

    return {
      format: CREDENTIAL_ENVELOPE_FORMAT,
      version: CREDENTIAL_ENVELOPE_VERSION,
      codec: CREDENTIAL_ENVELOPE_CODEC,
      fingerprintAlgorithm: CREDENTIAL_ENVELOPE_FINGERPRINT_ALGORITHM,
      kind: parsed.kind,
      payload,
      fingerprint,
    };
  } catch {
    return null;
  }
}

/**
 * Read the new envelope without breaking the existing legacy payload shape.
 * Legacy values are wrapped in memory only; this function does not rewrite or
 * delete the legacy source.
 */
export function decodeCredentialEnvelopeOrLegacy(
  raw: unknown,
  kind: CredentialKind,
  context: CredentialEnvelopeContext,
): CredentialEnvelopeV1 | null {
  if (!isCredentialKind(kind)) return null;
  if (typeof raw === 'string') return decodeCredentialEnvelope(raw, context);

  try {
    const payload = normalizePayload(raw);
    return {
      format: CREDENTIAL_ENVELOPE_FORMAT,
      version: CREDENTIAL_ENVELOPE_VERSION,
      codec: CREDENTIAL_ENVELOPE_CODEC,
      fingerprintAlgorithm: CREDENTIAL_ENVELOPE_FINGERPRINT_ALGORITHM,
      kind,
      payload,
      fingerprint: credentialPayloadFingerprint(kind, payload, context),
    };
  } catch {
    return null;
  }
}
