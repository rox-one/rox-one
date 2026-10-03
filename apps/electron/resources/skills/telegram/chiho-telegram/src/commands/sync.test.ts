import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppContext } from '../app/context.js';
import { runSync } from './sync.js';

describe('runSync', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reports partial backfill metadata when a dialog hits a long flood-wait', async () => {
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((value: string) => {
      logs.push(value);
    });

    const peerA = {
      id: 101,
      type: 'user',
      displayName: 'Peer A',
      username: null,
    };
    const peerB = {
      id: 202,
      type: 'user',
      displayName: 'Peer B',
      username: null,
    };
    const message = {
      id: 10,
      date: new Date('2026-06-11T00:00:00.000Z'),
      sender: peerA,
      text: 'hello',
      isService: false,
      media: null,
    };
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('INSERT INTO accounts')) {
        return { rows: [{ id: '1' }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });
    const telegram = {
      start: vi.fn(async () => undefined),
      iterDialogs: vi.fn(async function* () {
        yield { peer: peerA, lastMessage: message, isArchived: false, isPinned: false, unreadCount: 0 };
        yield { peer: peerB, lastMessage: null, isArchived: false, isPinned: false, unreadCount: 0 };
      }),
      iterHistory: vi.fn(async function* (chatId: number) {
        if (chatId === peerB.id) {
          throw { errorMessage: 'FLOOD_WAIT_999' };
        }
        yield message;
      }),
    };

    const ctx = {
      config: {
        accountLabel: 'default',
        sessionPath: '/tmp/test.session',
        jsonOutput: true,
      },
      db: { query },
      telegram,
    } as unknown as AppContext;

    await runSync(ctx, ['backfill', '--dialogs', '2', '--per-chat-limit', '1']);

    expect(JSON.parse(logs.at(-1) ?? '')).toEqual({
      ok: true,
      mode: 'backfill',
      partial: true,
      dialogs: 2,
      skippedDialogs: [
        {
          peerId: 202,
          displayName: 'Peer B',
          code: 'FLOOD_WAIT_999',
          retryAfterMs: 999_000,
        },
      ],
      messagesProcessed: 1,
      rateLimitBackoffs: [
        {
          operation: 'sync.backfill.history:202',
          attempt: 1,
          code: 'FLOOD_WAIT_999',
          retryAfterMs: 999_000,
        },
      ],
    });
  });
});
