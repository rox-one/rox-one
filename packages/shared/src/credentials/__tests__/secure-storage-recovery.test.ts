import { mkdtempSync, readFileSync, readdirSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'bun:test';
import { SecureStorageBackend } from '../backends/secure-storage.ts';

const ID = { type: 'anthropic_api_key' as const };
const SECRET = { value: 'sk-test-secret-value-do-not-log' };

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'cf2-vault-'));
}

describe('SecureStorageBackend CF-2 recovery', () => {
  it('quarantines a corrupt store instead of deleting the evidence', async () => {
    const directory = tempDir();
    const backend = new SecureStorageBackend({ directory });
    await backend.set(ID, SECRET);

    const file = join(directory, 'credentials.enc');
    const good = readFileSync(file);
    const corrupted = Buffer.from(good);
    const last = corrupted.length - 1;
    corrupted[last] = (corrupted[last] ?? 0) ^ 0xff;
    writeFileSync(file, corrupted);
    backend.clearCache();

    expect(await backend.get(ID)).toBeNull();
    expect(existsSync(file)).toBe(false);

    const quarantined = readdirSync(directory).filter((name) => name.includes('quarantine'));
    expect(quarantined).toHaveLength(1);
    const quarantineFile = quarantined[0];
    if (!quarantineFile) throw new Error('expected quarantine file');
    expect(readFileSync(join(directory, quarantineFile)).equals(corrupted)).toBe(true);

    const state = backend.getRepairState();
    expect(state.status).toBe('repair_required');
    if (state.status !== 'repair_required') throw new Error('expected repair_required');
    expect(state.code).toBe('decrypt_failed');
    expect(state.sourceDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(state)).not.toContain('sk-test-secret');
    expect(JSON.stringify(state)).not.toContain('CORRUPT-EVIDENCE');
  });

  it('blocks writes after repair_required and does not plant an empty store', async () => {
    const directory = tempDir();
    const backend = new SecureStorageBackend({ directory });
    await backend.set(ID, SECRET);
    writeFileSync(join(directory, 'credentials.enc'), Buffer.from('not-a-vault'));
    backend.clearCache();
    await backend.get(ID);

    await expect(backend.set(ID, { value: 'replacement' })).rejects.toMatchObject({
      code: 'WRITE_BLOCKED',
    });
    expect(existsSync(join(directory, 'credentials.enc'))).toBe(false);
  });

  it('keeps a last-good backup and restores it', async () => {
    const directory = tempDir();
    const backend = new SecureStorageBackend({ directory });
    await backend.set(ID, SECRET);
    const first = readFileSync(join(directory, 'credentials.enc'));
    await backend.set(ID, { value: 'sk-second' });

    writeFileSync(join(directory, 'credentials.enc'), Buffer.from('broken'));
    backend.clearCache();
    await backend.get(ID);

    const restored = await backend.restoreFromBackup();
    expect(restored).toBe(true);
    expect(backend.getRepairState().status).toBe('ok');
    expect((await backend.get(ID))?.value).toBe('sk-second');
    expect(first.length).toBeGreaterThan(0);
  });

  it('does not rewrite the file when a legacy-key store is only read', async () => {
    const directory = tempDir();
    const writer = new SecureStorageBackend({ directory, keyVersion: 'v1' });
    await writer.set(ID, SECRET);
    const file = join(directory, 'credentials.enc');
    const before = readFileSync(file);
    const mtime = statSync(file).mtimeMs;

    const reader = new SecureStorageBackend({ directory });
    expect((await reader.get(ID))?.value).toBe(SECRET.value);
    expect(readFileSync(file).equals(before)).toBe(true);
    expect(statSync(file).mtimeMs).toBe(mtime);
  });

  it('writes a payload-free migration manifest on explicit cutover', async () => {
    const directory = tempDir();
    const writer = new SecureStorageBackend({ directory, keyVersion: 'v1' });
    await writer.set(ID, SECRET);

    const reader = new SecureStorageBackend({ directory });
    const manifest = await reader.commitLegacyMigration();
    expect(manifest.entryCount).toBe(1);
    expect(manifest.sourceDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(manifest)).not.toContain('sk-test-secret');
    expect((await reader.get(ID))?.value).toBe(SECRET.value);
  });
});
