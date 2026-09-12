import { describe, expect, it } from 'bun:test';
import {
  CredentialRefRegistry,
  createCredentialRefId,
  isCredentialRefId,
} from './credential-types.ts';

const REF_ID = 'cred_123e4567-e89b-12d3-a456-426614174000';
const HEX_A = 'a'.repeat(64);
const HEX_B = 'b'.repeat(64);

function createRegistry(): CredentialRefRegistry {
  return new CredentialRefRegistry(() => REF_ID);
}

describe('CredentialRefRegistry', () => {
  it('creates opaque stable refs and stores metadata only', () => {
    const registry = createRegistry();
    const ref = registry.register({
      kind: 'api_key',
      providerId: 'local',
      locator: { type: 'local', key: 'github/default' },
      now: 100,
    });

    expect(ref.id).toBe(REF_ID);
    expect(ref.createdAt).toBe(100);
    expect('value' in ref).toBe(false);
    expect('payload' in ref).toBe(false);
    expect('storageMode' in ref).toBe(false);
    const listed = JSON.stringify(registry.list());
    expect(listed).not.toContain('"value"');
    expect(listed).not.toContain('"payload"');
    expect(listed).not.toContain('"secret"');
  });

  it('keeps the ref identity while replacing provider metadata', () => {
    const registry = createRegistry();
    const original = registry.register({
      kind: 'bearer_token',
      providerId: 'local',
      locator: { type: 'local', key: 'github/default' },
      now: 100,
    });

    const moved = registry.updateProvider(original.id, 'infisical', {
      type: 'infisical',
      projectId: 'project',
      environment: 'prod',
      secretPath: '/github',
      secretKey: 'token',
    }, 200);

    expect(moved.id).toBe(original.id);
    expect(moved.providerId).toBe('infisical');
    expect(moved.updatedAt).toBe(200);
    const listed = JSON.stringify([registry.get(original.id), ...registry.list()]);
    expect(listed).not.toContain('"value"');
    expect(listed).not.toContain('"payload"');
    expect(listed).not.toContain('"secret"');
  });

  it('tracks versions as metadata and clears the current version on revoke', () => {
    const registry = createRegistry();
    const ref = registry.register({
      kind: 'oauth2_token_set',
      providerId: 'local',
      locator: { type: 'local', key: 'github/default' },
      now: 100,
    });
    const version = registry.registerVersion({
      credentialRefId: ref.id,
      codec: 'stored-credential/v1',
      fingerprint: HEX_A,
      createdAt: 110,
    });

    expect(registry.get(ref.id)?.currentVersionId).toBe(version.id);
    const nextVersion = registry.registerVersion({
      credentialRefId: ref.id,
      codec: 'stored-credential/v1',
      fingerprint: HEX_B,
      createdAt: 120,
    });
    expect(registry.getVersion(version.id)?.status).toBe('superseded');
    expect(registry.get(ref.id)?.currentVersionId).toBe(nextVersion.id);

    expect(registry.setVersionStatus(nextVersion.id, 'revoked').status).toBe('revoked');
    expect(registry.get(ref.id)?.currentVersionId).toBeUndefined();
  });

  it('rejects an invalid version status at runtime', () => {
    const registry = createRegistry();
    const ref = registry.register({
      kind: 'api_key',
      providerId: 'local',
      locator: { type: 'local', key: 'github/default' },
      now: 100,
    });
    const version = registry.registerVersion({
      credentialRefId: ref.id,
      codec: 'stored-credential/v1',
      fingerprint: HEX_A,
      createdAt: 110,
    });
    expect(() => registry.setVersionStatus(version.id, 'unknown' as never)).toThrow();
    expect(registry.getVersion(version.id)?.status).toBe('active');
  });

  it('rejects malformed metadata instead of accepting a secret payload', () => {
    const registry = new CredentialRefRegistry();
    expect(() => registry.register({
      kind: 'api_key',
      providerId: 'local',
      locator: { type: 'local', key: '' },
    })).toThrow();
    const malformed = {
      kind: 'api_key',
      providerId: 'local',
      locator: { type: 'local', key: 'ok' },
      value: 'literal-secret-token',
    } as never;
    expect(() => registry.register(malformed)).toThrow();
    const listed = JSON.stringify(registry.list());
    expect(listed).not.toContain('literal-secret-token');
    expect(listed).not.toContain('"value"');
    expect(listed).not.toContain('"payload"');
    expect(listed).not.toContain('"secret"');
  });

  it('rejects hidden and nested secret fields at the registry boundary', () => {
    const registry = createRegistry();
    const hiddenRef = {
      kind: 'api_key',
      providerId: 'local',
      locator: { type: 'local', key: 'github/default' },
    };
    Object.defineProperty(hiddenRef, 'value', { value: 'literal-secret-token' });
    expect(() => registry.register(hiddenRef as never)).toThrow();
    expect(() => registry.register({
      kind: 'api_key',
      providerId: 'local',
      locator: { type: 'local', key: 'github/default', payload: { secret: 'literal-secret-token' } },
    } as never)).toThrow();

    const ref = registry.register({
      kind: 'api_key',
      providerId: 'local',
      locator: { type: 'local', key: 'github/default' },
    });
    const hiddenVersion = {
      credentialRefId: ref.id,
      codec: 'stored-credential/v1',
      fingerprint: HEX_A,
    };
    Object.defineProperty(hiddenVersion, 'payload', { value: { secret: 'literal-secret-token' } });
    expect(() => registry.registerVersion(hiddenVersion as never)).toThrow();
    expect(() => registry.updateProvider(ref.id, 'local', {
      type: 'local',
      key: 'github/next',
      secret: 'literal-secret-token',
    } as never)).toThrow();
  });

  it('rejects a duplicate CredentialRef id and keeps the first record', () => {
    const registry = createRegistry();
    const first = registry.register({
      kind: 'api_key',
      providerId: 'local',
      locator: { type: 'local', key: 'github/default' },
      now: 100,
    });
    expect(() => registry.register({
      id: first.id,
      kind: 'bearer_token',
      providerId: 'other',
      locator: { type: 'local', key: 'other/key' },
      now: 200,
    })).toThrow();
    expect(registry.list()).toHaveLength(1);
    expect(registry.get(first.id)?.kind).toBe('api_key');
    expect(registry.get(first.id)?.providerId).toBe('local');
  });

  it('rejects register with an orphan currentVersionId', () => {
    const registry = createRegistry();
    expect(() => registry.register({
      kind: 'api_key',
      providerId: 'local',
      locator: { type: 'local', key: 'github/default' },
      currentVersionId: 'ver_missing',
      now: 100,
    })).toThrow();
    expect(registry.list()).toHaveLength(0);
  });

  it('rejects reviving a revoked version to active', () => {
    const registry = createRegistry();
    const ref = registry.register({
      kind: 'api_key',
      providerId: 'local',
      locator: { type: 'local', key: 'github/default' },
      now: 100,
    });
    const version = registry.registerVersion({
      credentialRefId: ref.id,
      codec: 'stored-credential/v1',
      fingerprint: HEX_A,
      createdAt: 110,
    });
    expect(registry.setVersionStatus(version.id, 'revoked').status).toBe('revoked');
    expect(() => registry.setVersionStatus(version.id, 'active')).toThrow();
    expect(registry.getVersion(version.id)?.status).toBe('revoked');
  });

  it('rejects reviving an invalid version to active', () => {
    const registry = createRegistry();
    const ref = registry.register({
      kind: 'api_key',
      providerId: 'local',
      locator: { type: 'local', key: 'github/default' },
      now: 100,
    });
    const version = registry.registerVersion({
      credentialRefId: ref.id,
      codec: 'stored-credential/v1',
      fingerprint: HEX_A,
      createdAt: 110,
    });
    expect(registry.setVersionStatus(version.id, 'invalid').status).toBe('invalid');
    expect(() => registry.setVersionStatus(version.id, 'active')).toThrow();
    expect(registry.getVersion(version.id)?.status).toBe('invalid');
  });

  it('keeps terminal version statuses irreversible', () => {
    const registry = createRegistry();
    const ref = registry.register({
      kind: 'api_key',
      providerId: 'local',
      locator: { type: 'local', key: 'github/default' },
    });
    const version = registry.registerVersion({
      credentialRefId: ref.id,
      codec: 'stored-credential/v1',
      fingerprint: HEX_A,
    });
    registry.setVersionStatus(version.id, 'revoked');
    expect(() => registry.setVersionStatus(version.id, 'superseded')).toThrow();
    expect(() => registry.setVersionStatus(version.id, 'active')).toThrow();
  });

  it('makes a reactivated superseded version the sole current active version', () => {
    const registry = createRegistry();
    const ref = registry.register({
      kind: 'api_key',
      providerId: 'local',
      locator: { type: 'local', key: 'github/default' },
    });
    const first = registry.registerVersion({
      credentialRefId: ref.id,
      codec: 'stored-credential/v1',
      fingerprint: HEX_A,
      createdAt: 100,
    });
    const second = registry.registerVersion({
      credentialRefId: ref.id,
      codec: 'stored-credential/v1',
      fingerprint: HEX_B,
      createdAt: 200,
    });
    expect(registry.setVersionStatus(first.id, 'active').status).toBe('active');
    expect(registry.get(ref.id)?.currentVersionId).toBe(first.id);
    expect(registry.getVersion(second.id)?.status).toBe('superseded');
  });

  it('leaves version state unchanged when reactivation cannot read the clock', () => {
    const registry = createRegistry();
    const ref = registry.register({
      kind: 'api_key',
      providerId: 'local',
      locator: { type: 'local', key: 'github/default' },
    });
    const first = registry.registerVersion({
      credentialRefId: ref.id,
      codec: 'stored-credential/v1',
      fingerprint: HEX_A,
    });
    const second = registry.registerVersion({
      credentialRefId: ref.id,
      codec: 'stored-credential/v1',
      fingerprint: HEX_B,
    });
    const now = Date.now;
    try {
      Date.now = () => { throw new Error('clock unavailable'); };
      expect(() => registry.setVersionStatus(first.id, 'active')).toThrow();
    } finally {
      Date.now = now;
    }
    expect(registry.getVersion(first.id)?.status).toBe('superseded');
    expect(registry.getVersion(second.id)?.status).toBe('active');
    expect(registry.get(ref.id)?.currentVersionId).toBe(second.id);
  });

  it('rejects a version fingerprint that is not 64 hex characters', () => {
    const registry = createRegistry();
    const ref = registry.register({
      kind: 'api_key',
      providerId: 'local',
      locator: { type: 'local', key: 'github/default' },
      now: 100,
    });
    const base = {
      credentialRefId: ref.id,
      codec: 'stored-credential/v1',
      createdAt: 110,
    };
    expect(() => registry.registerVersion({ ...base, fingerprint: 'not-hex' })).toThrow();
    expect(() => registry.registerVersion({ ...base, fingerprint: 'A'.repeat(64) })).toThrow();
    expect(() => registry.registerVersion({ ...base, fingerprint: 'a'.repeat(63) })).toThrow();
    expect(() => registry.registerVersion({ ...base, fingerprint: `${HEX_A}0` })).toThrow();
    expect(registry.listVersions(ref.id)).toHaveLength(0);
  });

  it('rejects infisical locators with empty projectId or secretKey', () => {
    const registry = createRegistry();
    expect(() => registry.register({
      kind: 'api_key',
      providerId: 'infisical',
      locator: {
        type: 'infisical',
        projectId: '',
        environment: 'prod',
        secretPath: '/github',
        secretKey: 'token',
      },
    })).toThrow();
    expect(() => registry.register({
      kind: 'api_key',
      providerId: 'infisical',
      locator: {
        type: 'infisical',
        projectId: 'project',
        environment: 'prod',
        secretPath: '/github',
        secretKey: '',
      },
    })).toThrow();

    const ref = registry.register({
      kind: 'api_key',
      providerId: 'local',
      locator: { type: 'local', key: 'github/default' },
      now: 100,
    });
    expect(() => registry.updateProvider(ref.id, 'infisical', {
      type: 'infisical',
      projectId: '',
      environment: 'prod',
      secretPath: '/github',
      secretKey: 'token',
    })).toThrow();
    expect(() => registry.updateProvider(ref.id, 'infisical', {
      type: 'infisical',
      projectId: 'project',
      environment: 'prod',
      secretPath: '/github',
      secretKey: '',
    })).toThrow();
    expect(registry.get(ref.id)?.providerId).toBe('local');
  });

  it('rejects unknown version payload fields', () => {
    const registry = createRegistry();
    const ref = registry.register({
      kind: 'api_key',
      providerId: 'local',
      locator: { type: 'local', key: 'github/default' },
      now: 100,
    });
    expect(() => registry.registerVersion({
      credentialRefId: ref.id,
      codec: 'stored-credential/v1',
      fingerprint: HEX_A,
      createdAt: 110,
      value: 'literal-secret-token',
    } as never)).toThrow();
    expect(() => registry.registerVersion({
      credentialRefId: ref.id,
      codec: 'stored-credential/v1',
      fingerprint: HEX_A,
      createdAt: 110,
      payload: { secret: 'literal-secret-token' },
    } as never)).toThrow();
    expect(JSON.stringify(registry.listVersions(ref.id))).not.toContain('literal-secret-token');
  });

  it('generates browser-safe cred UUID identifiers', () => {
    const id = createCredentialRefId();
    expect(isCredentialRefId(id)).toBe(true);
  });

  it('returns clones instead of mutable registry state', () => {
    const registry = createRegistry();
    const ref = registry.register({
      kind: 'api_key',
      providerId: 'local',
      locator: { type: 'local', key: 'github/default' },
      now: 100,
    });

    (ref.locator as { key: string }).key = 'mutated';
    expect(registry.get(REF_ID)?.locator).toEqual({
      type: 'local',
      key: 'github/default',
    });
  });

  it('accepts P0 locators and still rejects unknown locator types', () => {
    const registry = createRegistry();
    const ref = registry.register({
      kind: 'api_key',
      providerId: 'dotenv',
      locator: { type: 'dotenv', path: '/tmp/.env', key: 'GITHUB_TOKEN' },
      now: 1,
    });
    expect(ref.locator).toEqual({ type: 'dotenv', path: '/tmp/.env', key: 'GITHUB_TOKEN' });

    expect(() =>
      registry.updateProvider(REF_ID, 'ssh-agent', {
        type: 'ssh_agent',
        fingerprint: 'SHA256:abcd',
        privateKey: 'BEGIN',
      } as never),
    ).toThrow();

    expect(() =>
      registry.updateProvider(REF_ID, 'mystery', { type: 'vault', path: '/secret' } as never),
    ).toThrow();

    expect(() =>
      registry.register({
        kind: 'basic_auth',
        providerId: 'git',
        locator: { type: 'git_helper', host: 'github.com', password: 'secret' },
      } as never),
    ).toThrow();
  });

  it('rejects an expiry before creation', () => {
    const registry = createRegistry();
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
        fingerprint: HEX_A,
        createdAt: 200,
        expiresAt: 199,
      }),
    ).toThrow();
  });

  it('does not silently replace the current version with an older active version', () => {
    const registry = createRegistry();
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
      fingerprint: HEX_B,
      createdAt: 200,
    });

    expect(() =>
      registry.registerVersion({
        id: 'ver_old',
        credentialRefId: ref.id,
        codec: 'stored-credential/v1',
        fingerprint: HEX_A,
        createdAt: 150,
      }),
    ).toThrow();
    expect(registry.get(ref.id)?.currentVersionId).toBe('ver_new');
    expect(registry.getVersion('ver_old')).toBeUndefined();
  });

  it('keeps ref timestamps monotonic by clamping instead of blocking revocation', () => {
    const registry = createRegistry();
    const ref = registry.register({
      kind: 'api_key',
      providerId: 'local',
      locator: { type: 'local', key: 'key' },
      now: 100,
    });
    const version = registry.registerVersion({
      credentialRefId: ref.id,
      codec: 'stored-credential/v1',
      fingerprint: HEX_A,
      createdAt: 200,
    });

    const revoked = registry.setVersionStatus(version.id, 'revoked', 199);

    expect(revoked.status).toBe('revoked');
    expect(registry.get(ref.id)?.currentVersionId).toBeUndefined();
    expect(registry.get(ref.id)?.updatedAt).toBe(200);
  });

  it('revokes a version whose createdAt is far in the future', () => {
    const registry = createRegistry();
    const ref = registry.register({
      kind: 'api_key',
      providerId: 'local',
      locator: { type: 'local', key: 'key' },
      now: 100,
    });
    const farFuture = 100 + 10 * 365 * 24 * 60 * 60 * 1000;
    const version = registry.registerVersion({
      credentialRefId: ref.id,
      codec: 'stored-credential/v1',
      fingerprint: HEX_A,
      createdAt: farFuture,
    });

    const revoked = registry.setVersionStatus(version.id, 'revoked', 300);

    expect(revoked.status).toBe('revoked');
    expect(registry.get(ref.id)?.currentVersionId).toBeUndefined();
    expect(registry.get(ref.id)?.updatedAt).toBe(farFuture);
  });

  it('moves ref updatedAt forward only when provider metadata changes', () => {
    const registry = createRegistry();
    const ref = registry.register({
      kind: 'api_key',
      providerId: 'local',
      locator: { type: 'local', key: 'key' },
      now: 500,
    });

    const moved = registry.updateProvider(
      ref.id,
      'keychain',
      { type: 'keychain', service: 's', account: 'a' },
      200,
    );

    expect(moved.updatedAt).toBe(500);
    expect(moved.providerId).toBe('keychain');
  });

  it('does not let an untrimmed id overwrite an existing version', () => {
    const registry = createRegistry();
    const ref = registry.register({
      kind: 'api_key',
      providerId: 'local',
      locator: { type: 'local', key: 'key' },
      now: 100,
    });
    registry.registerVersion({
      id: 'ver_x',
      credentialRefId: ref.id,
      codec: 'stored-credential/v1',
      fingerprint: HEX_A,
      createdAt: 110,
    });
    registry.setVersionStatus('ver_x', 'revoked', 120);

    expect(() =>
      registry.registerVersion({
        id: ' ver_x ',
        credentialRefId: ref.id,
        codec: 'stored-credential/v1',
        fingerprint: HEX_B,
        createdAt: 130,
      }),
    ).toThrow();
    expect(registry.getVersion('ver_x')?.status).toBe('revoked');
    expect(registry.getVersion('ver_x')?.fingerprint).toBe(HEX_A);
    expect(registry.listVersions(ref.id)).toHaveLength(1);
  });

  it('treats credential ref ids as case-sensitive', () => {
    const registry = createRegistry();
    const upper = REF_ID.toUpperCase();

    expect(isCredentialRefId(upper)).toBe(false);
    expect(() =>
      registry.register({
        id: upper as typeof REF_ID,
        kind: 'api_key',
        providerId: 'local',
        locator: { type: 'local', key: 'key' },
        now: 100,
      }),
    ).toThrow();
  });

  it('bounds caller-controlled text interpolated into errors', () => {
    const registry = createRegistry();
    const hugeKey = 'k'.repeat(200_000);

    expect(() =>
      registry.register({
        kind: 'api_key',
        providerId: 'local',
        locator: { type: 'local', key: 'key' },
        [hugeKey]: 'x',
      } as never),
    ).toThrow(/^Invalid credential metadata field: k{64}\.\.\.$/);
  });

  it('lists versions deterministically by creation time and id', () => {
    const registry = createRegistry();
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
      fingerprint: HEX_B,
      createdAt: 120,
      status: 'superseded',
    });
    registry.registerVersion({
      id: 'ver_a',
      credentialRefId: ref.id,
      codec: 'stored-credential/v1',
      fingerprint: HEX_A,
      createdAt: 110,
      status: 'superseded',
    });

    expect(registry.listVersions(ref.id).map((version) => version.id)).toEqual([
      'ver_a',
      'ver_b',
    ]);
  });
});
