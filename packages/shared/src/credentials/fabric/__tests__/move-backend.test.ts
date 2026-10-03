import { describe, expect, it } from 'bun:test';
import { CredentialRefRegistry } from '@rox/core/platform';
import type { CredentialBackend } from '../../backends/types.ts';
import type { CredentialId, StoredCredential } from '../../types.ts';
import { credentialIdToAccount } from '../../types.ts';
import { LocalFileSecretProvider } from '../local-file-provider.ts';

class MemoryBackend implements CredentialBackend {
  constructor(readonly name: string) {}
  readonly priority = 1;
  readonly store = new Map<string, StoredCredential>();
  async isAvailable(): Promise<boolean> { return true; }
  async get(id: CredentialId): Promise<StoredCredential | null> {
    return this.store.get(credentialIdToAccount(id)) ?? null;
  }
  async set(id: CredentialId, credential: StoredCredential): Promise<void> {
    this.store.set(credentialIdToAccount(id), credential);
  }
  async delete(id: CredentialId): Promise<boolean> {
    return this.store.delete(credentialIdToAccount(id));
  }
  async list(): Promise<CredentialId[]> { return []; }
}

describe('LocalFileSecretProvider.moveCopy', () => {
  it('moves a copy to another backend without returning the payload', async () => {
    const source = new MemoryBackend('memory');
    const target = new MemoryBackend('local-alt');
    const registry = new CredentialRefRegistry();
    const provider = new LocalFileSecretProvider(source, registry);
    const written = await provider.write({
      kind: 'bearer_token',
      locator: { type: 'local', key: 'github/default' },
      payload: { value: 'super-secret' },
    });

    const moved = await provider.moveCopy(written.ref, target);
    expect(moved).toEqual({ from: 'memory', to: 'local-alt' });
    expect(JSON.stringify(moved)).not.toContain('super-secret');
    expect(await source.get({ type: 'source_apikey', workspaceId: 'fabric', sourceId: written.ref.id })).toBeNull();
    expect(await target.get({ type: 'source_apikey', workspaceId: 'fabric', sourceId: written.ref.id })).toEqual({
      value: 'super-secret',
    });

    const lease = await provider.resolveForLease({ credentialRef: written.ref });
    expect(lease.payload).toEqual({ value: 'super-secret' });
    expect(JSON.stringify({ from: moved.from, to: moved.to })).not.toMatch(/"token"|"secret"/i);
  });

  it('rejects a move onto the same backend and an unknown copy', async () => {
    const source = new MemoryBackend('memory');
    const registry = new CredentialRefRegistry();
    const provider = new LocalFileSecretProvider(source, registry);
    const written = await provider.write({
      kind: 'bearer_token',
      locator: { type: 'local', key: 'github/default' },
      payload: { value: 'super-secret' },
    });
    await expect(provider.moveCopy(written.ref, source)).rejects.toThrow(/same_backend/i);
    const other = registry.register({
      kind: 'bearer_token',
      providerId: 'local-file',
      locator: { type: 'local', key: 'missing' },
    });
    await expect(provider.moveCopy(other, new MemoryBackend('local-alt'))).rejects.toThrow(/move_unavailable/i);
  });
});


describe('connection backend move failure recovery', () => {
  for (const mode of ['set-after-write', 'bad-readback', 'delete-refused', 'delete-after-removal']) {
    it(`preserves the original copy and clears the target after ${mode}`, async () => {
      const source = new MemoryBackend('source');
      const target = new MemoryBackend('target');
      const provider = new LocalFileSecretProvider(source, new CredentialRefRegistry());
      const { ref } = await provider.write({ kind: 'bearer_token', locator: { type: 'local', key: 'synthetic' }, payload: { value: 'fixture' } });
      const id: CredentialId = { type: 'source_apikey', workspaceId: 'fabric', sourceId: ref.id };
      if (mode === 'set-after-write') target.set = async (key, payload) => {
        target.store.set(credentialIdToAccount(key), payload); throw new Error('private backend message');
      };
      if (mode === 'bad-readback') target.set = async (key) => { target.store.set(credentialIdToAccount(key), { value: 'changed' }); };
      if (mode === 'delete-refused') source.delete = async () => false;
      if (mode === 'delete-after-removal') source.delete = async (key) => {
        source.store.delete(credentialIdToAccount(key)); throw new Error('private backend message');
      };
      await expect(provider.moveCopy(ref, target)).rejects.toThrow('move_failed');
      expect(await source.get(id)).toEqual({ value: 'fixture' });
      expect(await target.get(id)).toBeNull();
      expect((await provider.inspect(ref)).backend).toBe('source');
      expect((await provider.resolveForLease({ credentialRef: ref })).payload).toEqual({ value: 'fixture' });
    });
  }
  it('rejects an unavailable backend or an existing destination before changing either copy', async () => {
    const source = new MemoryBackend('source');
    const target = new MemoryBackend('target');
    const provider = new LocalFileSecretProvider(source, new CredentialRefRegistry());
    const { ref } = await provider.write({ kind: 'bearer_token', locator: { type: 'local', key: 'synthetic' }, payload: { value: 'fixture' } });
    target.isAvailable = async () => false;
    await expect(provider.moveCopy(ref, target)).rejects.toThrow('backend_unavailable');
    target.isAvailable = async () => true;
    const id: CredentialId = { type: 'source_apikey', workspaceId: 'fabric', sourceId: ref.id };
    await target.set(id, { value: 'existing' });
    await expect(provider.moveCopy(ref, target)).rejects.toThrow('target_copy_exists');
    expect(await target.get(id)).toEqual({ value: 'existing' });
    expect(await source.get(id)).toEqual({ value: 'fixture' });
  });
  it('rejects simultaneous moves of one credential and permits a subsequent move', async () => {
    const source = new MemoryBackend('source');
    const target = new MemoryBackend('target');
    const provider = new LocalFileSecretProvider(source, new CredentialRefRegistry());
    const { ref } = await provider.write({ kind: 'bearer_token', locator: { type: 'local', key: 'synthetic' }, payload: { value: 'fixture' } });
    let release!: () => void;
    const wait = new Promise<void>(resolve => { release = resolve; });
    const originalSet = target.set.bind(target);
    target.set = async (id, payload) => { await wait; await originalSet(id, payload); };
    const first = provider.moveCopy(ref, target);
    await expect(provider.moveCopy(ref, new MemoryBackend('other'))).rejects.toThrow('move_in_progress');
    release(); await first;
    await expect(provider.moveCopy(ref, source)).resolves.toEqual({ from: 'target', to: 'source' });
  });
});


