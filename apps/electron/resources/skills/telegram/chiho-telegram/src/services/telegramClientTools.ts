import {
  InputMedia,
  type FileDownloadLocation,
  type Message,
  type TelegramClient,
} from '@mtcute/node';
import { normalizePeerRef } from './telegram.js';

export interface SafeTelegramMessage {
  id: number;
  date: string;
  editedAt: string | null;
  outgoing: boolean;
  pinned: boolean;
  sender: {
    id: string;
    displayName: string;
    username: string | null;
  };
  text: string;
  hasMedia: boolean;
  replyToMessageId: number | null;
}

export interface SafeMediaInfo {
  type: string;
  fileName: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
  downloadable: boolean;
}

export function safeTelegramMessage(message: Message): SafeTelegramMessage {
  return {
    id: message.id,
    date: message.date.toISOString(),
    editedAt: message.editDate?.toISOString() ?? null,
    outgoing: message.isOutgoing,
    pinned: message.isPinned,
    sender: {
      id: String(message.sender.id),
      displayName: message.sender.displayName,
      username: message.sender.username ?? null,
    },
    text: message.text,
    hasMedia: Boolean(message.media),
    replyToMessageId: message.replyToMessage?.id ?? null,
  };
}

export async function getExactMessage(
  client: TelegramClient,
  peer: string,
  messageId: number,
) {
  const [message] = await client.getMessages(normalizePeerRef(peer), [messageId]);
  if (!message) {
    throw new Error(`Telegram message ${messageId} was not found in the requested peer.`);
  }
  return message;
}

export async function getThreadPage(
  client: TelegramClient,
  input: { peer: string; messageId: number; pageSize: number; offset?: number },
) {
  const root = await getExactMessage(client, input.peer, input.messageId);
  if (!root.replies || root.replies.count === 0) {
    return {
      root,
      threadKind: 'none' as const,
      messages: [] as Message[],
      nextOffset: null as number | null,
    };
  }

  let threadKind: 'replies' | 'discussion' = 'replies';
  let threadPeer: string | number = normalizePeerRef(input.peer);
  let threadId = root.id;
  if (root.replies.hasComments) {
    const discussionMessage = await client.getDiscussionMessage({
      chatId: normalizePeerRef(input.peer),
      message: root.id,
    });
    if (!discussionMessage) {
      return {
        root,
        threadKind: 'none' as const,
        messages: [] as Message[],
        nextOffset: null as number | null,
      };
    }
    threadKind = 'discussion';
    threadPeer = discussionMessage.chat.id;
    threadId = discussionMessage.id;
  }

  const page = await client.searchMessages({
    chatId: threadPeer,
    query: '',
    threadId,
    offset: input.offset,
    limit: input.pageSize,
  });
  return {
    root,
    threadKind,
    messages: [...page],
    nextOffset: page.next ?? null,
  };
}

export async function getScheduledMessagePage(
  client: TelegramClient,
  input: { peer: string; pageSize: number; offset: number },
) {
  const messages = await client.getAllScheduledMessages(normalizePeerRef(input.peer));
  const ordered = messages.sort((left, right) => left.date.getTime() - right.date.getTime());
  const page = ordered.slice(input.offset, input.offset + input.pageSize);
  const nextOffset = input.offset + page.length < ordered.length
    ? input.offset + page.length
    : null;
  return { messages: page, nextOffset };
}

