import { describe, expect, it, vi } from 'vitest';
import {
  fetchChatHistory,
  getTelegramContacts,
  getTelegramDialogTotals,
  mapTelegramContact,
  resolveChatPeer,
  telegramRateLimit,
  withTelegramRateLimitBackoff,
} from './telegram.js';
import { Dialog } from '@mtcute/node';

describe('resolveChatPeer', () => {
  it('uses visible dialogs for numeric peer ids', async () => {
    const peer = {
      id: -1003504325521,
      type: 'chat',
      displayName: 'takopi dev',
      username: null,
    };
    const client = {
      getPeer: vi.fn(),
      iterDialogs: vi.fn(async function* () {
        yield { peer };
      }),
    };

    await expect(resolveChatPeer(client as any, '-1003504325521')).resolves.toBe(peer);
    expect(client.getPeer).not.toHaveBeenCalled();
    expect(client.iterDialogs).toHaveBeenCalledWith({
      limit: 1000,
      pinned: 'include',
      archived: 'keep',
    });
  });

  it('preserves non-numeric peer resolution errors', async () => {
    const error = new Error('Peer with username takopi dev was not found');
    const client = {
      getPeer: vi.fn().mockRejectedValue(error),
      iterDialogs: vi.fn(),
    };

    await expect(resolveChatPeer(client as any, 'takopi dev')).rejects.toBe(error);
    expect(client.iterDialogs).not.toHaveBeenCalled();
  });
});

describe('fetchChatHistory', () => {
  it('passes resolved peer objects to iterHistory', async () => {
    const peer = {
      id: -1003504325521,
      type: 'chat',
      displayName: 'takopi dev',
      username: null,
    };
    const message = {
      id: 3198,
      date: new Date('2026-06-02T05:22:30.000Z'),
      sender: peer,
      text: 'hello',
    };
    const client = {
      iterHistory: vi.fn(async function* () {
        yield message;
      }),
    };

    await expect(
      fetchChatHistory(client as any, { chatId: peer as any, limit: 10 }),
    ).resolves.toEqual([message]);
    expect(client.iterHistory).toHaveBeenCalledWith(peer, { limit: 10 });
  });

  it('passes both parts of a lossless history cursor to iterHistory', async () => {
    const peer = {
      id: -1003504325521,
      type: 'chat',
      displayName: 'takopi dev',
      username: null,
    };
    const client = {
      iterHistory: vi.fn(async function* () {}),
    };

    await fetchChatHistory(client as any, {
      chatId: peer as any,
      limit: 200,
      offsetDate: 1_700_000_000,
      offsetMessageId: 3198,
    });

    expect(client.iterHistory).toHaveBeenCalledWith(peer, {
      limit: 200,
      offset: { date: 1_700_000_000, id: 3198 },
    });
  });
});

describe('semantic Telegram inventories', () => {
  it('measures active and archived folder totals without materializing all dialogs', async () => {
    const parseSpy = vi.spyOn(Dialog, 'parseTlDialogs').mockReturnValue([]);
    const client = {
      call: vi
        .fn()
        .mockResolvedValueOnce({ _: 'messages.dialogsSlice', count: 420, dialogs: [] })
        .mockResolvedValueOnce({ _: 'messages.dialogsSlice', count: 80, dialogs: [] }),
    };

    await expect(getTelegramDialogTotals(client as any)).resolves.toEqual({
      activeTotal: 420,
      archivedTotal: 80,
      allTotal: 500,
    });
    expect(client.call.mock.calls.map(([request]) => request.folderId)).toEqual([0, 1]);
    expect(client.call.mock.calls.every(([request]) => request.limit === 1)).toBe(true);
    parseSpy.mockRestore();
  });

  it('uses Telegram contacts and omits phone numbers and access hashes from mapped output', async () => {
    const rawUser = {
      id: 123,
      displayName: 'Alice',
      username: 'alice',
      phoneNumber: '+12025550123',
      raw: { accessHash: 'secret-access-hash' },
    };
    const client = { getContacts: vi.fn().mockResolvedValue([rawUser]) };

    await expect(getTelegramContacts(client as any)).resolves.toEqual([rawUser]);
    expect(mapTelegramContact(rawUser as any)).toEqual({
      peerId: '123',
      displayName: 'Alice',
      username: 'alice',
    });
    expect(JSON.stringify(mapTelegramContact(rawUser as any))).not.toMatch(
      /phone|accessHash|12025550123|secret-access-hash/,
    );
  });
});

describe('telegram rate-limit backoff', () => {
  it('extracts retry delays from Telegram flood-wait errors', () => {
    expect(telegramRateLimit({ errorMessage: 'FLOOD_WAIT_12' })).toEqual({
      code: 'FLOOD_WAIT_12',
      waitMs: 12_000,
    });
    expect(telegramRateLimit(new Error('RPC failed: SLOWMODE_WAIT_0'))).toEqual({
      code: 'SLOWMODE_WAIT_0',
      waitMs: 1_000,
    });
    expect(telegramRateLimit({ code: 420, text: 'FLOOD_WAIT_%d', seconds: 12 })).toEqual({
      code: 'FLOOD_WAIT_12',
      waitMs: 12_000,
    });
    expect(telegramRateLimit(new Error('PEER_ID_INVALID'))).toBeNull();
  });

  it('retries bounded rate-limit errors and returns the eventual value', async () => {
    const sleep = vi.fn(async () => undefined);
    const onBackoff = vi.fn();
    const run = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce({ errorMessage: 'FLOOD_WAIT_2' })
      .mockResolvedValueOnce('ok');

    await expect(
      withTelegramRateLimitBackoff('history', run, { sleep, onBackoff }),
    ).resolves.toEqual({
      ok: true,
      value: 'ok',
      backoffs: [
        {
          operation: 'history',
          attempt: 1,
          code: 'FLOOD_WAIT_2',
          waitMs: 2_000,
        },
      ],
    });
    expect(sleep).toHaveBeenCalledWith(2_000);
    expect(onBackoff).toHaveBeenCalledWith({
      operation: 'history',
      attempt: 1,
      code: 'FLOOD_WAIT_2',
      waitMs: 2_000,
    });
  });

  it('returns a structured failure when the retry delay is too large', async () => {
    const error = { errorMessage: 'FLOOD_WAIT_999' };
    const sleep = vi.fn(async () => undefined);

    await expect(
      withTelegramRateLimitBackoff('history', () => Promise.reject(error), {
        maxWaitMs: 1_000,
        sleep,
      }),
    ).resolves.toEqual({
      ok: false,
      error,
      code: 'FLOOD_WAIT_999',
      retryAfterMs: 999_000,
      backoffs: [
        {
          operation: 'history',
          attempt: 1,
          code: 'FLOOD_WAIT_999',
          waitMs: 999_000,
        },
      ],
    });
    expect(sleep).not.toHaveBeenCalled();
  });
});
