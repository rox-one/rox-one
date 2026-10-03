import { Long } from '@mtcute/node';
import type { AppContext } from '../app/context.js';
import { optionValue, parseCommandArgs } from '../app/cli-args.js';
import { printJson } from '../output.js';
import { ensureAuthorized, normalizePeerRef } from '../services/telegram.js';
import { accountCursorBinding, cursorCodecForContext } from './inventorySupport.js';

function payload(args: string[]): Record<string, unknown> {
  const raw = optionValue(parseCommandArgs(args, ['--payload']), ['--payload']);
  if (!raw) throw new Error('Missing --payload JSON.');
  return JSON.parse(raw) as Record<string, unknown>;
}
function str(value: unknown, field: string, max = 512): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`${field} is invalid.`);
  return value.trim();
}
function size(value: unknown, maximum = 100, fallback = 50) {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || Number(value) < 1 || Number(value) > maximum) throw new Error('pageSize is invalid.');
  return Number(value);
}
function selectedPeers(value: unknown): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 10) throw new Error('Select 1 to 10 peers.');
  const peers = value.map((entry) => str(entry, 'peer', 128));
  if (new Set(peers).size !== peers.length) throw new Error('Duplicate peers are not allowed.');
  return peers;
}
function cursor(ctx: AppContext, name: string, input: Record<string, unknown>, binding: unknown) {
  const codec = cursorCodecForContext(ctx);
  const key = accountCursorBinding(ctx, `${name}:${JSON.stringify(binding)}`);
  return {
    state: input.cursor ? codec.decode<Record<string, any>>(str(input.cursor, 'cursor'), name, key) : {},
    next: (value: Record<string, unknown> | null) => value ? codec.encode(name, key, value) : null,
  };
}
function member(user: { id: number; displayName: string; username: string | null }) {
  return { userId: String(user.id), displayName: user.displayName, username: user.username };
}
export function encodedOffset(value: { date: number; user: Record<string, unknown> } | null | undefined) {
  if (!value) return null;
  return { date: value.date, user: JSON.parse(JSON.stringify(value.user, (_key, entry) => Long.isLong(entry) || typeof entry === 'bigint' ? entry.toString() : entry)) };
}
export function decodedOffset(value: any) {
  if (!value) return undefined;
  const user = { ...value.user };
  if (typeof user.accessHash === 'string') user.accessHash = Long.fromString(user.accessHash);
  return { date: value.date as number, user };
}

