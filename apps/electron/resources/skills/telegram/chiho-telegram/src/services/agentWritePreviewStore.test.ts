import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AppConfig } from '../app/config.js';
import {
  completeAgentWritePreview,
  loadAgentWritePreview,
  saveAgentWritePreview,
} from './agentWritePreviewStore.js';

const cleanup: string[] = [];

function config(root: string, accountLabel = 'default') {
  return {
    sessionPath: join(root, 'telegram.session'),
    accountLabel,
  } as AppConfig;
}

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('agent write preview bindings', () => {
  it('binds previews to the local resource, credential, account, and payload hash', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tg-preview-'));
    cleanup.push(root);
    const record = await saveAgentWritePreview(config(root), {
      kind: 'message.action',
      payload: { action: 'delete', peer: '123', messageId: 7 },
      summary: { risk: 'delete message' },
    });

    expect(record).toMatchObject({
      resourceProfile: 'local-telegram-client',
      credentialId: 'local-session',
      accountId: 'default',
      status: 'pending',
    });
    await expect(
      loadAgentWritePreview(config(root, 'other'), record.previewId, 'message.action'),
    ).rejects.toThrow(/another Telegram account/);

    const recordPath = join(root, 'agent-write-previews', `${record.previewId}.json`);
    const tampered = JSON.parse(await readFile(recordPath, 'utf8'));
    tampered.payload.messageId = 8;
    await writeFile(recordPath, JSON.stringify(tampered));
    await expect(
      loadAgentWritePreview(config(root), record.previewId, 'message.action'),
    ).rejects.toThrow(/integrity check/);
  });

  it('cannot execute a completed preview again under a different idempotency key', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tg-preview-'));
    cleanup.push(root);
    const record = await saveAgentWritePreview(config(root), {
      kind: 'media.send',
      payload: { peer: '123', uploadRef: 'upload' },
      summary: { risk: 'send media' },
    });
    await completeAgentWritePreview(config(root), record);
    await expect(
      loadAgentWritePreview(config(root), record.previewId, 'media.send'),
    ).rejects.toThrow(/already completed/);
  });
});
