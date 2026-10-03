import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '../app/config.js';
import { createOpaqueCursorCodec } from './opaqueCursor.js';
import { pollTelegramUpdates } from './telegramUpdateStore.js';

const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

function dialog(peer: number, messageId: number) {
  return {
    peer: { id: peer },
    lastMessage: { id: messageId },
  };
}

describe('telegram update polling', () => {
  it('returns bounded changes and detects a cursor from another epoch', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tg-updates-'));
    cleanup.push(root);
    const config = {
      sessionPath: join(root, 'telegram.session'),
      accountLabel: 'default',
    } as AppConfig;
    let messageId = 1;
    const client = {
      iterDialogs: vi.fn(async function* () {
        yield dialog(100, messageId);
      }),
    } as any;
    const codec = createOpaqueCursorCodec('secret');

    const initial = await pollTelegramUpdates(client, config, codec, { limit: 10 });
    expect(initial.events).toEqual([]);
    messageId = 2;
    const changed = await pollTelegramUpdates(client, config, codec, {
      cursor: initial.nextCursor,
      limit: 10,
    });
    expect(changed.gapDetected).toBe(false);
    expect(changed.events).toEqual([
      expect.objectContaining({
        type: 'dialog.last_message_changed',
        peer: '100',
        messageId: 2,
      }),
    ]);

    const wrongEpoch = codec.encode('updates', 'default', {
      epoch: 'different',
      sequence: 0,
    });
    const gap = await pollTelegramUpdates(client, config, codec, {
      cursor: wrongEpoch,
      limit: 10,
    });
    expect(gap.gapDetected).toBe(true);
    expect(gap.events).toEqual([]);
    expect(gap.reconcileWith).toEqual(['dialogs.list', 'chat.read']);
  });
});
