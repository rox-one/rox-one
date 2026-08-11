import { describe, expect, it } from 'bun:test';
import {
  CredentialRefRegistry,
  createCredentialRefId,
  isCredentialRefId,
} from './credential-types.ts';

const FIXED_REF = 'cred_123e4567-e89b-12d3-a456-426614174000' as const;

describe('CredentialRefRegistry', () => {
  it('creates opaque stable refs and stores metadata only', () => {
    const registry = new CredentialRefRegistry(() => FIXED_REF);
    const ref = registry.register({
      kind: 'api_key',
      providerId: 'local',
      locator: { type: 'local', key: 'github/default' },
      now: 100,
    });

    expect(ref.id).toBe(FIXED_REF);
    expect(ref.createdAt).toBe(100);
    expect('value' in ref).toBe(false);
    expect(JSON.stringify(registry.list())).not.toContain('secret');
  });

  it('generates browser-safe cred UUID identifiers', () => {
    const id = createCredentialRefId();
    expect(isCredentialRefId(id)).toBe(true);
  });

  it('returns clones instead of mutable registry state', () => {
    const registry = new CredentialRefRegistry(() => FIXED_REF);
    const ref = registry.register({
      kind: 'api_key',
      providerId: 'local',
      locator: { type: 'local', key: 'github/default' },
      now: 100,
    });

    (ref.locator as { key: string }).key = 'mutated';
    expect(registry.get(FIXED_REF)?.locator).toEqual({
      type: 'local',
      key: 'github/default',
    });
  });

  it('keeps the ref identity while replacing provider metadata', () => {
    const registry = new CredentialRefRegistry(() => FIXED_REF);
    const original = registry.register({
      kind: 'bearer_token',
      providerId: 'local',
      locator: { type: 'local', key: 'github/default' },
      now: 100,
    });

    const moved = registry.updateProvider(
      original.id,
      'infisical',
      {
        type: 'infisical',
        projectId: 'project',
        environment: 'prod',
        secretPath: '/github',
        secretKey: 'token',
      },
      200,
    );

    expect(moved.id).toBe(original.id);
    expect(moved.providerId).toBe('infisical');
    expect(moved.updatedAt).toBe(200);
  });

  it('rejects raw or unknown fields at credential and locator boundaries', () => {
    const registry = new CredentialRefRegistry(() => FIXED_REF);

    const topLevelSecret = {
      kind: 'api_key',
      providerId: 'local',
      locator: { type: 'local', key: 'ok' },
      value: 'secret',
    } as never;
    expect(() => registry.register(topLevelSecret)).toThrow();

    const nestedSecret = {
      kind: 'api_key',
      providerId: 'local',
      locator: { type: 'local', key: 'ok', value: 'secret' },
    } as never;
    expect(() => registry.register(nestedSecret)).toThrow();
  });

  it('rejects malformed ids, kinds, locators, and timestamps', () => {
    const registry = new CredentialRefRegistry();

    expect(() =>
      registry.register({
        id: 'cred_not-a-uuid',
        kind: 'api_key',
        providerId: 'local',
        locator: { type: 'local', key: 'ok' },
      } as never),
    ).toThrow();

    expect(() =>
      registry.register({
        kind: 'wrong',
        providerId: 'local',
        locator: { type: 'local', key: 'ok' },
      } as never),
    ).toThrow();

    expect(() =>
      registry.register({
        kind: 'api_key',
        providerId: 'local',
        locator: { type: 'local', key: '' },
      }),
    ).toThrow();

    expect(() =>
      registry.register({
        kind: 'api_key',
        providerId: 'local',
        locator: { type: 'local', key: 'ok' },
        now: Number.NaN,
      }),
    ).toThrow();
  });

  it('supersedes the prior active version and clears current on revoke', () => {
    const registry = new CredentialRefRegistry(() => FIXED_REF);
    const ref = registry.register({
      kind: 'oauth2_token_set',
      providerId: 'local',
      locator: { type: 'local', key: 'github/default' },
      now: 100,
    });
    const first = registry.registerVersion({
      credentialRefId: ref.id,
      codec: 'stored-credential/v1',
      fingerprint: 'a'.repeat(64),
      createdAt: 110,
    });
    const second = registry.registerVersion({
      credentialRefId: ref.id,
      codec: 'stored-credential/v1',
      fingerprint: 'b'.repeat(64),
      createdAt: 120,
    });

    expect(registry.getVersion(first.id)?.status).toBe('superseded');
    expect(registry.get(ref.id)?.currentVersionId).toBe(second.id);

    expect(registry.setVersionStatus(second.id, 'revoked', 130).status).toBe('revoked');
    expect(registry.get(ref.id)?.currentVersionId).toBeUndefined();
    expect(registry.get(ref.id)?.updatedAt).toBe(130);
  });

  it('rejects unknown version fields and invalid runtime statuses', () => {
    const registry = new CredentialRefRegistry(() => FIXED_REF);
    const ref = registry.register({
      kind: 'api_key',
      providerId: 'local',
      locator: { type: 'local', key: 'key' },
      now: 100,
    });

    expect(() =>
      registry.registerVersion({
        credentialRefId: ref.id,
        codec: 'stored-credential/v1',
        fingerprint: 'a'.repeat(64),
        secret: 'value',
      } as never),
    ).toThrow();

    expect(() =>
      registry.registerVersion({
        credentialRefId: ref.id,
        codec: 'stored-credential/v1',
        fingerprint: 'a'.repeat(64),
        status: 'unknown',
      } as never),
    ).toThrow();

    expect(() =>
      registry.registerVersion({
        credentialRefId: ref.id,
        codec: 'stored-credential/v1',
        fingerprint: 'raw-secret-not-a-digest',
      }),
    ).toThrow();

    const version = registry.registerVersion({
      credentialRefId: ref.id,
      codec: 'stored-credential/v1',
      fingerprint: 'a'.repeat(64),
      createdAt: 110,
    });
    expect(() => registry.setVersionStatus(version.id, 'unknown' as never)).toThrow();
  });

  it('rejects an expiry before creation', () => {
    const registry = new CredentialRefRegistry(() => FIXED_REF);
    const ref = registry.register({
      kind: 'api_key',
      providerId: 'local',
      locator: { type: 'local', key: 'key' },
      now: 100,
    });

    expect(() =>
      registry.registerVersion({
        credentialRefId: ref.id,
        codec: 'stored-credential/v1',
        fingerprint: 'a'.repeat(64),
        createdAt: 200,
        expiresAt: 199,
      }),
    ).toThrow();
  });

  it('keeps revoked and invalid versions terminal', () => {
    const registry = new CredentialRefRegistry(() => FIXED_REF);
    const ref = registry.register({
      kind: 'api_key',
      providerId: 'local',
      locator: { type: 'local', key: 'key' },
      now: 100,
    });
    const version = registry.registerVersion({
      credentialRefId: ref.id,
      codec: 'stored-credential/v1',
      fingerprint: 'a'.repeat(64),
      createdAt: 110,
    });

    registry.setVersionStatus(version.id, 'revoked', 120);
    expect(() => registry.setVersionStatus(version.id, 'active', 130)).toThrow();
  });

  it('does not silently replace the current version with an older active version', () => {
    const registry = new CredentialRefRegistry(() => FIXED_REF);
    const ref = registry.register({
      kind: 'api_key',
      providerId: 'local',
      locator: { type: 'local', key: 'key' },
      now: 100,
    });

    registry.registerVersion({
      id: 'ver_new',
      credentialRefId: ref.id,
      codec: 'stored-credential/v1',
      fingerprint: 'b'.repeat(64),
      createdAt: 200,
    });

    expect(() =>
      registry.registerVersion({
        id: 'ver_old',
        credentialRefId: ref.id,
        codec: 'stored-credential/v1',
        fingerprint: 'a'.repeat(64),
        createdAt: 150,
      }),
    ).toThrow();
    expect(registry.get(ref.id)?.currentVersionId).toBe('ver_new');
    expect(registry.getVersion('ver_old')).toBeUndefined();
  });

  it('requires monotonic ref timestamps when clearing the current version', () => {
    const registry = new CredentialRefRegistry(() => FIXED_REF);
    const ref = registry.register({
      kind: 'api_key',
      providerId: 'local',
      locator: { type: 'local', key: 'key' },
      now: 100,
    });
    const version = registry.registerVersion({
      credentialRefId: ref.id,
      codec: 'stored-credential/v1',
      fingerprint: 'a'.repeat(64),
      createdAt: 200,
    });

    expect(() => registry.setVersionStatus(version.id, 'revoked', 199)).toThrow();
    expect(registry.getVersion(version.id)?.status).toBe('active');
    expect(registry.get(ref.id)?.currentVersionId).toBe(version.id);
  });

  it('lists versions deterministically by creation time and id', () => {
    const registry = new CredentialRefRegistry(() => FIXED_REF);
    const ref = registry.register({
      kind: 'api_key',
      providerId: 'local',
      locator: { type: 'local', key: 'key' },
      now: 100,
    });

    registry.registerVersion({
      id: 'ver_b',
      credentialRefId: ref.id,
      codec: 'stored-credential/v1',
      fingerprint: 'b'.repeat(64),
      createdAt: 120,
      status: 'superseded',
    });
    registry.registerVersion({
      id: 'ver_a',
      credentialRefId: ref.id,
      codec: 'stored-credential/v1',
      fingerprint: 'a'.repeat(64),
      createdAt: 110,
      status: 'superseded',
    });

    expect(registry.listVersions(ref.id).map((version) => version.id)).toEqual([
      'ver_a',
      'ver_b',
    ]);
  });
});
