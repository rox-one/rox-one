import { resolve } from 'node:path';
import type { AppContext } from '../app/context.js';
import { optionValue, parseCommandArgs } from '../app/cli-args.js';
import { printJson } from '../output.js';
import {
  completeAgentWritePreview,
  createAgentWriteRunKey,
  loadAgentWritePreview,
  loadAgentWriteRun,
  saveAgentWritePreview,
  saveAgentWriteRun,
} from '../services/agentWritePreviewStore.js';
import {
  createMediaDownloadReference,
  loadManagedUpload,
  loadMediaDownloadReference,
  stageManagedUpload,
} from '../services/managedMediaStore.js';
import {
  downloadableMediaLocation,
  executeTelegramMessageAction,
  getChatCapabilities,
  getExactMessage,
  getMember,
  getMemberPage,
  getScheduledMessagePage,
  getThreadPage,
  safeMediaInfo,
  safeTelegramMessage,
  sendManagedMedia,
  type TelegramMessageAction,
} from '../services/telegramClientTools.js';
import { pollTelegramUpdates } from '../services/telegramUpdateStore.js';
import { ensureAuthorized } from '../services/telegram.js';
import {
  accountCursorBinding,
  cursorCodecForContext,
  parsePageSize,
} from './inventorySupport.js';

const MAX_TELEGRAM_INT = 2_147_483_647;

function payloadFromArgs(args: string[]) {
  const parsed = parseCommandArgs(args, ['--payload']);
  const payload = optionValue(parsed, ['--payload']);
  if (!payload) throw new Error('Missing --payload JSON.');
  return JSON.parse(payload) as Record<string, unknown>;
}