export async function runCommunityTool(ctx: AppContext, name: string, args: string[]) {
  const input = payload(args);
  await ensureAuthorized(ctx.telegram);
  if (name === 'attention.list' || name === 'drafts.list') {
    const peers = selectedPeers(input.peers);
    const pageSize = size(input.pageSize, 5, 5);
    const c = cursor(ctx, name, input, { peers, pageSize });
    const start = Number(c.state.index || 0);
    if (!Number.isInteger(start) || start < 0 || start >= peers.length) throw new Error('Invalid cursor.');
    const selected = peers.slice(start, start + pageSize);
    const rows = [];
    for (const peer of selected) {
      const [dialog] = await ctx.telegram.getPeerDialogs(normalizePeerRef(peer));
      if (!dialog) throw new Error(`Telegram dialog ${peer} is unavailable.`);
      if (name === 'attention.list') rows.push({ peer, unreadCount: dialog.unreadCount,
        unreadMentionsCount: dialog.unreadMentionsCount,
        unreadReactionsCount: dialog.unreadReactionsCount,
        isManuallyUnread: dialog.isManuallyUnread });
      else if (dialog.draftMessage) rows.push({ peer, text: dialog.draftMessage.text,
        updatedAt: dialog.draftMessage.date.toISOString() });
    }
    const nextIndex = start + selected.length;
    printJson({ ok: true, peers, hasMore: nextIndex < peers.length,
      nextCursor: c.next(nextIndex < peers.length ? { index: nextIndex } : null),
      [name === 'attention.list' ? 'chats' : 'drafts']: rows });
    return;
  }
  const peer = str(input.peer, 'peer', 128);
  const target = normalizePeerRef(peer);
  if (name === 'draft.save') {
    if (typeof input.text !== 'string' || input.text.length > 4096) throw new Error('text must be at most 4096 characters.');
    await ctx.telegram.saveDraft(target, input.text ? { message: input.text } : null);
    printJson({ ok: true, peer, saved: true, cleared: input.text.length === 0 });
    return;
  }
  if (name === 'person.contextGet') {
    const user = await ctx.telegram.getFullUser(target);
    const common = await ctx.telegram.getCommonChats(target);
    printJson({ ok: true, peer, person: { userId: String(user.id), displayName: user.displayName,
      username: user.username, isContact: user.isContact, isMutualContact: user.isMutualContact,
      commonChatsReported: user.commonChatsCount },
      commonChats: common.slice(0, 20).map((chat) => ({ peer: String(chat.id), title: chat.displayName })) });
    return;
  }
  const pageSize = size(input.pageSize);
  const query = input.query === undefined ? '' : String(input.query).trim();
  if (query.length > 128) throw new Error('query is too long.');
  const link = name === 'inviteLinkMembers.list' ? str(input.link, 'link') : undefined;
  const revoked = input.revoked === true;
  const c = cursor(ctx, name, input, { peer, pageSize, query, link, revoked });
  if (name === 'forumTopics.list') {
    const page = await ctx.telegram.getForumTopics(target, { limit: pageSize, query,
      offset: c.state.offset });
    const topics = page.map((topic) => ({ id: topic.id, title: topic.title,
      isClosed: topic.isClosed, isPinned: topic.isPinned, unreadCount: topic.unreadCount,
      unreadMentionsCount: topic.unreadMentionsCount, unreadReactionsCount: topic.unreadReactionsCount }));
    const next = page.length ? page.next ?? null : null;
    printJson({ ok: true, peer, hasMore: Boolean(next), nextCursor: c.next(next ? { offset: next } : null), topics });
  } else if (name === 'inviteLinks.list') {
    const page = await ctx.telegram.getInviteLinks(target, { limit: pageSize, revoked, offset: c.state.offset });
    const links = page.map((item) => ({ link: item.link, isMyLink: item.isMyLink,
      isPrimary: item.isPrimary, isRevoked: item.isRevoked, createdAt: item.date.toISOString(),
      usage: item.usage, pendingApprovals: item.pendingApprovals, approvalNeeded: item.approvalNeeded }));
    const next = page.length ? page.next ?? null : null;
    printJson({ ok: true, peer, hasMore: Boolean(next), nextCursor: c.next(next ? { offset: next } : null), links });
  } else if (name === 'joinRequests.list' || name === 'inviteLinkMembers.list') {
    const offset = decodedOffset(c.state.offset);
    const page = await ctx.telegram.getInviteLinkMembers(target, { limit: pageSize,
      requested: name === 'joinRequests.list', link,
      offsetDate: offset ? new Date(offset.date * 1000) : undefined, offsetUser: offset?.user });
    const members = page.map((item) => ({ ...member(item.user), joinedAt: item.date.toISOString(),
      isPendingRequest: item.isPendingRequest,
      approvedByUserId: item.approvedBy ? String(item.approvedBy.id) : null }));
    const next = page.length ? encodedOffset(page.next as any) : null;
    printJson({ ok: true, peer, hasMore: Boolean(next), nextCursor: c.next(next ? { offset: next } : null),
      [name === 'joinRequests.list' ? 'requests' : 'members']: members });
  } else if (name === 'chat.adminLog') {
    const maxId = c.state.maxId ? Long.fromString(c.state.maxId) : undefined;
    const events = await ctx.telegram.getChatEventLog(target, { limit: pageSize, maxId });
    const entries = events.map((item) => ({ id: String(item.id), occurredAt: item.date.toISOString(),
      actorUserId: String(item.actor.id), actorDisplayName: item.actor.displayName,
      actionType: item.action?.type ?? "unknown" }));
    const next = entries.length === pageSize ? entries.at(-1)?.id : null;
    printJson({ ok: true, peer, hasMore: Boolean(next), nextCursor: c.next(next ? { maxId: next } : null), events: entries });
  } else throw new Error(`Unsupported community tool: ${name}`);
}
