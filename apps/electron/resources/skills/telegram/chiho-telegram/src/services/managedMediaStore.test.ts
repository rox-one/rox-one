import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AppConfig } from '../app/config.js';
import {
  createMediaDownloadReference,
  loadManagedUpload,
  loadMediaDownloadReference,
  stageManagedUpload,
} from './managedMediaStore.js';

const cleanup: string[] = [];

function config(root: string, accountLabel = 'default') {
  return { sessionPath: join(root, 'telegram.session'), accountLabel } as AppConfig;
}

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('managed media store', () => {
  it('stages immutable local files and rejects changed bytes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tg-media-'));
    cleanup.push(root);
    const source = join(root, 'picture.png');
    await writeFile(source, Buffer.from('safe-image'));
    const record = await stageManagedUpload(config(root), source);
    expect(record).toMatchObject({
      fileName: 'picture.png',
      contentType: 'image/png',
      sizeBytes: 10,
    });
    expect(record.sha256).toMatch(/^[a-f0-9]{64}$/);
    await expect(loadManagedUpload(config(root), record.uploadRef)).resolves.toMatchObject({
      sha256: record.sha256,
    });
    await writeFile(record.storedPath, Buffer.from('changed'));
    await expect(loadManagedUpload(config(root), record.uploadRef)).rejects.toThrow(
      /changed after staging|integrity check/,
    );
  });

  it('binds short-lived download references to the Telegram account', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tg-media-'));
    cleanup.push(root);
    const record = await createMediaDownloadReference(config(root), {
      peer: '123',
      messageId: 9,
      fileName: '../unsafe.pdf',
      contentType: 'application/pdf',
      sizeBytes: 100,
    });
    expect(record.fileName).toBe('unsafe.pdf');
    await expect(
      loadMediaDownloadReference(config(root, 'other'), record.downloadRef),
    ).rejects.toThrow(/another Telegram account/);
  });
});