describe('credential move revocation ordering', () => {
  for (const operation of ['revoke', 'dropCopy'] as const) {
    it(`waits for the move before completing ${operation} and never restores revoked bytes`, async () => {
      const source = new MemoryBackend('source');
      const target = new MemoryBackend('target');
      const provider = new LocalFileSecretProvider(source, new CredentialRefRegistry());
      const { ref } = await provider.write({ kind: 'bearer_token', locator: { type: 'local', key: 'synthetic' }, payload: { value: 'fixture' } });
      const id: CredentialId = { type: 'source_apikey', workspaceId: 'fabric', sourceId: ref.id };
      let entered!: () => void;
      const atSet = new Promise<void>(resolve => { entered = resolve; });
      let release!: () => void;
      const wait = new Promise<void>(resolve => { release = resolve; });
      const originalSet = target.set.bind(target);
      target.set = async (key, payload) => { entered(); await wait; await originalSet(key, payload); };
      const moving = provider.moveCopy(ref, target);
      await atSet;
      let removed = false;
      const removal = (operation === 'revoke' ? provider.revoke({ credentialRef: ref }) : provider.dropCopy(ref))
        .then(() => { removed = true; });
      await Promise.resolve(); expect(removed).toBe(false);
      release(); await moving; await removal;
      expect(await source.get(id)).toBeNull(); expect(await target.get(id)).toBeNull();
      expect((await provider.inspect(ref)).status).toBe('missing');
    });
  }
  it('keeps the provider reference when physical deletion is refused', async () => {
    const source = new MemoryBackend('source');
    const provider = new LocalFileSecretProvider(source, new CredentialRefRegistry());
    const { ref } = await provider.write({ kind: 'bearer_token', locator: { type: 'local', key: 'synthetic' }, payload: { value: 'fixture' } });
    source.delete = async () => false;
    await expect(provider.revoke({ credentialRef: ref })).rejects.toThrow('copy_delete_failed');
    expect((await provider.inspect(ref)).status).toBe('active');
    await expect(provider.dropCopy(ref)).rejects.toThrow('copy_delete_failed');
  });
});


it('refuses a move that starts during revocation, leaving no copied bytes after revoke', async () => {
  const source = new MemoryBackend('source'); const target = new MemoryBackend('target');
  const provider = new LocalFileSecretProvider(source, new CredentialRefRegistry());
  const { ref } = await provider.write({ kind: 'bearer_token', locator: { type: 'local', key: 'synthetic' }, payload: { value: 'fixture' } });
  const id: CredentialId = { type: 'source_apikey', workspaceId: 'fabric', sourceId: ref.id };
  let entered!: () => void; const atDelete = new Promise<void>(resolve => { entered = resolve; });
  let release!: () => void; const wait = new Promise<void>(resolve => { release = resolve; });
  const originalDelete = source.delete.bind(source);
  source.delete = async key => { entered(); await wait; return originalDelete(key); };
  const revoking = provider.revoke({ credentialRef: ref }); await atDelete;
  await expect(provider.moveCopy(ref, target)).rejects.toThrow('move_in_progress');
  await expect(provider.resolveForLease({ credentialRef: ref })).rejects.toThrow('credential_mutation_in_progress');
  release(); await revoking;
  expect(await source.get(id)).toBeNull(); expect(await target.get(id)).toBeNull();
  expect((await provider.inspect(ref)).status).toBe('missing');
});
