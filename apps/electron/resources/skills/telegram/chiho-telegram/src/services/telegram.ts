import type { TelegramClient, Message, Peer, User } from '@mtcute/node';
import { Dialog, Long, tl } from '@mtcute/node';
import qrcodeTerminal from 'qrcode-terminal';

const RATE_LIMIT_ERROR_PREFIX_RE = /^(FLOOD_WAIT|SLOWMODE_WAIT|FLOOD_TEST_PHONE_WAIT|FLOOD_PREMIUM_WAIT)$/;
const RATE_LIMIT_ERROR_RE = /\b(FLOOD_WAIT|SLOWMODE_WAIT|FLOOD_TEST_PHONE_WAIT|FLOOD_PREMIUM_WAIT)_(\d+)\b/;
const DEFAULT_TELEGRAM_BACKOFF_ATTEMPTS = 3;
const DEFAULT_TELEGRAM_MAX_BACKOFF_MS = 2 * 60 * 1000;

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorText(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export interface TelegramRateLimit {
  code: string;
  waitMs: number;
}

export interface TelegramBackoffEvent extends TelegramRateLimit {
  operation: string;
  attempt: number;
}

export interface TelegramBackoffOptions {
  maxAttempts?: number;
  maxWaitMs?: number;
  sleep?: (ms: number) => Promise<void>;
  onBackoff?: (event: TelegramBackoffEvent) => void;
}

export type TelegramBackoffResult<T> =
  | {
      ok: true;
      value: T;
      backoffs: TelegramBackoffEvent[];
    }
  | {
      ok: false;
      error: unknown;
      code: string;
      retryAfterMs: number;
      backoffs: TelegramBackoffEvent[];
    };

export function telegramRateLimit(error: unknown): TelegramRateLimit | null {
  const text = (error as { text?: unknown })?.text;
  const rawSeconds = (error as { seconds?: unknown })?.seconds;
  if (typeof text === 'string' && typeof rawSeconds === 'number' && Number.isSafeInteger(rawSeconds)) {
    const prefix = text.endsWith('_%d') ? text.slice(0, -3) : text;
    if (RATE_LIMIT_ERROR_PREFIX_RE.test(prefix)) {
      return {
        code: `${prefix}_${rawSeconds}`,
        waitMs: Math.max(1, rawSeconds) * 1000,
      };
    }
  }

  const explicit =
    (error as { errorMessage?: unknown; code?: unknown })?.errorMessage ??
    (error as { code?: unknown })?.code;
  const haystack = [explicit, errorText(error)]
    .filter((value): value is string => typeof value === 'string')
    .join(' ');
  const match = haystack.match(RATE_LIMIT_ERROR_RE);
  if (!match) {
    return null;
  }

  const seconds = Number.parseInt(match[2], 10);
  if (!Number.isSafeInteger(seconds) || seconds < 0) {
    return null;
  }
  return {
    code: `${match[1]}_${seconds}`,
    waitMs: Math.max(1, seconds) * 1000,
  };
}

export async function withTelegramRateLimitBackoff<T>(
  operation: string,
  run: () => Promise<T>,
  options: TelegramBackoffOptions = {},
): Promise<TelegramBackoffResult<T>> {
  const maxAttempts = options.maxAttempts ?? DEFAULT_TELEGRAM_BACKOFF_ATTEMPTS;
  const maxWaitMs = options.maxWaitMs ?? DEFAULT_TELEGRAM_MAX_BACKOFF_MS;
  const sleepFn = options.sleep ?? sleep;
  const backoffs: TelegramBackoffEvent[] = [];

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return { ok: true, value: await run(), backoffs };
    } catch (error) {
      const rateLimit = telegramRateLimit(error);
      if (!rateLimit) {
        throw error;
      }

      const event = {
        operation,
        attempt,
        ...rateLimit,
      };
      backoffs.push(event);

      if (attempt >= maxAttempts || rateLimit.waitMs > maxWaitMs) {
        return {
          ok: false,
          error,
          code: rateLimit.code,
          retryAfterMs: rateLimit.waitMs,
          backoffs,
        };
      }

      options.onBackoff?.(event);
      await sleepFn(rateLimit.waitMs);
    }
  }

  throw new Error('unreachable telegram backoff state');
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1)}...`;
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function formatMessagePreview(message: Message | null): string {
  if (!message) return '[no messages yet]';

  const sender = message.sender.displayName;
  const text = collapseWhitespace(message.text);
  if (text) {
    return truncate(`${sender}: ${text}`, 120);
  }

  if (message.isService) return '[service message]';
  if (message.media) return `${sender}: [${message.media.type}]`;

  return `${sender}: [unsupported message]`;
}

export function messageTextForAi(message: Message): string {
  const text = collapseWhitespace(message.text);
  if (text) return text;
  if (message.isService) return '[service message]';
  if (message.media) return `[media:${message.media.type}]`;
  return '[unsupported message]';
}

export interface AiConversationMessage {
  sender: string;
  text: string;
  at: string;
}

export function buildAiConversation(messages: Message[]): AiConversationMessage[] {
  return messages
    .slice()
    .sort((left, right) => left.date.getTime() - right.date.getTime())
    .map((message) => ({
      sender: message.sender.displayName,
      text: messageTextForAi(message),
      at: message.date.toISOString(),
    }));
}

export async function ensureAuthorized(client: TelegramClient): Promise<void> {
  try {
    await client.start({
      qrCodeHandler: (url, expires) => {
        console.log('\nScan this QR code with Telegram:');
        qrcodeTerminal.generate(url, { small: true });
        console.log(`QR expires at ${formatDate(expires)}.\n`);
      },
      password: () => client.input('2FA password (if enabled) > '),
      invalidCodeCallback: async (type) => {
        console.log(`Invalid ${type}. Please try again.`);
      },
    });
    return;
  } catch (error) {
    console.log(
      `QR login failed (${error instanceof Error ? error.message : String(error)}).`,
    );
    console.log('Falling back to phone login...\n');
  }

  const phone = await client.input('Phone number (+123456789) > ');
  await client.start({
    phone,
    code: () => client.input('Login code > '),
    password: () => client.input('2FA password (if enabled) > '),
    invalidCodeCallback: async (type) => {
      console.log(`Invalid ${type}. Please try again.`);
    },
  });
}

export interface ListDialogsOptions {
  limit: number;
  all: boolean;
  includeArchived?: boolean;
}

export type TelegramDialogLocation = 'active' | 'archived' | 'all';
export type TelegramPeerKind = 'user' | 'chat' | 'channel' | 'self';

export interface TelegramDialogOffsetPeer {
  kind: TelegramPeerKind;
  id: string;
  accessHash?: string;
}

export interface TelegramDialogOffset {
  date: number;
  id: number;
  peer: TelegramDialogOffsetPeer;
}

export interface TelegramDialogPage {
  dialogs: Dialog[];
  total: number;
  nextOffset: TelegramDialogOffset | null;
}

export interface TelegramDialogTotals {
  activeTotal: number;
  archivedTotal: number;
  allTotal: number;
}

export interface TelegramDialogInventoryItem {
  peer: {
    id: string;
    kind: TelegramPeerKind;
    displayName: string;
    username: string | null;
  };
  archived: boolean;
  pinned: boolean;
  unreadCount: number;
  lastMessage: {
    id: number;
    date: string;
    preview: string;
  } | null;
}

export interface TelegramContactItem {
  peerId: string;
  displayName: string;
  username: string | null;
}

function totalFromDialogsResponse(response: tl.messages.TypeDialogs): number {
  if (response._ === 'messages.dialogsSlice' || response._ === 'messages.dialogsNotModified') {
    return response.count;
  }
  return response.dialogs.length;
}

function serializeInputPeer(peer: tl.TypeInputPeer): TelegramDialogOffsetPeer {
  switch (peer._) {
    case 'inputPeerSelf':
      return { kind: 'self', id: 'self' };
    case 'inputPeerUser':
      return {
        kind: 'user',
        id: peer.userId.toString(),
        accessHash: peer.accessHash.toString(),
      };
    case 'inputPeerChat':
      return { kind: 'chat', id: peer.chatId.toString() };
    case 'inputPeerChannel':
      return {
        kind: 'channel',
        id: peer.channelId.toString(),
        accessHash: peer.accessHash.toString(),
      };
    default:
      throw new Error(`Unsupported Telegram dialog offset peer: ${peer._}`);
  }
}

function deserializeInputPeer(peer: TelegramDialogOffsetPeer): tl.TypeInputPeer {
  if (peer.kind === 'self') {
    return { _: 'inputPeerSelf' };
  }
  const id = Number(peer.id);
  if (!Number.isSafeInteger(id)) {
    throw new Error('Telegram dialog cursor contains an invalid peer id.');
  }
  if (peer.kind === 'chat') {
    return { _: 'inputPeerChat', chatId: id };
  }
  if (!peer.accessHash) {
    throw new Error('Telegram dialog cursor is missing a required access hash.');
  }
  if (peer.kind === 'user') {
    return {
      _: 'inputPeerUser',
      userId: id,
      accessHash: Long.fromString(peer.accessHash),
    };
  }
  return {
    _: 'inputPeerChannel',
    channelId: id,
    accessHash: Long.fromString(peer.accessHash),
  };
}

export function telegramPeerKind(peer: Peer): TelegramPeerKind {
  if (peer.type === 'user') {
    return peer.isSelf ? 'self' : 'user';
  }
  return peer.chatType === 'group' ? 'chat' : 'channel';
}

export function dialogInventoryKey(dialog: Dialog): string {
  return `${telegramPeerKind(dialog.peer)}:${dialog.peer.id}`;
}

export function mapDialogInventoryItem(dialog: Dialog): TelegramDialogInventoryItem {
  return {
    peer: {
      id: String(dialog.peer.id),
      kind: telegramPeerKind(dialog.peer),
      displayName: dialog.peer.displayName,
      username: dialog.peer.username ?? null,
    },
    archived: dialog.isArchived,
    pinned: dialog.isPinned,
    unreadCount: dialog.unreadCount,
    lastMessage: dialog.lastMessage
      ? {
          id: dialog.lastMessage.id,
          date: dialog.lastMessage.date.toISOString(),
          preview: formatMessagePreview(dialog.lastMessage),
        }
      : null,
  };
}

export async function fetchTelegramDialogFolderPage(
  client: TelegramClient,
  params: {
    location: Exclude<TelegramDialogLocation, 'all'>;
    limit: number;
    offset?: TelegramDialogOffset | null;
  },
): Promise<TelegramDialogPage> {
  const response = await client.call({
    _: 'messages.getDialogs',
    excludePinned: false,
    folderId: params.location === 'archived' ? 1 : 0,
    offsetDate: params.offset?.date ?? 0,
    offsetId: params.offset?.id ?? 0,
    offsetPeer: params.offset
      ? deserializeInputPeer(params.offset.peer)
      : { _: 'inputPeerEmpty' },
    limit: params.limit,
    hash: Long.ZERO,
  });

  if (response._ === 'messages.dialogsNotModified') {
    return { dialogs: [], total: response.count, nextOffset: null };
  }

  const dialogs = Dialog.parseTlDialogs(response);
  const last = dialogs.at(-1) ?? null;
  return {
    dialogs,
    total: totalFromDialogsResponse(response),
    nextOffset: last
      ? {
          date: last.lastMessage?.raw.date ?? 0,
          id: last.raw.topMessage,
          peer: serializeInputPeer(last.peer.inputPeer),
        }
      : null,
  };
}

async function fetchTelegramDialogFolderTotal(
  client: TelegramClient,
  location: Exclude<TelegramDialogLocation, 'all'>,
): Promise<number> {
  const page = await fetchTelegramDialogFolderPage(client, {
    location,
    limit: 1,
  });
  return page.total;
}

export async function getTelegramDialogTotals(
  client: TelegramClient,
): Promise<TelegramDialogTotals> {
  const [activeTotal, archivedTotal] = await Promise.all([
    fetchTelegramDialogFolderTotal(client, 'active'),
    fetchTelegramDialogFolderTotal(client, 'archived'),
  ]);
  return {
    activeTotal,
    archivedTotal,
    allTotal: activeTotal + archivedTotal,
  };
}

export async function getTelegramContacts(client: TelegramClient): Promise<User[]> {
  return client.getContacts();
}

export function mapTelegramContact(user: User): TelegramContactItem {
  return {
    peerId: String(user.id),
    displayName: user.displayName,
    username: user.username ?? null,
  };
}

export function normalizePeerRef(value: string | number): string | number {
  if (typeof value === 'number') return value;
  const trimmed = value.trim();
  if (/^-?\d+$/.test(trimmed)) {
    const parsed = Number.parseInt(trimmed, 10);
    if (Number.isSafeInteger(parsed)) {
      return parsed;
    }
  }
  return trimmed;
}

export async function resolveChatPeer(
  client: TelegramClient,
  value: string | number,
): Promise<Peer> {
  const normalized = normalizePeerRef(value);

  if (typeof normalized === 'number') {
    const dialogs = await listDialogs(client, {
      all: false,
      includeArchived: true,
      limit: 1000,
    });
    const dialog = dialogs.find((item) => item.peer.id === normalized);
    if (dialog) {
      return dialog.peer;
    }
  }

  return client.getPeer(normalized);
}

export async function listDialogs(
  client: TelegramClient,
  options: ListDialogsOptions,
): Promise<Dialog[]> {
  const dialogIterator = client.iterDialogs({
    ...(!options.all && options.limit > 0 ? { limit: options.limit } : {}),
    pinned: 'include',
    archived: options.all || options.includeArchived ? 'keep' : 'exclude',
  });

  const dialogs: Dialog[] = [];
  for await (const dialog of dialogIterator) {
    dialogs.push(dialog);
  }
  return dialogs;
}

export function peerToRow(peer: Peer): {
  peerId: number;
  peerKind: 'user' | 'chat';
  username: string | null;
  displayName: string;
} {
  return {
    peerId: peer.id,
    peerKind: peer.type,
    username: peer.username,
    displayName: peer.displayName,
  };
}

export async function fetchChatHistory(
  client: TelegramClient,
  params: {
    chatId: string | number | Peer;
    limit: number;
    sinceMessageId?: number;
    offsetDate?: number;
    offsetMessageId?: number;
  },
): Promise<Message[]> {
  const chatId =
    typeof params.chatId === 'object'
      ? params.chatId
      : normalizePeerRef(params.chatId);
  const iterator = client.iterHistory(chatId, {
    limit: params.limit,
    ...(params.sinceMessageId ? { minId: params.sinceMessageId } : {}),
    ...(params.offsetDate || params.offsetMessageId
      ? {
          offset: {
            date: params.offsetDate ?? 0,
            id: params.offsetMessageId ?? 0,
          },
        }
      : {}),
  });

  const messages: Message[] = [];
  for await (const message of iterator) {
    messages.push(message);
  }
  return messages;
}

export async function searchTelegramMessages(
  client: TelegramClient,
  params: { query: string; limit: number; chatId?: string | number },
): Promise<Message[]> {
  const iterator = params.chatId
    ? client.iterSearchMessages({
        chatId: normalizePeerRef(params.chatId),
        query: params.query,
        limit: params.limit,
      })
    : client.iterSearchGlobal({
        query: params.query,
        limit: params.limit,
      });

  const messages: Message[] = [];
  for await (const message of iterator) {
    messages.push(message);
  }
  return messages;
}

export function toTextWithEntities(text: string): tl.RawTextWithEntities {
  return {
    _: 'textWithEntities',
    text,
    entities: [],
  };
}

function inputPeerKey(peer: tl.TypeInputPeer): string {
  return JSON.stringify(peer);
}

export function uniqueInputPeers(peers: tl.TypeInputPeer[]): tl.TypeInputPeer[] {
  const seen = new Set<string>();
  const result: tl.TypeInputPeer[] = [];
  for (const peer of peers) {
    const key = inputPeerKey(peer);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(peer);
  }
  return result;
}

export function folderTitle(folder: tl.RawDialogFilter): string {
  return folder.title.text;
}

export async function listEditableFolders(client: TelegramClient): Promise<tl.RawDialogFilter[]> {
  const folders = await client.getFolders();
  return folders.filters.filter((filter): filter is tl.RawDialogFilter => filter._ === 'dialogFilter');
}

export async function resolveFolderByRef(
  client: TelegramClient,
  folderRef: string,
): Promise<tl.RawDialogFilter> {
  const folders = await listEditableFolders(client);
  const asId = Number.parseInt(folderRef, 10);
  const folder = Number.isInteger(asId)
    ? folders.find((item) => item.id === asId)
    : folders.find((item) => folderTitle(item).toLowerCase() === folderRef.toLowerCase());

  if (!folder) {
    throw new Error(`Folder not found: ${folderRef}`);
  }
  return folder;
}
