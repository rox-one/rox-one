import { describe, expect, it } from 'bun:test';
import { CredentialRefRegistry } from '@craft-agent/core/platform';
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