function numericMediaProperty(media: object, key: string) {
  const value = (media as Record<string, unknown>)[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function stringMediaProperty(media: object, key: string) {
  const value = (media as Record<string, unknown>)[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export function safeMediaInfo(message: Message): SafeMediaInfo | null {
  const media = message.media;
  if (!media) return null;
  const type = stringMediaProperty(media, 'type') ?? 'unsupported';
  const sizeBytes = numericMediaProperty(media, 'fileSize');
  const hasDownloadLocation = [
    'photo',
    'audio',
    'voice',
    'sticker',
    'document',
    'video',
  ].includes(type);
  return {
    type,
    fileName: stringMediaProperty(media, 'fileName'),
    mimeType: stringMediaProperty(media, 'mimeType'),
    sizeBytes,
    width: numericMediaProperty(media, 'width'),
    height: numericMediaProperty(media, 'height'),
    durationSeconds: numericMediaProperty(media, 'duration'),
    downloadable: hasDownloadLocation && (sizeBytes === null || sizeBytes <= 50 * 1024 * 1024),
  };
}

export function downloadableMediaLocation(message: Message) {
  const media = message.media;
  if (
    !media ||
    !['photo', 'audio', 'voice', 'sticker', 'document', 'video'].includes(media.type)
  ) {
    throw new Error('The requested Telegram message has no downloadable media.');
  }
  return media as FileDownloadLocation;
}

export async function getMemberPage(
  client: TelegramClient,
  input: { peer: string; pageSize: number; offset: number; filter?: 'recent' | 'all' | 'admins' | 'bots' | 'contacts' | 'restricted' | 'banned'; query?: string },
) {
  const peer = normalizePeerRef(input.peer);
  const full = await client.getFullChat(peer);
  const filter = input.filter ?? 'recent';
  const query = input.query?.trim() ?? '';
  if (full.chatType === 'group') {
    const participants = (full.full as { participants?: { _: string } }).participants;
    if (participants?._ === 'chatParticipantsForbidden') {
      return { members: [], reportedTotal: null, chatType: 'group', completeness: 'unknown' as const,
        visibility: 'unavailable' as const, limitReason: 'participants_unavailable', hasMore: false, nextOffset: null };
    }
    const all = await client.getChatMembers(peer, { offset: 0, limit: 200 });
    const needle = query.toLocaleLowerCase();
    const matches = [...all].filter((member) => {
      const status = member.status;
      const byFilter = filter === 'recent' || filter === 'all' ||
        (filter === 'admins' && (status === 'admin' || status === 'creator')) ||
        (filter === 'restricted' && status === 'restricted') ||
        (filter === 'banned' && status === 'banned') ||
        (filter === 'bots' && member.user.isBot) ||
        (filter === 'contacts' && member.user.isContact);
      return byFilter && (!needle || `${member.user.displayName} ${member.user.username ?? ''}`.toLocaleLowerCase().includes(needle));
    });
    const members = matches.slice(input.offset, input.offset + input.pageSize);
    const nextOffset = input.offset + members.length < matches.length ? input.offset + members.length : null;
    return { members, reportedTotal: matches.length, chatType: 'group', completeness: 'complete' as const,
      visibility: 'visible' as const, limitReason: null, hasMore: nextOffset !== null, nextOffset };
  }
  if (!full.canViewParticipants && filter !== 'admins') {
    return { members: [], reportedTotal: full.membersCount ?? null, chatType: full.chatType,
      completeness: 'unknown' as const, visibility: 'unavailable' as const,
      limitReason: 'participants_hidden', hasMore: false, nextOffset: null };
  }
  const page = await client.getChatMembers(peer, { offset: input.offset, limit: input.pageSize, type: filter, query });
  const next = input.offset + page.length;
  const nextOffset = page.length > 0 && next < page.total && next < 200 ? next : null;
  return { members: [...page], reportedTotal: page.total, chatType: full.chatType,
    completeness: 'unknown' as const, visibility: full.hasHiddenParticipants ? 'limited' as const : 'visible' as const,
    limitReason: nextOffset === null && next < page.total ? (page.length === 0 ? 'telegram_returned_empty_page' : 'telegram_participant_retrieval_limit') : null,
    hasMore: nextOffset !== null, nextOffset };
}

export async function getMember(client: TelegramClient, peer: string, userId: string) {
  if (userId.startsWith('+')) throw new Error('Use a returned user ID or username, not a phone number.');
  const chat = normalizePeerRef(peer);
  const full = await client.getFullChat(chat);
  if (full.chatType === 'group' && (full.full as { participants?: { _: string } }).participants?._ === 'chatParticipantsForbidden') {
    return { membership: 'unknown' as const, reason: 'participants_unavailable', member: null };
  }
  if (full.chatType !== 'group' && !full.canViewParticipants) {
    return { membership: 'unknown' as const, reason: 'participants_hidden', member: null };
  }
  try {
    const member = await client.getChatMember({ chatId: chat, userId: normalizePeerRef(userId) });
    return member ? { membership: 'member' as const, reason: null, member } :
      { membership: 'not_member' as const, reason: 'not_participant', member: null };
  } catch (error) {
    const code = String((error as { text?: string; code?: string }).text ?? (error as { code?: string }).code ?? '');
    if (/CHAT_ADMIN_REQUIRED|CHANNEL_PRIVATE|PARTICIPANT_ID_INVALID|USER_ID_INVALID/.test(code)) {
      return { membership: 'unknown' as const, reason: code.toLowerCase(), member: null };
    }
    throw error;
  }
}

export async function getChatCapabilities(client: TelegramClient, peer: string) {
  const full = await client.getFullChat(normalizePeerRef(peer));
  const basic = full.chatType === 'group';
  const basicParticipants = basic
    ? (full.full as { participants?: { _: string; participants?: unknown[] } }).participants
    : undefined;
  const rights = Object.fromEntries(Object.entries(full.adminRights ?? {})
    .filter(([key, value]) => key !== '_' && typeof value === 'boolean')) as Record<string, boolean>;
  const defaults = full.defaultPermissions;
  const memberVisible = basic
    ? basicParticipants?._ === 'chatParticipants' ? true : basicParticipants?._ === 'chatParticipantsForbidden' ? false : null
    : full.canViewParticipants;
  return {
    chatType: full.chatType,
    membership: full.isCreator ? 'creator' : full.isAdmin ? 'admin' : full.isMember ? 'member' : 'left',
    memberCountReported: basic ? basicParticipants?.participants?.length ?? null :
      (full.full as { participantsCount?: number }).participantsCount ?? null,
    participantVisibility: memberVisible === null ? 'unknown' : memberVisible ?
      (full.hasHiddenParticipants ? 'limited' : 'visible') : 'unavailable',
    participantsHidden: full.hasHiddenParticipants,
    canViewParticipants: memberVisible,
    adminRights: rights,
    defaultPermissions: defaults ? { canSendMessages: defaults.canSendMessages, canInviteUsers: defaults.canInviteUsers } : {},
    capabilities: {
      canListMembers: memberVisible,
      canListAdmins: full.isMember || full.isAdmin || full.isCreator ? true : null,
      canInvite: full.isCreator ? true : rights.inviteUsers ?? null,
      canManageJoinRequests: basic ? false : full.isCreator ? true : rights.inviteUsers ?? null,
      canViewAdminLog: basic ? false : full.isAdmin || full.isCreator,
    },
  };
}

export type TelegramMessageAction =
  | { action: 'edit'; peer: string; messageId: number; text: string }
  | { action: 'delete'; peer: string; messageId: number; revoke: boolean }
  | { action: 'forward'; peer: string; messageId: number; targetPeer: string }
  | { action: 'reaction'; peer: string; messageId: number; emoji: string | null }
  | { action: 'pin'; peer: string; messageId: number; notify: boolean; bothSides: boolean }
  | { action: 'unpin'; peer: string; messageId: number }
  | { action: 'markRead'; peer: string; messageId: number }
  | { action: 'cancelScheduled'; peer: string; messageId: number };

export async function executeTelegramMessageAction(
  client: TelegramClient,
  action: TelegramMessageAction,
) {
  const peer = normalizePeerRef(action.peer);
  switch (action.action) {
    case 'edit': {
      const message = await client.editMessage({
        chatId: peer,
        message: action.messageId,
        text: action.text,
      });
      return { resultMessageId: message.id };
    }
    case 'delete':
      await client.deleteMessagesById(peer, [action.messageId], { revoke: action.revoke });
      return { resultMessageId: null };
    case 'forward': {
      const [message] = await client.forwardMessagesById({
        toChatId: normalizePeerRef(action.targetPeer),
        fromChatId: peer,
        messages: [action.messageId],
      });
      return { resultMessageId: message?.id ?? null };
    }
    case 'reaction': {
      const message = await client.sendReaction({
        chatId: peer,
        message: action.messageId,
        emoji: action.emoji,
      });
      return { resultMessageId: message?.id ?? action.messageId };
    }
    case 'pin':
      await client.pinMessage({
        chatId: peer,
        message: action.messageId,
        notify: action.notify,
        bothSides: action.bothSides,
      });
      return { resultMessageId: action.messageId };
    case 'unpin':
      await client.unpinMessage({ chatId: peer, message: action.messageId });
      return { resultMessageId: action.messageId };
    case 'markRead':
      await client.readHistory(peer, { maxId: action.messageId });
      return { resultMessageId: action.messageId };
    case 'cancelScheduled':
      await client.deleteScheduledMessages(peer, [action.messageId]);
      return { resultMessageId: null };
  }
}

export async function sendManagedMedia(
  client: TelegramClient,
  input: {
    peer: string;
    storedPath: string;
    mediaKind: 'file' | 'photo' | 'voice';
    caption?: string;
    schedule?: Date | number;
  },
) {
  const source = `file:${input.storedPath}`;
  const media = input.mediaKind === 'photo'
    ? InputMedia.photo(source)
    : input.mediaKind === 'voice'
      ? InputMedia.voice(source)
      : InputMedia.document(source);
  return client.sendMedia(normalizePeerRef(input.peer), media, {
    ...(input.caption ? { caption: input.caption } : {}),
    ...(input.schedule ? { schedule: input.schedule } : {}),
  });
}
