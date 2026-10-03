import type { AppContext } from '../app/context.js';
import { parseCommandArgs, optionValue } from '../app/cli-args.js';
import {
  ensureAuthorized,
  normalizePeerRef,
} from '../services/telegram.js';
import {
  createAgentWriteRunKey,
  createPayloadHash,
  loadAgentWriteRun,
  loadAgentWritePreview,
  saveAgentWriteRun,
  saveAgentWritePreview,
} from '../services/agentWritePreviewStore.js';
import { printJson } from '../output.js';

const MAX_BATCH_TARGETS = 20;

function payloadFromArgs(args: string[]) {
  const parsed = parseCommandArgs(args, ['--payload']);
  const payload = optionValue(parsed, ['--payload']);
  if (!payload) {
    throw new Error('Missing --payload JSON.');
  }
  return JSON.parse(payload) as Record<string, unknown>;
}

function stringValue(value: unknown, label: string) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} is required.`);
  }
  return value.trim();
}

function optionalString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function stringArray(value: unknown, label: string, maxItems = MAX_BATCH_TARGETS) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${label} is required.`);
  }
  if (value.length > maxItems) {
    throw new Error(`${label} supports at most ${maxItems} entries.`);
  }
  return value.map((item) => stringValue(item, label));
}

function peerArray(value: unknown, label: string, maxItems = MAX_BATCH_TARGETS) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${label} is required.`);
  }
  if (value.length > maxItems) {
    throw new Error(`${label} supports at most ${maxItems} entries.`);
  }
  return value.map(peerInput);
}

function parseSchedule(value: unknown) {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value !== 'string') {
    throw new Error('schedule must be a string or number.');
  }
  if (value === 'online') {
    return 'online' as const;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error('schedule must be an ISO timestamp, unix time, or online.');
  }
  return parsed;
}

function textFromOutboxPayload(payload: Record<string, unknown>) {
  const text = optionalString(payload.text);
  if (text) {
    return text;
  }
  const template = payload.template;
  if (template && typeof template === 'object') {
    return stringValue((template as { text?: unknown }).text, 'template.text');
  }
  throw new Error('outbox.preview requires message text or template.text.');
}

function peerInput(value: unknown) {
  if (typeof value === 'string') {
    return value;
  }
  if (value && typeof value === 'object') {
    const candidate = value as Record<string, unknown>;
    return stringValue(candidate.id ?? candidate.peerId ?? candidate.groupId, 'peer');
  }
  throw new Error('peer is required.');
}

function telegramRpcCode(error: unknown) {
  const explicit = (error as { errorMessage?: unknown; code?: unknown })?.errorMessage ??
    (error as { code?: unknown })?.code;
  if (explicit) {
    return String(explicit);
  }
  const message = error instanceof Error ? error.message : String(error);
  return message.match(/\b([A-Z][A-Z0-9_]{2,})\b/)?.[1];
}

async function summarizePeers(ctx: AppContext, peers: string[]) {
  await ensureAuthorized(ctx.telegram);
  const summaries = [];
  for (const peer of peers) {
    const resolved = await ctx.telegram.getPeer(normalizePeerRef(peer));
    summaries.push({
      peer,
      id: String(resolved.id),
      type: resolved.type,
      displayName: resolved.displayName,
      username: resolved.username ?? null,
    });
  }
  return summaries;
}

async function sendInviteLinkFallback(
  ctx: AppContext,
  input: { group: string; userId: string; reason: string },
) {
  const inviteLink = await ctx.telegram.exportInviteLink(normalizePeerRef(input.group));
  await ctx.telegram.sendText(
    normalizePeerRef(input.userId),
    `You've been invited to join this Telegram group: ${inviteLink.link}`,
  );
  return {
    group: input.group,
    ok: true,
    missingInviteesCount: 1,
    sentInviteLink: true,
    message: input.reason,
  };
}