function requiredString(value: unknown, label: string) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required.`);
  return value.trim();
}

function positiveMessageId(value: unknown) {
  if (!Number.isInteger(value) || Number(value) < 1 || Number(value) > MAX_TELEGRAM_INT) {
    throw new Error('messageId must be an integer in Telegram range.');
  }
  return Number(value);
}

function boundedPageSize(value: unknown, fallback = 50) {
  return parsePageSize(value === undefined ? undefined : String(value), fallback);
}

function parseSchedule(value: unknown) {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return value;
  if (typeof value !== 'string') throw new Error('schedule must be an ISO timestamp or unix time.');
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error('schedule must be a valid ISO timestamp.');
  return date;
}

function safeDownloadFileName(info: ReturnType<typeof safeMediaInfo>, messageId: number) {
  return info?.fileName ?? `telegram-${messageId}.${info?.type === 'photo' ? 'jpg' : 'bin'}`;
}

export async function runMessageClientTools(ctx: AppContext, args: string[]) {
  const sub = args[0];
  if (sub === 'get') {
    const payload = payloadFromArgs(args.slice(1));
    const peer = requiredString(payload.peer, 'peer');
    const messageId = positiveMessageId(payload.messageId);
    await ensureAuthorized(ctx.telegram);
    const message = await getExactMessage(ctx.telegram, peer, messageId);
    printJson({ ok: true, peer, message: safeTelegramMessage(message) });
    return;
  }

  if (sub === 'action-preview') {
    const payload = payloadFromArgs(args.slice(1));
    const actionName = requiredString(payload.action, 'action');
    const peer = requiredString(payload.peer, 'peer');
    const messageId = positiveMessageId(payload.messageId);
    await ensureAuthorized(ctx.telegram);

    let action: TelegramMessageAction;
    if (actionName === 'edit') {
      const text = requiredString(payload.text, 'text');
      if (text.length > 4096) throw new Error('text must be at most 4096 characters.');
      const message = await getExactMessage(ctx.telegram, peer, messageId);
      if (!message.isOutgoing) throw new Error('Only messages sent by the connected account can be edited.');
      action = { action: 'edit', peer, messageId, text };
    } else if (actionName === 'delete') {
      await getExactMessage(ctx.telegram, peer, messageId);
      action = { action: 'delete', peer, messageId, revoke: payload.revoke !== false };
    } else if (actionName === 'forward') {
      const targetPeer = requiredString(payload.targetPeer, 'targetPeer');
      const message = await getExactMessage(ctx.telegram, peer, messageId);
      if (!message.canBeForwarded) throw new Error('Telegram does not allow this message to be forwarded.');
      await ctx.telegram.getPeer(targetPeer);
      action = { action: 'forward', peer, messageId, targetPeer };
    } else if (actionName === 'reaction') {
      const emoji = payload.emoji === null ? null : requiredString(payload.emoji, 'emoji');
      if (emoji && emoji.length > 32) throw new Error('emoji must be at most 32 characters.');
      await getExactMessage(ctx.telegram, peer, messageId);
      action = { action: 'reaction', peer, messageId, emoji };
    } else if (actionName === 'pin') {
      await getExactMessage(ctx.telegram, peer, messageId);
      action = {
        action: 'pin',
        peer,
        messageId,
        notify: payload.notify === true,
        bothSides: payload.bothSides === true,
      };
    } else if (actionName === 'unpin') {
      await getExactMessage(ctx.telegram, peer, messageId);
      action = { action: 'unpin', peer, messageId };
    } else if (actionName === 'markRead') {
      await getExactMessage(ctx.telegram, peer, messageId);
      action = { action: 'markRead', peer, messageId };
    } else if (actionName === 'cancelScheduled') {
      const [message] = await ctx.telegram.getScheduledMessages(peer, [messageId]);
      if (!message) throw new Error('Scheduled Telegram message was not found.');
      action = { action: 'cancelScheduled', peer, messageId };
    } else {
      throw new Error('Unsupported message action.');
    }

    const record = await saveAgentWritePreview(ctx.config, {
      kind: 'message.action',
      payload: action,
      summary: { risk: `${action.action} Telegram message ${messageId} in ${peer}` },
    });
    printJson({
      ok: true,
      preview: {
        previewId: record.previewId,
        action: action.action,
        payloadHash: record.payloadHash,
        createdAt: record.createdAt,
        expiresAt: record.expiresAt,
        summary: String(record.summary.risk),
      },
    });
    return;
  }

  if (sub === 'action-approved') {
    const previewId = requiredString(args[1], 'previewId');
    const parsed = parseCommandArgs(args.slice(2), ['--idempotency-key']);
    const idempotencyKey = requiredString(optionValue(parsed, ['--idempotency-key']), 'idempotencyKey');
    const runKey = createAgentWriteRunKey({ toolName: 'message.actionApproved', previewId, idempotencyKey });
    const replay = await loadAgentWriteRun(ctx.config, runKey);
    if (replay) {
      const { runKeyHash: _runKeyHash, storedAt: _storedAt, ...output } = replay as Record<string, unknown>;
      printJson({ ...output, idempotentReplay: true });
      return;
    }
    const record = await loadAgentWritePreview(ctx.config, previewId, 'message.action');
    await ensureAuthorized(ctx.telegram);
    const result = await executeTelegramMessageAction(
      ctx.telegram,
      record.payload as unknown as TelegramMessageAction,
    );
    await completeAgentWritePreview(ctx.config, record);
    const output = {
      ok: true,
      previewId,
      action: String(record.payload.action),
      completedAt: new Date().toISOString(),
      idempotentReplay: false,
      resultMessageId: result.resultMessageId,
    };
    await saveAgentWriteRun(ctx.config, runKey, output);
    printJson(output);
    return;
  }

  throw new Error('Usage: tgchats message <get|action-preview|action-approved|send-draft> ...');
}

export async function runThread(ctx: AppContext, args: string[]) {
  const payload = payloadFromArgs(args);
  const peer = requiredString(payload.peer, 'peer');
  const messageId = positiveMessageId(payload.messageId);
  const pageSize = boundedPageSize(payload.pageSize);
  const codec = cursorCodecForContext(ctx);
  const binding = accountCursorBinding(ctx, `thread:${peer}:${messageId}`);
  const state = payload.cursor
    ? codec.decode<{ offset: number }>(requiredString(payload.cursor, 'cursor'), 'thread', binding)
    : { offset: 0 };
  await ensureAuthorized(ctx.telegram);
  const page = await getThreadPage(ctx.telegram, {
    peer,
    messageId,
    pageSize,
    ...(state.offset ? { offset: state.offset } : {}),
  });
  printJson({
    ok: true,
    peer,
    rootMessageId: messageId,
    threadKind: page.threadKind,
    hasMore: page.nextOffset !== null,
    nextCursor: page.nextOffset === null ? null : codec.encode('thread', binding, { offset: page.nextOffset }),
    messages: page.messages.map(safeTelegramMessage),
  });
}

export async function runScheduled(ctx: AppContext, args: string[]) {
  const payload = payloadFromArgs(args);
  const peer = requiredString(payload.peer, 'peer');
  const pageSize = boundedPageSize(payload.pageSize);
  const codec = cursorCodecForContext(ctx);
  const binding = accountCursorBinding(ctx, `scheduled:${peer}`);
  const state = payload.cursor
    ? codec.decode<{ offset: number }>(requiredString(payload.cursor, 'cursor'), 'scheduled', binding)
    : { offset: 0 };
  await ensureAuthorized(ctx.telegram);
  const page = await getScheduledMessagePage(ctx.telegram, { peer, pageSize, offset: state.offset });
  printJson({
    ok: true,
    peer,
    hasMore: page.nextOffset !== null,
    nextCursor: page.nextOffset === null ? null : codec.encode('scheduled', binding, { offset: page.nextOffset }),
    messages: page.messages.map(safeTelegramMessage),
  });
}

export async function runMembersList(ctx: AppContext, args: string[]) {
  const payload = payloadFromArgs(args);
  const peer = requiredString(payload.peer, 'peer');
  const pageSize = boundedPageSize(payload.pageSize);
  const filters = ['recent', 'all', 'admins', 'bots', 'contacts', 'restricted', 'banned'] as const;
  const query = payload.query === undefined ? '' : String(payload.query).trim();
  const filter = payload.filter === undefined ? (query ? 'all' : 'recent') : requiredString(payload.filter, 'filter');
  if (!filters.includes(filter as typeof filters[number])) throw new Error('Unsupported member filter.');
  if (query.length > 128) throw new Error('query is too long.');
  if (query && !['all', 'contacts', 'restricted', 'banned'].includes(filter)) {
    throw new Error('query is unsupported with this member filter.');
  }
  const codec = cursorCodecForContext(ctx);
  const binding = accountCursorBinding(ctx, `members:${JSON.stringify({ peer, filter, query: query.toLocaleLowerCase(), pageSize })}`);
  const state = payload.cursor
    ? codec.decode<{ offset: number }>(requiredString(payload.cursor, 'cursor'), 'members', binding)
    : { offset: 0 };
  await ensureAuthorized(ctx.telegram);
  const page = await getMemberPage(ctx.telegram, { peer, pageSize, offset: state.offset,
    filter: filter as typeof filters[number], query });
  printJson({
    ok: true,
    peer,
    chatType: page.chatType, filter, query,
    reportedTotal: page.reportedTotal, returnedCount: page.members.length,
    completeness: page.completeness, visibility: page.visibility, limitReason: page.limitReason,
    hasMore: page.hasMore,
    nextCursor: page.nextOffset === null ? null : codec.encode('members', binding, { offset: page.nextOffset }),
    members: page.members.map((member) => ({
      id: String(member.user.id),
      displayName: member.user.displayName,
      username: member.user.username ?? null,
      status: member.status,
      title: member.title,
    })),
  });
}

export async function runMemberGet(ctx: AppContext, args: string[]) {
  const payload = payloadFromArgs(args);
  const peer = requiredString(payload.peer, 'peer');
  const userId = requiredString(payload.userId, 'userId');
  await ensureAuthorized(ctx.telegram);
  const result = await getMember(ctx.telegram, peer, userId);
  printJson({ ok: true, peer, userId, membership: result.membership, reason: result.reason,
    member: result.member ? { id: String(result.member.user.id), displayName: result.member.user.displayName,
      username: result.member.user.username ?? null, status: result.member.status, title: result.member.title } : null });
}

export async function runChatCapabilitiesGet(ctx: AppContext, args: string[]) {
  const payload = payloadFromArgs(args);
  const peer = requiredString(payload.peer, 'peer');
  await ensureAuthorized(ctx.telegram);
  printJson({ ok: true, peer, ...await getChatCapabilities(ctx.telegram, peer) });
}

export async function runUpdatesPoll(ctx: AppContext, args: string[]) {
  const payload = payloadFromArgs(args);
  const cursor = typeof payload.cursor === 'string' ? payload.cursor : undefined;
  const limit = boundedPageSize(payload.limit);
  await ensureAuthorized(ctx.telegram);
  const result = await pollTelegramUpdates(
    ctx.telegram,
    ctx.config,
    cursorCodecForContext(ctx),
    { cursor, limit },
  );
  printJson({ ok: true, ...result });
}

export async function runMedia(ctx: AppContext, args: string[]) {
  const sub = args[0];
  if (sub === 'stage') {
    const source = requiredString(args[1], 'source path');
    const record = await stageManagedUpload(ctx.config, source);
    printJson({
      ok: true,
      uploadRef: record.uploadRef,
      uploadSha256: record.sha256,
      fileName: record.fileName,
      contentType: record.contentType,
      sizeBytes: record.sizeBytes,
      expiresAt: record.expiresAt,
    });
    return;
  }
  if (sub === 'info' || sub === 'download') {
    const payload = payloadFromArgs(args.slice(1));
    const peer = requiredString(payload.peer, 'peer');
    const messageId = positiveMessageId(payload.messageId);
    await ensureAuthorized(ctx.telegram);
    const message = await getExactMessage(ctx.telegram, peer, messageId);
    const media = safeMediaInfo(message);
    if (sub === 'info') {
      printJson({ ok: true, peer, messageId, media });
      return;
    }
    if (!media || !media.downloadable) {
      throw new Error('The requested media is unavailable, unsupported, or exceeds the local 50 MB limit.');
    }
    const record = await createMediaDownloadReference(ctx.config, {
      peer,
      messageId,
      fileName: safeDownloadFileName(media, messageId),
      contentType: media.mimeType ?? 'application/octet-stream',
      sizeBytes: media.sizeBytes,
    });
    printJson({
      ok: true,
      peer,
      messageId,
      downloadRef: record.downloadRef,
      expiresAt: record.expiresAt,
      media,
    });
    return;
  }
  if (sub === 'redeem') {
    const downloadRef = requiredString(args[1], 'downloadRef');
    const parsed = parseCommandArgs(args.slice(2), ['--out']);
    const output = resolve(requiredString(optionValue(parsed, ['--out']), '--out'));
    const record = await loadMediaDownloadReference(ctx.config, downloadRef);
    await ensureAuthorized(ctx.telegram);
    const message = await getExactMessage(ctx.telegram, record.peer, record.messageId);
    const info = safeMediaInfo(message);
    if (!info || !info.downloadable || info.sizeBytes !== record.sizeBytes) {
      throw new Error('The source media changed or is no longer accessible.');
    }
    await ctx.telegram.downloadToFile(output, downloadableMediaLocation(message));
    printJson({ ok: true, downloadRef, output, fileName: record.fileName });
    return;
  }
  if (sub === 'send-preview') {
    const payload = payloadFromArgs(args.slice(1));
    const peer = requiredString(payload.peer, 'peer');
    const uploadRef = requiredString(payload.uploadRef, 'uploadRef');
    const mediaKind = requiredString(payload.mediaKind, 'mediaKind');
    if (!['file', 'photo', 'voice'].includes(mediaKind)) {
      throw new Error('mediaKind must be file, photo, or voice.');
    }
    const upload = await loadManagedUpload(ctx.config, uploadRef);
    if (payload.uploadSha256 && payload.uploadSha256 !== upload.sha256) {
      throw new Error('uploadSha256 does not match the managed upload object.');
    }
    const caption = typeof payload.caption === 'string' ? payload.caption : undefined;
    if (caption && caption.length > 1024) throw new Error('caption must be at most 1024 characters.');
    await ensureAuthorized(ctx.telegram);
    await ctx.telegram.getPeer(peer);
    const normalizedPayload = {
      peer,
      uploadRef,
      uploadSha256: upload.sha256,
      mediaKind,
      caption: caption ?? null,
      schedule: payload.schedule ?? null,
    };
    const record = await saveAgentWritePreview(ctx.config, {
      kind: 'media.send',
      payload: normalizedPayload,
      summary: { risk: `send ${mediaKind} ${upload.fileName} to ${peer}` },
    });
    printJson({
      ok: true,
      preview: {
        previewId: record.previewId,
        payloadHash: record.payloadHash,
        uploadSha256: upload.sha256,
        createdAt: record.createdAt,
        expiresAt: record.expiresAt,
        summary: String(record.summary.risk),
      },
    });
    return;
  }
  if (sub === 'send-approved') {
    const previewId = requiredString(args[1], 'previewId');
    const parsed = parseCommandArgs(args.slice(2), ['--idempotency-key']);
    const idempotencyKey = requiredString(optionValue(parsed, ['--idempotency-key']), 'idempotencyKey');
    const runKey = createAgentWriteRunKey({ toolName: 'media.sendApproved', previewId, idempotencyKey });
    const replay = await loadAgentWriteRun(ctx.config, runKey);
    if (replay) {
      const { runKeyHash: _runKeyHash, storedAt: _storedAt, ...output } = replay as Record<string, unknown>;
      printJson({ ...output, idempotentReplay: true });
      return;
    }
    const record = await loadAgentWritePreview(ctx.config, previewId, 'media.send');
    const upload = await loadManagedUpload(ctx.config, requiredString(record.payload.uploadRef, 'uploadRef'));
    if (upload.sha256 !== record.payload.uploadSha256) {
      throw new Error('Managed upload object does not match the approved preview.');
    }
    await ensureAuthorized(ctx.telegram);
    const message = await sendManagedMedia(ctx.telegram, {
      peer: requiredString(record.payload.peer, 'peer'),
      storedPath: upload.storedPath,
      mediaKind: requiredString(record.payload.mediaKind, 'mediaKind') as 'file' | 'photo' | 'voice',
      ...(typeof record.payload.caption === 'string' ? { caption: record.payload.caption } : {}),
      ...(record.payload.schedule ? { schedule: parseSchedule(record.payload.schedule) } : {}),
    });
    await completeAgentWritePreview(ctx.config, record);
    const output = {
      ok: true,
      previewId,
      messageId: message.id,
      completedAt: new Date().toISOString(),
      idempotentReplay: false,
    };
    await saveAgentWriteRun(ctx.config, runKey, output);
    printJson(output);
    return;
  }
  throw new Error('Usage: tgchats media <stage|info|download|redeem|send-preview|send-approved> ...');
}
