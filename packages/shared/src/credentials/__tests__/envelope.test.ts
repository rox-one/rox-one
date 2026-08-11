import { describe, expect, it } from 'bun:test';
import {
  CREDENTIAL_ENVELOPE_FINGERPRINT_ALGORITHM,
  credentialPayloadFingerprint,
  decodeCredentialEnvelope,
  decodeCredentialEnvelopeOrLegacy,
  encodeCredentialEnvelope,
} from '../envelope.ts';

const KEY_A = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
const KEY_B = Uint8Array.from({ length: 32 }, (_, index) => 255 - index);
const CONTEXT_A = {
  fingerprintKey: KEY_A,
  binding: 'cred_123e4567-e89b-12d3-a456-426614174000/provider-version-1',
};
const CONTEXT_B = {
  fingerprintKey: KEY_A,
  binding: 'cred_123e4567-e89b-12d3-a456-426614174000/provider-version-2',
};

describe('credential envelope v1', () => {
  it('round-trips a strict versioned envelope', () => {
    const encoded = encodeCredentialEnvelope(
      {
        kind: 'oauth2_token_set',
        payload: {
          value: 'access-token',
          refreshToken: 'refresh-token',
          expiresAt: 1_800_000_000_000,
          source: 'native',
        },
      },
      CONTEXT_A,
    );

    const decoded = decodeCredentialEnvelope(encoded, CONTEXT_A);
    expect(decoded?.fingerprintAlgorithm).toBe(
      CREDENTIAL_ENVELOPE_FINGERPRINT_ALGORITHM,
    );
    expect(decoded?.payload).toEqual({
      value: 'access-token',
      refreshToken: 'refresh-token',
      expiresAt: 1_800_000_000_000,
      source: 'native',
    });
  });

  it('is stable for equivalent payload key order under the same context', () => {
    const first = credentialPayloadFingerprint(
      'oauth2_token_set',
      {
        value: 'access',
        refreshToken: 'refresh',
        expiresAt: 123,
      },
      CONTEXT_A,
    );
    const second = credentialPayloadFingerprint(
      'oauth2_token_set',
      {
        expiresAt: 123,
        refreshToken: 'refresh',
        value: 'access',
      },
      CONTEXT_A,
    );

    expect(first).toBe(second);
  });

  it('produces one fingerprint for every permutation of the same scalar fields', () => {
    type Entry = readonly [string, string | number];
    const entries: Entry[] = [
      ['value', 'access'],
      ['refreshToken', 'refresh'],
      ['expiresAt', 123],
      ['source', 'native'],
    ];
    const permutations: Entry[][] = [];

    function permute(items: Entry[], start = 0): void {
      if (start === items.length) {
        permutations.push([...items]);
        return;
      }
      for (let index = start; index < items.length; index += 1) {
        const copy = [...items];
        [copy[start], copy[index]] = [copy[index]!, copy[start]!];
        permute(copy, start + 1);
      }
    }

    permute(entries);
    const fingerprints = new Set(
      permutations.map((permutation) =>
        credentialPayloadFingerprint(
          'oauth2_token_set',
          Object.fromEntries(permutation) as never,
          CONTEXT_A,
        ),
      ),
    );

    expect(fingerprints.size).toBe(1);
  });

  it('binds a fingerprint to the credential/provider version context', () => {
    const payload = { value: 'same-secret' };
    const first = credentialPayloadFingerprint('api_key', payload, CONTEXT_A);
    const second = credentialPayloadFingerprint('api_key', payload, CONTEXT_B);

    expect(first).not.toBe(second);
  });

  it('never serializes the fingerprint key or binding into the envelope', () => {
    const encoded = encodeCredentialEnvelope(
      { kind: 'api_key', payload: { value: 'secret' } },
      CONTEXT_A,
    );
    const parsed = JSON.parse(encoded) as Record<string, unknown>;

    expect('fingerprintKey' in parsed).toBe(false);
    expect('binding' in parsed).toBe(false);
    expect(encoded).not.toContain(CONTEXT_A.binding);
  });

  it('rejects a wrong key or binding without exposing the payload', () => {
    const encoded = encodeCredentialEnvelope(
      { kind: 'api_key', payload: { value: 'secret' } },
      CONTEXT_A,
    );

    expect(
      decodeCredentialEnvelope(encoded, {
        fingerprintKey: KEY_B,
        binding: CONTEXT_A.binding,
      }),
    ).toBeNull();
    expect(decodeCredentialEnvelope(encoded, CONTEXT_B)).toBeNull();
  });

  it('rejects tampered payloads and top-level metadata', () => {
    const encoded = encodeCredentialEnvelope(
      { kind: 'api_key', payload: { value: 'secret' } },
      CONTEXT_A,
    );
    const parsed = JSON.parse(encoded) as Record<string, unknown>;

    const payloadTamper = {
      ...parsed,
      payload: { value: 'different' },
    };
    expect(
      decodeCredentialEnvelope(JSON.stringify(payloadTamper), CONTEXT_A),
    ).toBeNull();

    const metadataTamper = {
      ...parsed,
      unexpected: 'field',
    };
    expect(
      decodeCredentialEnvelope(JSON.stringify(metadataTamper), CONTEXT_A),
    ).toBeNull();
  });

  it('rejects nested values and unknown payload fields', () => {
    expect(() =>
      encodeCredentialEnvelope(
        {
          kind: 'api_key',
          payload: { value: { nested: true } } as never,
        },
        CONTEXT_A,
      ),
    ).toThrow();

    expect(() =>
      encodeCredentialEnvelope(
        {
          kind: 'api_key',
          payload: { value: 'secret', extra: 'not-allowed' } as never,
        },
        CONTEXT_A,
      ),
    ).toThrow();
  });

  it('rejects invalid kinds, short keys, and unknown context fields', () => {
    expect(() =>
      encodeCredentialEnvelope(
        { kind: 'wrong' as never, payload: { value: 'secret' } },
        CONTEXT_A,
      ),
    ).toThrow();

    expect(() =>
      encodeCredentialEnvelope(
        { kind: 'api_key', payload: { value: 'secret' } },
        { fingerprintKey: new Uint8Array(31), binding: 'binding' },
      ),
    ).toThrow();

    expect(() =>
      encodeCredentialEnvelope(
        { kind: 'api_key', payload: { value: 'secret' } },
        {
          fingerprintKey: KEY_A,
          binding: 'binding',
          leaked: 'secret',
        } as never,
      ),
    ).toThrow();
  });

  it('rejects malformed envelopes and oversized values fail closed', () => {
    expect(decodeCredentialEnvelope('not-json', CONTEXT_A)).toBeNull();
    expect(
      decodeCredentialEnvelope(
        JSON.stringify({
          format: 'rox-credential-envelope',
          version: 999,
        }),
        CONTEXT_A,
      ),
    ).toBeNull();

    expect(() =>
      encodeCredentialEnvelope(
        {
          kind: 'api_key',
          payload: { value: 'x'.repeat(1_048_577) },
        },
        CONTEXT_A,
      ),
    ).toThrow();
  });

  it('reads a legacy StoredCredential in memory without mutating it', () => {
    const legacy = {
      value: 'legacy-secret',
      refreshToken: 'legacy-refresh',
      source: 'cli' as const,
    };
    const before = JSON.stringify(legacy);

    const decoded = decodeCredentialEnvelopeOrLegacy(
      legacy,
      'oauth2_token_set',
      CONTEXT_A,
    );

    expect(decoded?.payload).toEqual(legacy);
    expect(decoded?.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(legacy)).toBe(before);
  });

  it('does not reinterpret arbitrary legacy strings or invalid objects', () => {
    expect(
      decodeCredentialEnvelopeOrLegacy(
        'raw-token-that-is-not-an-envelope',
        'api_key',
        CONTEXT_A,
      ),
    ).toBeNull();
    expect(
      decodeCredentialEnvelopeOrLegacy(
        { value: ['not', 'scalar'] },
        'api_key',
        CONTEXT_A,
      ),
    ).toBeNull();
  });

  it('returns a defensive payload copy', () => {
    const input = { value: 'secret', clientId: 'client' };
    const encoded = encodeCredentialEnvelope(
      { kind: 'oauth2_token_set', payload: input },
      CONTEXT_A,
    );
    input.clientId = 'mutated';

    expect(decodeCredentialEnvelope(encoded, CONTEXT_A)?.payload.clientId).toBe(
      'client',
    );
  });
});
