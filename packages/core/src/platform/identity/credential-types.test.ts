import { describe, expect, it } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { attachCredentialRef } from './attach-credential-ref.ts';
import type { ServiceConnection } from './types.ts';
import {
  CredentialRefRegistry,
  createCredentialRefId,
  isCredentialRefId,
  type CredentialRef,
  type ProviderLocator,
} from './credential-types.ts';

const REF_ID = 'cred_123e4567-e89b-12d3-a456-426614174000';
const HEX_A = 'a'.repeat(64);
const HEX_B = 'b'.repeat(64);

function createRegistry(): CredentialRefRegistry {
  return new CredentialRefRegistry(() => REF_ID);
}

function withPrototypeField<T>(field: string, descriptor: PropertyDescriptor, run: () => T): T {
  const previous = Object.getOwnPropertyDescriptor(Object.prototype, field);
  try {
    Object.defineProperty(Object.prototype, field, Object.assign(Object.create(null), {
      enumerable: true,
      configurable: true,
    }, descriptor));
    return run();
  } finally {
    Reflect.deleteProperty(Object.prototype, field);
    if (previous) Object.defineProperty(Object.prototype, field, previous);
  }
}

function errorFrom(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  return undefined;
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

  const invalidLocators: readonly [string, () => unknown][] = [
    ['prototype-derived fields', () => Object.create({ type: 'local', key: 'github/default' })],
    ['non-enumerable fields', () => Object.defineProperty({ type: 'local', key: 'github/default' }, 'key', { enumerable: false })],
    ['symbol fields', () => ({ type: 'local', key: 'github/default', [Symbol('hidden')]: 'unexpected' })],
  ];

  for (const [name, createLocator] of invalidLocators) {
    it(`rejects locator ${name} before registration or provider replacement`, () => {
      const registry = createRegistry();
      expect(() => registry.register({
        kind: 'api_key',
        providerId: 'local',
        locator: createLocator() as never,
      })).toThrow();
      expect(registry.list()).toEqual([]);

      const ref = registry.register({
        kind: 'api_key',
        providerId: 'local',
        locator: { type: 'local', key: 'github/default' },
        now: 100,
      });
      expect(() => registry.updateProvider(ref.id, 'other', createLocator() as never, 200)).toThrow();
      expect(registry.get(ref.id)).toEqual(ref);
    });
  }

  const validLocators = [
    { type: 'local', key: 'github/default' },
    { type: 'keychain', service: 'github', account: 'default' },
    { type: 'dotenv', path: '/tmp/.env', key: 'GITHUB_TOKEN' },
    { type: 'git_helper', host: 'github.com' },
    { type: 'docker_helper', registry: 'registry.example.com' },
    { type: 'aws_profile', profile: 'default' },
    { type: 'gcp_adc', source: 'application-default' },
    { type: 'ssh_agent', fingerprint: 'SHA256:abcd' },
    { type: 'infisical', projectId: 'project', environment: 'prod', secretPath: '/github', secretKey: 'token' },
    { type: 'opaque', provider: 'custom', locator: 'github/default' },
  ] as const satisfies readonly ProviderLocator[];

  for (const validLocator of validLocators) {
    for (const field of Object.keys(validLocator)) {
      for (const inheritedKind of ['data', 'getter'] as const) {
        it(`rejects missing own ${validLocator.type}.${field} supplied by an inherited ${inheritedKind}`, () => {
          const registrationRegistry = createRegistry();
          const replacementRegistry = createRegistry();
          const original = replacementRegistry.register({
            kind: 'api_key',
            providerId: 'local',
            locator: { type: 'local', key: 'github/default' },
            now: 100,
          });
          const locator: Record<string, unknown> = { ...validLocator };
          const inheritedValue = locator[field];
          delete locator[field];
          const originalDescriptor = Object.getOwnPropertyDescriptor(Object.prototype, field);
          let reads = 0;
          let registrationResult: unknown;
          let registrationError: unknown;
          let replacementResult: unknown;
          let replacementError: unknown;
          let frozenOwnLocator: ProviderLocator | undefined;

          try {
            Object.defineProperty(Object.prototype, field, inheritedKind === 'data'
              ? { configurable: true, value: inheritedValue }
              : {
                  configurable: true,
                  get: () => {
                    reads += 1;
                    return inheritedValue;
                  },
                });
            try {
              registrationResult = registrationRegistry.register({
                kind: 'api_key',
                providerId: validLocator.type,
                locator: locator as never,
                now: 100,
              });
            } catch (error) {
              registrationError = error;
            }
            try {
              replacementResult = replacementRegistry.updateProvider(original.id, 'other', locator as never, 200);
            } catch (error) {
              replacementError = error;
            }
            frozenOwnLocator = createRegistry().register({
              kind: 'api_key',
              providerId: validLocator.type,
              locator: Object.freeze({ ...validLocator }),
              now: 100,
            }).locator;
          } finally {
            if (originalDescriptor) {
              Object.defineProperty(Object.prototype, field, originalDescriptor);
            } else {
              Reflect.deleteProperty(Object.prototype, field);
            }
          }

          // Assertions run after cleanup so the test framework sees a clean prototype.
          expect(registrationError).toBeInstanceOf(Error);
          expect((registrationError as Error).message).toMatch(/^Invalid credential metadata: locator(?:\.|$)/);
          expect(replacementError).toBeInstanceOf(Error);
          expect((replacementError as Error).message).toMatch(/^Invalid credential metadata: locator(?:\.|$)/);
          expect(registrationResult).toBeUndefined();
          expect(replacementResult).toBeUndefined();
          expect(reads).toBe(0);
          expect(registrationRegistry.list()).toEqual([]);
          expect(replacementRegistry.get(original.id)).toEqual(original);
          expect(frozenOwnLocator).toEqual(validLocator);
        });
      }
    }
  }

  for (const field of ['type', 'key'] as const) {
    it(`rejects own locator ${field} accessors when Object.prototype.value is present`, () => {
      const registrationRegistry = createRegistry();
      const replacementRegistry = createRegistry();
      const original = replacementRegistry.register({
        kind: 'api_key',
        providerId: 'local',
        locator: { type: 'local', key: 'github/default' },
        now: 100,
      });
      let reads = 0;
      const locator = { type: 'local', key: 'github/default' };
      Object.defineProperty(locator, field, {
        enumerable: true,
        get: () => {
          reads += 1;
          return field === 'type' ? 'local' : 'github/default';
        },
      });
      const originalDescriptor = Object.getOwnPropertyDescriptor(Object.prototype, 'value');
      let registrationResult: unknown;
      let registrationError: unknown;
      let replacementResult: unknown;
      let replacementError: unknown;

      try {
        Object.defineProperty(Object.prototype, 'value', { configurable: true, value: 'inherited-value' });
        try {
          registrationResult = registrationRegistry.register({ kind: 'api_key', providerId: 'local', locator: locator as never, now: 100 });
        } catch (error) {
          registrationError = error;
        }
        try {
          replacementResult = replacementRegistry.updateProvider(original.id, 'other', locator as never, 200);
        } catch (error) {
          replacementError = error;
        }
      } finally {
        // Remove the inherited value before restoring a possible accessor descriptor.
        Reflect.deleteProperty(Object.prototype, 'value');
        if (originalDescriptor) Object.defineProperty(Object.prototype, 'value', originalDescriptor);
      }

      expect(registrationError).toBeInstanceOf(Error);
      expect((registrationError as Error).message).toBe('Invalid credential metadata: locator');
      expect(replacementError).toBeInstanceOf(Error);
      expect((replacementError as Error).message).toBe('Invalid credential metadata: locator');
      expect(registrationResult).toBeUndefined();
      expect(replacementResult).toBeUndefined();
      expect(reads).toBe(0);
      expect(registrationRegistry.list()).toEqual([]);
      expect(replacementRegistry.get(original.id)).toEqual(original);
    });
  }

  for (const field of ['type', 'key'] as const) {
    it(`rejects locator ${field} accessors without executing them`, () => {
      const registry = createRegistry();
      let reads = 0;
      const locator = { type: 'local', key: 'github/default' };
      Object.defineProperty(locator, field, {
        enumerable: true,
        get: () => {
          reads += 1;
          return field === 'type' ? 'local' : 'github/default';
        },
      });
      expect(() => registry.register({ kind: 'api_key', providerId: 'local', locator: locator as never })).toThrow();
      expect(reads).toBe(0);
      expect(registry.list()).toEqual([]);
    });
  }

  for (const field of ['type', 'key'] as const) {
    it(`rejects own ${field} accessors when descriptor value is an inherited getter`, () => {
      const registry = createRegistry();
      const existing = registry.register({ kind: 'api_key', providerId: 'local', locator: { type: 'local', key: 'original' }, now: 100 });
      const emptyRegistry = createRegistry();
      let locatorReads = 0;
      let descriptorReads = 0;
      const locator = { type: 'local', key: 'github/default' };
      Object.defineProperty(locator, field, {
        enumerable: true,
        get: () => { locatorReads += 1; return field === 'type' ? 'local' : 'github/default'; },
      });
      const descriptor = { get: () => { descriptorReads += 1; return 'inherited-descriptor-value'; } };

      const result = withPrototypeField('value', descriptor, () => ({
        registrationError: errorFrom(() => emptyRegistry.register({ kind: 'api_key', providerId: 'other', locator: locator as never, now: 200 })),
        replacementError: errorFrom(() => registry.updateProvider(existing.id, 'other', locator as never, 200)),
      }));

      expect(result.registrationError).toBeInstanceOf(Error);
      expect(result.replacementError).toBeInstanceOf(Error);
      expect(locatorReads).toBe(0);
      expect(descriptorReads).toBe(0);
      expect(emptyRegistry.list()).toEqual([]);
      expect(registry.get(existing.id)).toEqual(existing);
    });
  }

  it('does not persist rejected inherited locator fields', () => {
    const directory = mkdtempSync(join(tmpdir(), 'rox-locator-rejection-'));
    try {
      const registry = new CredentialRefRegistry({ directory, idFactory: () => REF_ID });
      const original = registry.register({ kind: 'api_key', providerId: 'local', locator: { type: 'local', key: 'original' }, now: 100 });
      const version = registry.registerVersion({ id: 'ver_before_rejection', credentialRefId: original.id, codec: 'stored-credential/v1', fingerprint: HEX_A, createdAt: 110 });
      const current = registry.get(original.id);
      if (!current) throw new Error('Registered credential ref is missing');
      const refsPath = join(directory, 'credential-refs.json');
      const versionsPath = join(directory, 'credential-versions.json');
      const before = readFileSync(refsPath, 'utf8');
      const versionsBefore = readFileSync(versionsPath, 'utf8');
      let reads = 0;
      const result = withPrototypeField('key', { get: () => { reads += 1; return 'inherited'; } }, () => ({
        registrationError: errorFrom(() => registry.register({ id: 'cred_223e4567-e89b-12d3-a456-426614174000', kind: 'api_key', providerId: 'other', locator: { type: 'local' } as never, now: 200 })),
        replacementError: errorFrom(() => registry.updateProvider(original.id, 'other', { type: 'local' } as never, 200)),
      }));
      expect(result.registrationError).toBeInstanceOf(Error);
      expect(result.replacementError).toBeInstanceOf(Error);
      expect(reads).toBe(0);
      expect(readFileSync(refsPath, 'utf8')).toBe(before);
      expect(readFileSync(versionsPath, 'utf8')).toBe(versionsBefore);
      expect(registry.list()).toEqual([current]);
      expect(registry.listVersions(original.id)).toEqual([version]);
      const reopened = new CredentialRefRegistry({ directory });
      expect(reopened.list()).toEqual([current]);
      expect(reopened.listVersions(original.id)).toEqual([version]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  for (const field of ['type', 'key'] as const) {
    it(`skips persisted locators missing their own ${field} without invoking an inherited getter`, () => {
      const directory = mkdtempSync(join(tmpdir(), 'rox-locator-reload-'));
      try {
        const registry = new CredentialRefRegistry({ directory, idFactory: () => REF_ID });
        const original = registry.register({ kind: 'api_key', providerId: 'local', locator: { type: 'local', key: 'original' }, now: 100 });
        const incomplete: Record<string, unknown> = { type: 'local', key: 'incomplete' };
        delete incomplete[field];
        const refsPath = join(directory, 'credential-refs.json');
        writeFileSync(refsPath, JSON.stringify([original, { ...original, id: 'cred_223e4567-e89b-12d3-a456-426614174000', locator: incomplete }]));
        const before = readFileSync(refsPath, 'utf8');
        let reads = 0;
        const loaded = withPrototypeField(field, { get: () => { reads += 1; return field === 'type' ? 'local' : 'inherited'; } }, () => new CredentialRefRegistry({ directory }));
        expect(reads).toBe(0);
        expect(loaded.list()).toEqual([original]);
        expect(readFileSync(refsPath, 'utf8')).toBe(before);
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    });
  }

  it('accepts enumerable readonly and frozen locator data fields', () => {
    const registry = createRegistry();
    const locator = Object.freeze({ type: 'local' as const, key: 'github/default' });
    const ref = registry.register({ kind: 'api_key', providerId: 'local', locator, now: 100 });
    expect(ref.locator).toEqual({ type: 'local', key: 'github/default' });
    expect(locator).toEqual({ type: 'local', key: 'github/default' });
    const updated = registry.updateProvider(ref.id, 'other', Object.freeze({ type: 'git_helper' as const, host: 'github.com' }), 200);
    expect(updated.locator).toEqual({ type: 'git_helper', host: 'github.com' });
  });

  for (const validLocator of validLocators) {
    it(`keeps frozen ${validLocator.type} locator data valid despite inherited getters`, () => {
      const registry = createRegistry();
      let reads = 0;
      let error: unknown;
      let registered: ReturnType<CredentialRefRegistry['register']> | undefined;
      const locator = Object.freeze({ ...validLocator });
      withPrototypeField('type', {
        configurable: true,
        enumerable: true,
        get: () => { reads += 1; return 'invalid'; },
      }, () => {
        error = errorFrom(() => { registered = registry.register({ kind: 'api_key', providerId: 'local', locator, now: 100 }); });
      });
      expect(error).toBeUndefined();
      expect(reads).toBe(0);
      expect(registered?.locator).toEqual(validLocator);
      expect(locator).toEqual(validLocator);
    });
  }

  it('rejects locator accessors even when descriptor value is inherited', () => {
    const registry = createRegistry();
    const updateRegistry = createRegistry();
    const original = updateRegistry.register({ kind: 'api_key', providerId: 'local', locator: { type: 'local', key: 'original' }, now: 100 });
    let locatorReads = 0;
    let descriptorReads = 0;
    let registerError: unknown;
    let updateError: unknown;
    const locator = { type: 'local' };
    Object.defineProperty(locator, 'key', { enumerable: true, get: () => { locatorReads += 1; return 'accessor-key'; } });
    withPrototypeField('value', {
      configurable: true,
      enumerable: true,
      get: () => { descriptorReads += 1; return 'inherited-descriptor-value'; },
    }, () => {
      registerError = errorFrom(() => registry.register({ kind: 'api_key', providerId: 'other', locator: locator as never }));
      updateError = errorFrom(() => updateRegistry.updateProvider(original.id, 'other', locator as never, 200));
    });
    expect(locatorReads).toBe(0);
    expect(descriptorReads).toBe(0);
    expect(registerError).toBeInstanceOf(Error);
    expect(updateError).toBeInstanceOf(Error);
    expect(registry.list()).toEqual([]);
    expect(updateRegistry.get(original.id)).toEqual(original);
  });

  for (const operation of ['register', 'updateProvider'] as const) {
    it(`keeps disk metadata unchanged after ${operation} rejects an inherited locator field`, () => {
      const directory = mkdtempSync(join(tmpdir(), 'credential-locator-'));
      try {
        const registry = new CredentialRefRegistry({ directory, idFactory: () => REF_ID });
        const original = operation === 'updateProvider'
          ? registry.register({ kind: 'api_key', providerId: 'local', locator: { type: 'local', key: 'original' }, now: 100 })
          : undefined;
        const files = ['credential-refs.json', 'credential-versions.json'];
        const before = files.map(file => existsSync(join(directory, file)) ? readFileSync(join(directory, file), 'utf8') : undefined);
        let reads = 0;
        let error: unknown;
        withPrototypeField('key', { configurable: true, enumerable: true, get: () => { reads += 1; return 'inherited'; } }, () => {
          error = errorFrom(() => original
            ? registry.updateProvider(original.id, 'other', { type: 'local' } as never, 200)
            : registry.register({ kind: 'api_key', providerId: 'other', locator: { type: 'local' } as never, now: 200 }));
        });
        expect(reads).toBe(0);
        expect(error).toBeInstanceOf(Error);
        expect(files.map(file => existsSync(join(directory, file)) ? readFileSync(join(directory, file), 'utf8') : undefined)).toEqual(before);
        expect(registry.list()).toEqual(original ? [original] : []);
        expect(new CredentialRefRegistry({ directory }).list()).toEqual(original ? [original] : []);
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    });
  }

  it('skips disk locators missing own fields without executing inherited getters', () => {
    const directory = mkdtempSync(join(tmpdir(), 'credential-locator-'));
    try {
      const valid: CredentialRef = {
        id: REF_ID,
        kind: 'api_key',
        providerId: 'local',
        locator: { type: 'local', key: 'original' },
        createdAt: 100,
        updatedAt: 100,
      };
      const invalid = { ...valid, id: 'cred_123e4567-e89b-12d3-a456-426614174001', locator: { type: 'local' } };
      const file = join(directory, 'credential-refs.json');
      const contents = JSON.stringify([valid, invalid]);
      writeFileSync(file, contents);
      let reads = 0;
      let registry: CredentialRefRegistry | undefined;
      withPrototypeField('key', { configurable: true, enumerable: true, get: () => { reads += 1; return 'inherited'; } }, () => {
        registry = new CredentialRefRegistry({ directory });
      });
      expect(reads).toBe(0);
      expect(registry?.list()).toEqual([valid]);
      expect(readFileSync(file, 'utf8')).toBe(contents);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
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

const CONNECTION: ServiceConnection = {
  id: 'svc-github', workspaceId: 'ws', provider: 'github', status: 'connected',
};
const LOCATORS: readonly ProviderLocator[] = [
  { type: 'local', key: 'github/default' },
  { type: 'keychain', service: 'github', account: 'default' },
  { type: 'dotenv', path: '/config/.env', key: 'GITHUB_TOKEN' },
  { type: 'git_helper', host: 'github.com' },
  { type: 'docker_helper', registry: 'registry.example.com' },
  { type: 'aws_profile', profile: 'default' },
  { type: 'gcp_adc', source: '/config/adc.json' },
  { type: 'ssh_agent', fingerprint: 'SHA256:example' },
  { type: 'infisical', projectId: 'project', environment: 'prod', secretPath: '/github', secretKey: 'token' },
  { type: 'opaque', provider: 'example', locator: 'account/default' },
];

function rejects(action: () => unknown): boolean {
  try { action(); return false; } catch { return true; }
}

describe('credential locator own-data boundary', () => {
  for (const valid of LOCATORS) {
    for (const field of Object.keys(valid)) {
      for (const mode of ['data', 'getter'] as const) {
        it(`rejects ${valid.type}.${field} inherited ${mode} across registry boundaries`, () => {
          const directory = mkdtempSync(join(tmpdir(), 'rox-locator-inheritance-'));
          const registerDirectory = join(directory, 'register');
          const replacementDirectory = join(directory, 'replacement');
          const attachmentDirectory = join(directory, 'attachment');
          const reloadDirectory = join(directory, 'reload');
          try {
            const registration = new CredentialRefRegistry({ directory: registerDirectory, idFactory: () => REF_ID });
            const replacement = new CredentialRefRegistry({ directory: replacementDirectory, idFactory: () => REF_ID });
            const attachment = new CredentialRefRegistry({ directory: attachmentDirectory, idFactory: () => REF_ID });
            const original = replacement.register({ kind: 'api_key', providerId: 'local', locator: { type: 'local', key: 'original' }, now: 100 });
            const replacementFile = join(replacementDirectory, 'credential-refs.json');
            const originalBytes = readFileSync(replacementFile, 'utf8');
            const replacementVersionsFile = join(replacementDirectory, 'credential-versions.json');
            const originalVersionsBytes = readFileSync(replacementVersionsFile, 'utf8');
            // Seed the real disk reader with metadata missing the same own field.
            new CredentialRefRegistry({ directory: reloadDirectory });
            const locator = { ...valid } as Record<string, unknown>;
            const inheritedValue = locator[field];
            delete locator[field];
            const reloadFile = join(reloadDirectory, 'credential-refs.json');
            writeFileSync(reloadFile, JSON.stringify([{ ...original, locator }]));
            const reloadBytes = readFileSync(reloadFile, 'utf8');
            const previous = Object.getOwnPropertyDescriptor(Object.prototype, field);
            let reads = 0;
            let registrationRejected = false;
            let replacementRejected = false;
            let attachmentRejected = false;
            let reloaded: CredentialRefRegistry | undefined;
            try {
              Object.defineProperty(Object.prototype, field, mode === 'data'
                ? { configurable: true, value: inheritedValue }
                : { configurable: true, get: () => { reads += 1; return inheritedValue; } });
              // Keep pollution synchronous; restore it before Bun assertions or I/O checks.
              registrationRejected = rejects(() => registration.register({ kind: 'api_key', providerId: 'local', locator: locator as ProviderLocator, now: 200 }));
              replacementRejected = rejects(() => replacement.updateProvider(original.id, 'other', locator as ProviderLocator, 200));
              attachmentRejected = rejects(() => attachCredentialRef(CONNECTION, attachment, { kind: 'api_key', providerId: 'local', locator: locator as ProviderLocator, now: 200 }));
              reloaded = new CredentialRefRegistry({ directory: reloadDirectory });
            } finally {
              if (previous) Object.defineProperty(Object.prototype, field, previous);
              else Reflect.deleteProperty(Object.prototype, field);
            }
            expect(registrationRejected).toBe(true);
            expect(replacementRejected).toBe(true);
            expect(attachmentRejected).toBe(true);
            expect(reads).toBe(0);
            expect(registration.list()).toEqual([]);
            for (const unchangedDirectory of [registerDirectory, attachmentDirectory]) {
              expect(existsSync(join(unchangedDirectory, 'credential-refs.json'))).toBe(false);
              expect(existsSync(join(unchangedDirectory, 'credential-versions.json'))).toBe(false);
            }
            expect(attachment.list()).toEqual([]);
            expect(CONNECTION.credentialRef).toBeUndefined();
            expect(replacement.get(original.id)).toEqual(original);
            expect(readFileSync(replacementFile, 'utf8')).toBe(originalBytes);
            expect(readFileSync(replacementVersionsFile, 'utf8')).toBe(originalVersionsBytes);
            expect(reloaded?.list()).toEqual([]);
            expect(readFileSync(reloadFile, 'utf8')).toBe(reloadBytes);
          } finally {
            rmSync(directory, { recursive: true, force: true });
          }
        });
      }
    }

    it(`preserves frozen ${valid.type} data through registration, replacement and restart`, () => {
      const directory = mkdtempSync(join(tmpdir(), 'rox-locator-frozen-'));
      try {
        const registry = new CredentialRefRegistry({ directory, idFactory: () => REF_ID });
        const locator = Object.freeze({ ...valid });
        const ref = registry.register({ kind: 'api_key', providerId: 'provider', locator, now: 100 });
        expect(ref.locator).toEqual(valid);
        const updated = registry.updateProvider(ref.id, 'other', locator, 200);
        expect(updated.locator).toEqual(valid);
        expect(new CredentialRefRegistry({ directory }).get(ref.id)).toEqual(updated);
        const attachmentDirectory = join(directory, 'attachment');
        const attachment = new CredentialRefRegistry({ directory: attachmentDirectory, idFactory: () => REF_ID });
        const attached = attachCredentialRef(CONNECTION, attachment, {
          kind: 'api_key', providerId: 'provider', locator, now: 100,
        });
        expect(attached).toEqual({ ...CONNECTION, credentialRef: REF_ID });
        expect(new CredentialRefRegistry({ directory: attachmentDirectory }).get(REF_ID)?.locator).toEqual(valid);
        expect(locator).toEqual(valid);
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    });
  }

  it('rejects an own accessor even when its descriptor inherits value', () => {
    const registry = new CredentialRefRegistry(() => REF_ID);
    let reads = 0;
    const locator = Object.defineProperty({ type: 'local' }, 'key', {
      enumerable: true,
      get() { reads += 1; return 'github/default'; },
    });
    const previous = Object.getOwnPropertyDescriptor(Object.prototype, 'value');
    let rejected = false;
    try {
      Object.defineProperty(Object.prototype, 'value', { configurable: true, value: 'inherited descriptor value' });
      rejected = rejects(() => registry.register({ kind: 'api_key', providerId: 'local', locator: locator as ProviderLocator, now: 100 }));
    } finally {
      Reflect.deleteProperty(Object.prototype, 'value');
      if (previous) Object.defineProperty(Object.prototype, 'value', previous);
    }
    expect(rejected).toBe(true);
    expect(reads).toBe(0);
    expect(registry.list()).toEqual([]);
  });

  it('normalizes own data without ordinary locator property reads', () => {
    const registry = new CredentialRefRegistry(() => REF_ID);
    let reads = 0;
    const locator = new Proxy({ type: 'local' as const, key: 'github/default' }, {
      get() { reads += 1; throw new Error('ordinary locator read'); },
    });
    const ref = registry.register({ kind: 'api_key', providerId: 'local', locator, now: 100 });
    expect(ref.locator).toEqual({ type: 'local', key: 'github/default' });
    expect(registry.updateProvider(ref.id, 'other', locator, 200).locator).toEqual(ref.locator);
    const attached = attachCredentialRef(CONNECTION, new CredentialRefRegistry(() => REF_ID), {
      kind: 'api_key', providerId: 'local', locator, now: 100,
    });
    expect(attached.credentialRef).toBe(REF_ID);
    expect(reads).toBe(0);
  });
});
