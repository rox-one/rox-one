import { existsSync, mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'bun:test';
import { SecureStorageBackend } from '../backends/secure-storage.ts';

const ID = { type: 'anthropic_api_key' as const };

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'cf2-master-key-'));
}

describe('SecureStorageBackend master key (RX-TSK-0300 / RX-TSK-0301)', () => {
  it('shares one random master key across instances via keychain or 0600 file', async () => {
    const directory = tempDir();
    const writer = new SecureStorageBackend({ directory });
    await writer.set(ID, { value: 'sk-master-key-shared' });

    const reader = new SecureStorageBackend({ directory });
    expect((await reader.get(ID))?.value).toBe('sk-master-key-shared');

    // На системах без доступной ключницы ключ лежит в файле с жёстким режимом.
    const keyFile = join(directory, 'credentials.key');
    if (existsSync(keyFile)) {
      expect(statSync(keyFile).mode & 0o777).toBe(0o600);
    }
  });

  it('reads legacy v2 (machine-id) stores and migrates them only on explicit cutover', async () => {
    const directory = tempDir();
    const legacyWriter = new SecureStorageBackend({ directory, keyVersion: 'v2' });
    await legacyWriter.set(ID, { value: 'sk-legacy-v2' });

    const reader = new SecureStorageBackend({ directory });
    expect((await reader.get(ID))?.value).toBe('sk-legacy-v2');

    const manifest = await reader.commitLegacyMigration();
    expect(manifest.entryCount).toBe(1);
    expect(manifest.codecStatus).toBe('legacy-to-v2');
    expect((await reader.get(ID))?.value).toBe('sk-legacy-v2');
  });

  it('writes the backup copy with mode 0600', async () => {
    const directory = tempDir();
    const backend = new SecureStorageBackend({ directory });
    await backend.set(ID, { value: 'sk-first' });
    await backend.set(ID, { value: 'sk-second' });

    const backup = join(directory, 'credentials.enc.bak');
    expect(existsSync(backup)).toBe(true);
    expect(statSync(backup).mode & 0o777).toBe(0o600);
  });
});
