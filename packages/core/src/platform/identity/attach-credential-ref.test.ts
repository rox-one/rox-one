import { describe, expect, it } from 'bun:test';
import { attachCredentialRef, type AttachCredentialRefInput } from './attach-credential-ref.ts';
import { CredentialRefRegistry, isCredentialRefId } from './credential-types.ts';
import type { ServiceConnection } from './types.ts';

function withPrototypeProperty(field: string, descriptor: PropertyDescriptor, run: () => void): void {
  const original = Object.getOwnPropertyDescriptor(Object.prototype, field);
  Object.defineProperty(Object.prototype, field, descriptor);
  try {
    run();
  } finally {
    if (original) Object.defineProperty(Object.prototype, field, original);
    else Reflect.deleteProperty(Object.prototype, field);
  }
}

function captureError(run: () => unknown): unknown {
  try {
    run();
    return undefined;
  } catch (error) {
    return error;
  }
}

describe('attachCredentialRef', () => {
  const connection: ServiceConnection = { id: 'svc-github', workspaceId: 'ws', provider: 'github', status: 'connected' };
  const input: AttachCredentialRefInput = { kind: 'bearer_token', providerId: 'local', locator: { type: 'local', key: 'github/default' }, now: 1 };

  for (const field of ['kind', 'providerId', 'locator'] as const) {
    for (const propertyKind of ['data', 'getter', 'throwing getter'] as const) {
      it(`rejects an inherited input ${field} ${propertyKind} before registration`, () => {
        const registry = new CredentialRefRegistry();
        const incomplete = { ...input } as Partial<AttachCredentialRefInput>;
        delete incomplete[field];
        let reads = 0;
        let error: unknown;
        const descriptor: PropertyDescriptor = propertyKind === 'data'
          ? { configurable: true, enumerable: true, value: input[field] }
          : { configurable: true, enumerable: true, get: () => { reads += 1; if (propertyKind === 'throwing getter') throw new Error('inherited getter executed'); return input[field]; } };
        withPrototypeProperty(field, descriptor, () => {
          error = captureError(() => attachCredentialRef(connection, registry, incomplete as AttachCredentialRefInput));
        });
        expect(reads).toBe(0);
        expect(error).toBeInstanceOf(Error);
        expect(registry.list()).toEqual([]);
        expect(connection).toEqual({ id: 'svc-github', workspaceId: 'ws', provider: 'github', status: 'connected' });
        expect(incomplete).not.toHaveProperty(field);
      });
    }
  }

  for (const target of ['connection', 'input', 'locator'] as const) {
    for (const propertyKind of ['data', 'getter'] as const) {
      it(`rejects ${target} accessors despite inherited descriptor value ${propertyKind} before mutation`, () => {
        const registry = new CredentialRefRegistry();
        const suppliedConnection = { ...connection };
        const suppliedInput = { ...input, locator: { ...input.locator } };
        const value = target === 'connection' ? suppliedConnection : target === 'input' ? suppliedInput : suppliedInput.locator;
        const field = target === 'connection' ? 'status' : target === 'input' ? 'locator' : 'key';
        const result = target === 'connection' ? 'connected' : target === 'input' ? input.locator : 'github/default';
        let fieldReads = 0;
        let descriptorReads = 0;
        let error: unknown;
        Object.defineProperty(value, field, { enumerable: true, get: () => { fieldReads += 1; return result; } });
        const descriptor: PropertyDescriptor = propertyKind === 'data'
          ? { configurable: true, enumerable: true, value: result }
          : { configurable: true, enumerable: true, get: () => { descriptorReads += 1; return result; } };
        withPrototypeProperty('value', descriptor, () => {
          error = captureError(() => attachCredentialRef(suppliedConnection, registry, suppliedInput));
        });
        expect(fieldReads).toBe(0);
        expect(descriptorReads).toBe(0);
        expect(error).toBeInstanceOf(Error);
        expect(registry.list()).toEqual([]);
      });
    }
  }

  it('ignores inherited optional now without executing its getter', () => {
    const registry = new CredentialRefRegistry();
    const supplied: AttachCredentialRefInput = { kind: input.kind, providerId: input.providerId, locator: input.locator };
    let reads = 0;
    let error: unknown;
    let attached: ServiceConnection | undefined;
    const before = Date.now();
    withPrototypeProperty('now', { configurable: true, enumerable: true, get: () => { reads += 1; return 1; } }, () => {
      error = captureError(() => { attached = attachCredentialRef(connection, registry, supplied); });
    });
    expect(error).toBeUndefined();
    expect(reads).toBe(0);
    expect(registry.list()[0]?.createdAt).toBeGreaterThanOrEqual(before);
    expect(attached?.credentialRef).toBe(registry.list()[0]?.id);
    expect(supplied).not.toHaveProperty('now');
  });

  it('preserves frozen own connection, input and locator data under prototype pollution', () => {
    const registry = new CredentialRefRegistry();
    const suppliedConnection = Object.freeze({ ...connection, accountLabel: 'GitHub', readOnly: true });
    const suppliedInput = Object.freeze({ ...input, locator: Object.freeze({ ...input.locator }) });
    let reads = 0;
    let error: unknown;
    let attached: ServiceConnection | undefined;
    withPrototypeProperty('locator', { configurable: true, enumerable: true, get: () => { reads += 1; throw new Error('inherited getter executed'); } }, () => {
      error = captureError(() => { attached = attachCredentialRef(suppliedConnection, registry, suppliedInput); });
    });
    expect(error).toBeUndefined();
    expect(reads).toBe(0);
    expect(attached).toEqual({ id: 'svc-github', workspaceId: 'ws', provider: 'github', status: 'connected', accountLabel: 'GitHub', readOnly: true, credentialRef: registry.list()[0]?.id });
    expect(suppliedConnection).toEqual({ id: 'svc-github', workspaceId: 'ws', provider: 'github', status: 'connected', accountLabel: 'GitHub', readOnly: true });
    expect(suppliedInput).toEqual(input);
  });

  it('writes a cred uuid and does not accept a raw value', () => {
    const registry = new CredentialRefRegistry();
    const connection: ServiceConnection = {
      id: 'svc-github',
      workspaceId: 'ws',
      provider: 'github',
      status: 'connected',
    };

    const attached = attachCredentialRef(connection, registry, {
      kind: 'bearer_token',
      providerId: 'local',
      locator: { type: 'local', key: 'github/default' },
      now: 1,
    });

    expect(attached.credentialRef).toMatch(/^cred_[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(attached.id).toBe('svc-github');
    expect(isCredentialRefId(attached.credentialRef)).toBe(true);
    if (!isCredentialRefId(attached.credentialRef)) throw new Error('expected cred ref');
    expect(registry.get(attached.credentialRef)?.id).toBe(attached.credentialRef);
  });

  it('rejects raw fields and a fake registry before mutation', () => {
    const registry = new CredentialRefRegistry();
    const connection = {
      id: 'svc-github',
      workspaceId: 'ws',
      provider: 'github',
      status: 'connected',
      credentialValue: 'raw-secret',
    };
    const input = {
      kind: 'bearer_token',
      providerId: 'local',
      locator: { type: 'local', key: 'github/default' },
      value: 'raw-secret',
    };
    expect(() => attachCredentialRef(connection as never, registry, input as never)).toThrow();
    expect(registry.list()).toEqual([]);
    expect(() => attachCredentialRef({
      id: 'svc-github',
      workspaceId: 'ws',
      provider: 'github',
      status: 'connected',
    }, { register: () => ({ id: 'cred_123e4567-e89b-12d3-a456-426614174000' }) } as never, {
      kind: 'bearer_token',
      providerId: 'local',
      locator: { type: 'local', key: 'github/default' },
    })).toThrow();
    const forged = Object.create(CredentialRefRegistry.prototype);
    forged.register = () => ({ id: 'cred_123e4567-e89b-12d3-a456-426614174000' });
    expect(() => attachCredentialRef({
      id: 'svc-github',
      workspaceId: 'ws',
      provider: 'github',
      status: 'connected',
    }, forged, {
      kind: 'bearer_token',
      providerId: 'local',
      locator: { type: 'local', key: 'github/default' },
    })).toThrow();
  });

  it('leaves the input connection unchanged when registry validation fails', () => {
    const registry = new CredentialRefRegistry();
    const connection: ServiceConnection = {
      id: 'svc-github',
      workspaceId: 'ws',
      provider: 'github',
      status: 'connected',
    };
    expect(() => attachCredentialRef(connection, registry, {
      kind: 'bearer_token',
      providerId: 'local',
      locator: { type: 'local', key: '' },
    })).toThrow();
    expect(connection).toEqual({
      id: 'svc-github',
      workspaceId: 'ws',
      provider: 'github',
      status: 'connected',
    });
    expect(registry.list()).toEqual([]);
  });

  it('rejects non-enumerable declared fields before registration', () => {
    const registry = new CredentialRefRegistry();
    const connection = {
      id: 'svc-github',
      workspaceId: 'ws',
      provider: 'github',
      status: 'connected',
    };
    Object.defineProperty(connection, 'status', { enumerable: false });
    expect(() => attachCredentialRef(connection as never, registry, {
      kind: 'bearer_token',
      providerId: 'local',
      locator: { type: 'local', key: 'github/default' },
    })).toThrow();

    const input = {
      kind: 'bearer_token',
      providerId: 'local',
      locator: { type: 'local', key: 'github/default' },
    };
    Object.defineProperty(input, 'kind', { enumerable: false });
    expect(() => attachCredentialRef({
      id: 'svc-github',
      workspaceId: 'ws',
      provider: 'github',
      status: 'connected',
    }, registry, input as never)).toThrow();

    const locator = { type: 'local', key: 'github/default' };
    Object.defineProperty(locator, 'key', { enumerable: false });
    expect(() => attachCredentialRef({
      id: 'svc-github',
      workspaceId: 'ws',
      provider: 'github',
      status: 'connected',
    }, registry, {
      kind: 'bearer_token',
      providerId: 'local',
      locator: locator as never,
    })).toThrow();
    expect(registry.list()).toEqual([]);
  });

  it('rejects prototype-derived locators before registry mutation', () => {
    const registry = new CredentialRefRegistry();
    const locator = Object.create({ type: 'local', key: 'github/default' });
    expect(() => attachCredentialRef({
      id: 'svc-github',
      workspaceId: 'ws',
      provider: 'github',
      status: 'connected',
    }, registry, {
      kind: 'bearer_token',
      providerId: 'local',
      locator,
    } as never)).toThrow();
    expect(registry.list()).toEqual([]);
  });
});
