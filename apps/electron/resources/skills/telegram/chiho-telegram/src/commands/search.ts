import type { AppContext } from '../app/context.js';
import {
  parseCommandArgs,
  optionValue,
  parsePositiveInt,
  hasFlag,
} from '../app/cli-args.js';
import {
  ensureAuthorized,
  normalizePeerRef,
  searchTelegramMessages,
} from '../services/telegram.js';
import { requireAccountId } from '../app/account.js';
import { searchLocalMessages } from '../db/crm.js';
import { printJson } from '../output.js';
import { canonicalPeerKind, type StoredPeerKind } from '../db/peerIdentity.js';

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function numericPeerIdFromRef(value: string): number | undefined {
  const trimmed = value.trim();
  if (!/^-?\d+$/.test(trimmed)) {
    return undefined;
  }

  const parsed = Number.parseInt(trimmed, 10);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

export async function runSearch(ctx: AppContext, args: string[]): Promise<void> {
  const parsed = parseCommandArgs(args, ['--chat', '--limit', '-n', '--tag', '--company']);
  if (parsed.positionals.length === 0) {
    throw new Error(
      'Usage: tgchats search "<query>" [--chat <peer>] [--tag <tag>] [--company <name>] [--limit N]',
    );
  }
  const query = parsed.positionals.join(' ');
  const chatId = optionValue(parsed, ['--chat']);
  const tag = optionValue(parsed, ['--tag']);
  const company = optionValue(parsed, ['--company']);
  const limit = optionValue(parsed, ['--limit', '-n'])
    ? parsePositiveInt(optionValue(parsed, ['--limit', '-n'])!, '--limit')
    : 30;

  const forceLocal = hasFlag(parsed, ['--local']);
  const useLocal = forceLocal || Boolean(tag || company);

  if (useLocal) {
    if (!ctx.db) {
      throw new Error('Local DB search requires DATABASE_URL.');
    }
    const accountId = await requireAccountId(ctx);
    let peerId: number | undefined;
    let peerKind: StoredPeerKind | undefined;
    if (chatId) {
      peerId = numericPeerIdFromRef(chatId);
      if (peerId === undefined) {
        await ensureAuthorized(ctx.telegram);
        const peer = await ctx.telegram.getPeer(normalizePeerRef(chatId));
        peerId = peer.id;
        peerKind = canonicalPeerKind(peer);
      }
    }
    const rows = await searchLocalMessages(ctx.db, {
      accountId,
      query,
      limit,
      peerId,
      peerKind,
      tag,
      company,
    });
    if (rows.length === 0) {
      if (ctx.config.jsonOutput) {
        printJson({ ok: true, source: 'local', count: 0, messages: [] });
        return;
      }
      console.log('No local matches.');
      return;
    }
    if (ctx.config.jsonOutput) {
      printJson({
        ok: true,
        source: 'local',
        count: rows.length,
        messages: rows.map((row) => ({
          peerId: row.peerId,
          displayName: row.displayName ?? null,
          messageId: row.messageId,
          sentAt: row.sentAt.toISOString(),
          text: row.text,
        })),
      });
      return;
    }
    for (const row of rows) {
      console.log(
        `${formatDate(row.sentAt)} | ${row.displayName ?? row.peerId} | #${row.messageId} | ${row.text}`,
      );
    }
    return;
  }

  await ensureAuthorized(ctx.telegram);
  const messages = await searchTelegramMessages(ctx.telegram, {
    query,
    limit,
    chatId: chatId ? normalizePeerRef(chatId) : undefined,
  });
  if (messages.length === 0) {
    if (ctx.config.jsonOutput) {
      printJson({ ok: true, source: 'telegram', count: 0, messages: [] });
      return;
    }
    console.log('No Telegram matches.');
    return;
  }

  if (ctx.config.jsonOutput) {
    printJson({
      ok: true,
      source: 'telegram',
      count: messages.length,
      messages: messages.map((message) => ({
        id: message.id,
        date: message.date.toISOString(),
        chat: {
          id: message.chat.id,
          displayName: message.chat.displayName,
        },
        sender: {
          id: message.sender.id,
          displayName: message.sender.displayName,
          username: message.sender.username ?? null,
        },
        text: message.text.trim() || `[${message.media ? message.media.type : 'service'}]`,
      })),
    });
    return;
  }

  for (const message of messages) {
    const text = message.text.trim() || `[${message.media ? message.media.type : 'service'}]`;
    console.log(
      `${formatDate(message.date)} | ${message.chat.displayName} | ${message.sender.displayName}: ${text}`,
    );
  }
}