export async function runOutbox(ctx: AppContext, args: string[]) {
  const sub = args[0];
  if (sub === 'preview') {
    const payload = payloadFromArgs(args.slice(1));
    const peers = stringArray(payload.peers, 'peers');
    const text = textFromOutboxPayload(payload);
    const recipients = await summarizePeers(ctx, peers);
    const record = await saveAgentWritePreview(ctx.config, {
      kind: 'outbox',
      payload: {
        peers,
        text,
        schedule: payload.schedule ?? null,
        templateId: payload.templateId ?? (payload.template as { id?: unknown } | undefined)?.id ?? null,
      },
      summary: {
        recipientCount: recipients.length,
        recipients,
        textPreview: text.length > 160 ? `${text.slice(0, 157)}...` : text,
        schedule: payload.schedule ?? null,
      },
    });
    printJson({ ok: true, preview: record });
    return;
  }

  if (sub === 'send-approved') {
    const previewId = stringValue(args[1], 'previewId');
    const parsed = parseCommandArgs(args.slice(2), ['--idempotency-key']);
    const idempotencyKey = optionValue(parsed, ['--idempotency-key']);
    const runKey = createAgentWriteRunKey({
      toolName: 'outbox.sendApproved',
      previewId,
      idempotencyKey,
    });
    const existingRun = await loadAgentWriteRun(ctx.config, runKey);
    if (existingRun) {
      printJson({ ...existingRun, idempotentReplay: true });
      return;
    }
    const record = await loadAgentWritePreview(ctx.config, previewId, 'outbox');
    const peers = stringArray(record.payload.peers, 'peers');
    const text = stringValue(record.payload.text, 'text');
    const schedule = parseSchedule(record.payload.schedule);
    await ensureAuthorized(ctx.telegram);

    const results = [];
    for (const peer of peers) {
      try {
        const message = await ctx.telegram.sendText(normalizePeerRef(peer), text, {
          ...(schedule ? { schedule } : {}),
        });
        results.push({ peer, ok: true, messageId: message.id });
      } catch (error) {
        results.push({
          peer,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    const output = {
      ok: results.every((result) => result.ok),
      previewId,
      count: results.length,
      results,
    };
    await saveAgentWriteRun(ctx.config, runKey, output);
    printJson(output);
    return;
  }

  throw new Error('Usage: tgchats outbox <preview|send-approved> ...');
}

export async function runMessage(ctx: AppContext, args: string[]) {
  const sub = args[0];
  if (sub !== 'send-draft') {
    throw new Error('Usage: tgchats message send-draft --payload JSON');
  }
  const payload = payloadFromArgs(args.slice(1));
  const peer = stringValue(payload.peer, 'peer');
  const text = stringValue(payload.text, 'text');
  const schedule = parseSchedule(payload.schedule);
  const clientProvidedDraftId = optionalString(payload.clientProvidedDraftId);
  const runKey = createAgentWriteRunKey({
    toolName: 'message.sendDraft',
    previewId: clientProvidedDraftId ?? createPayloadHash({ peer, text, schedule: payload.schedule ?? null }),
    idempotencyKey: clientProvidedDraftId ?? 'payload',
  });
  const existingRun = await loadAgentWriteRun(ctx.config, runKey);
  if (existingRun) {
    printJson({ ...existingRun, idempotentReplay: true });
    return;
  }
  await ensureAuthorized(ctx.telegram);
  const message = await ctx.telegram.sendText(normalizePeerRef(peer), text, {
    ...(schedule ? { schedule } : {}),
  });
  const output = {
    ok: true,
    peer,
    messageId: message.id,
    clientProvidedDraftId: clientProvidedDraftId ?? null,
  };
  await saveAgentWriteRun(ctx.config, runKey, output);
  printJson(output);
}

export async function runMembers(ctx: AppContext, args: string[]) {
  const sub = args[0];
  if (sub === 'invite-preview') {
    const payload = payloadFromArgs(args.slice(1));
    const userId = stringValue(payload.userId, 'userId');
    const groups = peerArray(payload.groups, 'groups');
    const groupSummaries = await summarizePeers(ctx, groups);
    const record = await saveAgentWritePreview(ctx.config, {
      kind: 'members.invite',
      payload: { userId, userAccessHash: payload.userAccessHash ?? null, groups },
      summary: { userId, groupCount: groups.length, groups: groupSummaries },
    });
    printJson({ ok: true, preview: record });
    return;
  }

  if (sub === 'invite-approved') {
    const previewId = stringValue(args[1], 'previewId');
    const parsed = parseCommandArgs(args.slice(2), ['--idempotency-key']);
    const idempotencyKey = optionValue(parsed, ['--idempotency-key']);
    const runKey = createAgentWriteRunKey({
      toolName: 'members.inviteApproved',
      previewId,
      idempotencyKey,
    });
    const existingRun = await loadAgentWriteRun(ctx.config, runKey);
    if (existingRun) {
      printJson({ ...existingRun, idempotentReplay: true });
      return;
    }
    const record = await loadAgentWritePreview(ctx.config, previewId, 'members.invite');
    const userId = stringValue(record.payload.userId, 'userId');
    const groups = stringArray(record.payload.groups, 'groups');
    await ensureAuthorized(ctx.telegram);
    const results = [];
    for (const group of groups) {
      try {
        const missingInvitees = await ctx.telegram.addChatMembers(
          normalizePeerRef(group),
          [normalizePeerRef(userId)],
          { forwardCount: 100 },
        );
        if (missingInvitees.length > 0) {
          results.push(
            await sendInviteLinkFallback(ctx, {
              group,
              userId,
              reason: 'Sent invite link because Telegram privacy settings prevented direct add.',
            }),
          );
          continue;
        }
        results.push({
          group,
          ok: true,
          missingInviteesCount: 0,
          sentInviteLink: false,
        });
      } catch (error) {
        const rpcCode = telegramRpcCode(error);
        if (rpcCode === 'CHAT_ADMIN_REQUIRED' || rpcCode === 'CHAT_WRITE_FORBIDDEN') {
          try {
            results.push(
              await sendInviteLinkFallback(ctx, {
                group,
                userId,
                reason: 'Sent invite link because direct add requires additional group permissions.',
              }),
            );
            continue;
          } catch (fallbackError) {
            results.push({
              group,
              ok: false,
              error: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
              directAddError: error instanceof Error ? error.message : String(error),
            });
            continue;
          }
        }
        results.push({
          group,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    const output = { ok: results.every((result) => result.ok), previewId, userId, results };
    await saveAgentWriteRun(ctx.config, runKey, output);
    printJson(output);
    return;
  }

  throw new Error('Usage: tgchats members <invite-preview|invite-approved> ...');
}

export async function runGroups(ctx: AppContext, args: string[]) {
  const sub = args[0];
  if (sub === 'leave-preview') {
    const payload = payloadFromArgs(args.slice(1));
    const groups = peerArray(payload.groups, 'groups');
    const groupSummaries = await summarizePeers(ctx, groups);
    const record = await saveAgentWritePreview(ctx.config, {
      kind: 'groups.leave',
      payload: { groups, clear: Boolean(payload.clear) },
      summary: { groupCount: groups.length, groups: groupSummaries, clear: Boolean(payload.clear) },
    });
    printJson({ ok: true, preview: record });
    return;
  }

  if (sub === 'leave-approved') {
    const previewId = stringValue(args[1], 'previewId');
    const parsed = parseCommandArgs(args.slice(2), ['--idempotency-key']);
    const idempotencyKey = optionValue(parsed, ['--idempotency-key']);
    const runKey = createAgentWriteRunKey({
      toolName: 'groups.leaveApproved',
      previewId,
      idempotencyKey,
    });
    const existingRun = await loadAgentWriteRun(ctx.config, runKey);
    if (existingRun) {
      printJson({ ...existingRun, idempotentReplay: true });
      return;
    }
    const record = await loadAgentWritePreview(ctx.config, previewId, 'groups.leave');
    const groups = stringArray(record.payload.groups, 'groups');
    const clear = Boolean(record.payload.clear);
    await ensureAuthorized(ctx.telegram);
    const results = [];
    for (const group of groups) {
      try {
        await ctx.telegram.leaveChat(normalizePeerRef(group), { clear });
        results.push({ group, ok: true });
      } catch (error) {
        results.push({
          group,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    const output = { ok: results.every((result) => result.ok), previewId, results };
    await saveAgentWriteRun(ctx.config, runKey, output);
    printJson(output);
    return;
  }

  throw new Error('Usage: tgchats groups <leave-preview|leave-approved> ...');
}
