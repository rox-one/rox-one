import { describe, expect, it, vi } from 'vitest';
import {
  executeTelegramMessageAction,
  getExactMessage,
  getChatCapabilities,
  safeMediaInfo,
} from './telegramClientTools.js';

describe('Telegram client tool primitives', () => {
  it('counts basic-group participants instead of mtcute\'s unavailable membersCount', async () => {
    const client = { getFullChat: vi.fn().mockResolvedValue({ chatType: 'group', membersCount: 0,
      full: { participants: { _: 'chatParticipants', participants: [{ userId: 1 }, { userId: 2 }] } },
    }) };
    const result = await getChatCapabilities(client as any, '-42');
    expect(result).toMatchObject({ memberCountReported: 2, canViewParticipants: true,
      capabilities: { canManageJoinRequests: false } });
  });
  it('requires peer-scoped exact message lookup', async () => {
    const getMessages = vi.fn().mockResolvedValue([{ id: 7 }]);
    await expect(getExactMessage({ getMessages } as any, '123', 7)).resolves.toMatchObject({ id: 7 });
    expect(getMessages).toHaveBeenCalledWith(123, [7]);
    getMessages.mockResolvedValueOnce([null]);
    await expect(getExactMessage({ getMessages } as any, '123', 7)).rejects.toThrow(/not found/);
  });

  it('maps every approved message action to one Telegram mutation', async () => {
    const client = {
      editMessage: vi.fn().mockResolvedValue({ id: 7 }),
      deleteMessagesById: vi.fn().mockResolvedValue(undefined),
      forwardMessagesById: vi.fn().mockResolvedValue([{ id: 8 }]),
      sendReaction: vi.fn().mockResolvedValue({ id: 7 }),
      pinMessage: vi.fn().mockResolvedValue(null),
      unpinMessage: vi.fn().mockResolvedValue(undefined),
      readHistory: vi.fn().mockResolvedValue(undefined),
      deleteScheduledMessages: vi.fn().mockResolvedValue(undefined),
    } as any;

    await executeTelegramMessageAction(client, { action: 'edit', peer: '1', messageId: 7, text: 'new' });
    await executeTelegramMessageAction(client, { action: 'delete', peer: '1', messageId: 7, revoke: true });
    await executeTelegramMessageAction(client, { action: 'forward', peer: '1', messageId: 7, targetPeer: '2' });
    await executeTelegramMessageAction(client, { action: 'reaction', peer: '1', messageId: 7, emoji: '👍' });
    await executeTelegramMessageAction(client, { action: 'pin', peer: '1', messageId: 7, notify: false, bothSides: false });
    await executeTelegramMessageAction(client, { action: 'unpin', peer: '1', messageId: 7 });
    await executeTelegramMessageAction(client, { action: 'markRead', peer: '1', messageId: 7 });
    await executeTelegramMessageAction(client, { action: 'cancelScheduled', peer: '1', messageId: 7 });

    expect(client.editMessage).toHaveBeenCalledOnce();
    expect(client.deleteMessagesById).toHaveBeenCalledOnce();
    expect(client.forwardMessagesById).toHaveBeenCalledOnce();
    expect(client.sendReaction).toHaveBeenCalledOnce();
    expect(client.pinMessage).toHaveBeenCalledOnce();
    expect(client.unpinMessage).toHaveBeenCalledOnce();
    expect(client.readHistory).toHaveBeenCalledOnce();
    expect(client.deleteScheduledMessages).toHaveBeenCalledOnce();
  });

  it('returns only reviewed media fields and refuses unsupported download types', () => {
    const info = safeMediaInfo({
      media: {
        type: 'document',
        fileName: '../../report.pdf',
        mimeType: 'application/pdf',
        fileSize: 123,
        fileId: 'secret-file-id',
        location: { secret: true },
      },
    } as any);
    expect(info).toEqual({
      type: 'document',
      fileName: '../../report.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 123,
      width: null,
      height: null,
      durationSeconds: null,
      downloadable: true,
    });
    expect(JSON.stringify(info)).not.toContain('secret-file-id');
    expect(safeMediaInfo({ media: { type: 'venue', location: {} } } as any)?.downloadable).toBe(false);
  });
});
