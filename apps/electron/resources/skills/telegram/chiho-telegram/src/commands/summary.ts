import type { AppContext } from '../app/context.js';
import { hasFlag, parseCommandArgs, parsePositiveInt } from '../app/cli-args.js';
import { requireDb } from '../app/db.js';
import { requireAccountId } from '../app/account.js';
import {
  buildAiConversation,
  ensureAuthorized,
  fetchChatHistory,
  listDialogs,
  normalizePeerRef,
} from '../services/telegram.js';
import { getSummary, upsertSummary } from '../db/crm.js';
import { upsertPeer } from '../db/writes.js';
import {
  canonicalPeerKind,
  type StoredPeerKind,
} from '../db/peerIdentity.js';
import { printJson } from '../output.js';

async function upsertBothSummaries(
  ctx: AppContext,
  accountId: bigint,
  peerId: number,
  peerKind: StoredPeerKind,
  peerDisplayName: string,
  messages: Awaited<ReturnType<typeof fetchChatHistory>>,
): Promise<void> {
  if (!ctx.ai) {
    throw new Error(
      'AI mode is not configured. Set AI_MODE=gemini with GEMINI_API_KEY or AI_MODE=openclaw with OPENCLAW_BASE_URL.',
    );
  }

  const aiSource = `${ctx.ai.mode}:${ctx.ai.model}`;
  const rolling = await ctx.ai.summarize({
    peerDisplayName,
    messages: buildAiConversation(messages),
  });
  await upsertSummary(requireDb(ctx), {
    accountId,
    peerId,
    peerKind,
    kind: 'rolling',
    content: rolling.summary,
    sourceModel: aiSource,
  });

  const deltaWindow = messages.slice(0, Math.min(messages.length, 20));
  const sinceLastSeen = await ctx.ai.summarizeSinceLastSeen({
    peerDisplayName,
    messages: buildAiConversation(deltaWindow),
  });
  await upsertSummary(requireDb(ctx), {
    accountId,
    peerId,
    peerKind,
    kind: 'since_last_seen',
    content: sinceLastSeen.summary,
    sourceModel: aiSource,
  });
}

async function refreshPeerSummary(
  ctx: AppContext,
  accountId: bigint,
  peerInput: string,
  limit: number,
): Promise<void> {
  if (!ctx.ai) {
    throw new Error(
      'AI mode is not configured. Set AI_MODE=gemini with GEMINI_API_KEY or AI_MODE=openclaw with OPENCLAW_BASE_URL.',
    );
  }

  const peer = await ctx.telegram.getPeer(normalizePeerRef(peerInput));
  const messages = await fetchChatHistory(ctx.telegram, {
    chatId: String(peer.id),
    limit,
  });

  await upsertPeer(requireDb(ctx), { accountId, peer });
  const peerKind = canonicalPeerKind(peer);
  await upsertBothSummaries(
    ctx,
    accountId,
    peer.id,
    peerKind,
    peer.displayName,
    messages,
  );
  if (ctx.config.jsonOutput) {
    const rolling = await getSummary(requireDb(ctx), {
      accountId,
      peerId: peer.id,
      peerKind,
      kind: 'rolling',
    });
    const sinceLastSeen = await getSummary(requireDb(ctx), {
      accountId,
      peerId: peer.id,
      peerKind,
      kind: 'since_last_seen',
    });
    printJson({
      ok: true,
      peer: { id: peer.id, displayName: peer.displayName },
      summaries: {
        rolling: rolling
          ? { content: rolling.content, updatedAt: rolling.updatedAt.toISOString() }
          : null,
        sinceLastSeen: sinceLastSeen
          ? { content: sinceLastSeen.content, updatedAt: sinceLastSeen.updatedAt.toISOString() }
          : null,
      },
      refreshed: true,
    });
    return;
  }
  console.log(`Summary refreshed for ${peer.displayName}.`);
}

function numericPeerIdFromRef(value: string): number | undefined {
  const trimmed = value.trim();
  if (!/^-?\d+$/.test(trimmed)) return undefined;
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

async function resolveSummaryPeer(
  ctx: AppContext,
  peerInput: string,
): Promise<{ id: number; displayName: string; peerKind?: StoredPeerKind }> {
  const numericPeerId = numericPeerIdFromRef(peerInput);
  if (numericPeerId !== undefined) {
    return { id: numericPeerId, displayName: String(numericPeerId) };
  }

  await ensureAuthorized(ctx.telegram);
  const peer = await ctx.telegram.getPeer(normalizePeerRef(peerInput));
  return {
    id: peer.id,
    displayName: peer.displayName,
    peerKind: canonicalPeerKind(peer),
  };
}

export async function runSummary(ctx: AppContext, args: string[]): Promise<void> {
  const sub = args[0];
  if (!sub) {
    throw new Error('Usage: tgchats summary <show|refresh> ...');
  }

  if (sub !== 'show' && !ctx.ai) {
    throw new Error(
      'AI mode is not configured. Set AI_MODE=gemini with GEMINI_API_KEY or AI_MODE=openclaw with OPENCLAW_BASE_URL.',
    );
  }

  const db = requireDb(ctx);
  const accountId = await requireAccountId(ctx);

  if (sub === 'show') {
    const parsed = parseCommandArgs(args.slice(1), ['--kind']);
    const peerInput = parsed.positionals[0];
    if (!peerInput) {
      throw new Error('Usage: tgchats summary show <peer> [--kind rolling|since_last_seen]');
    }
    const kindRaw = parsed.values.get('--kind');
    const kind =
      kindRaw && (kindRaw === 'rolling' || kindRaw === 'since_last_seen')
        ? kindRaw
        : 'rolling';
    if (kindRaw && kindRaw !== 'rolling' && kindRaw !== 'since_last_seen') {
      throw new Error('--kind must be rolling|since_last_seen');
    }

    const peer = await resolveSummaryPeer(ctx, peerInput);
    const summary = await getSummary(db, {
      accountId,
      peerId: peer.id,
      peerKind: peer.peerKind,
      kind,
    });
    if (!summary) {
      if (ctx.config.jsonOutput) {
        printJson({
          ok: true,
          peer: { id: peer.id, displayName: peer.displayName },
          kind,
          summary: null,
        });
        return;
      }
      console.log('No summary yet. Run `tgchats summary refresh <peer>` first.');
      return;
    }
    if (ctx.config.jsonOutput) {
      printJson({
        ok: true,
        peer: { id: peer.id, displayName: peer.displayName },
        kind,
        summary: {
          content: summary.content,
          updatedAt: summary.updatedAt.toISOString(),
        },
      });
      return;
    }
    console.log(`${peer.displayName} [${kind}]: ${summary.content}`);
    console.log(`Updated: ${summary.updatedAt.toISOString()}`);
    return;
  }

  if (sub === 'refresh') {
    await ensureAuthorized(ctx.telegram);
    const parsed = parseCommandArgs(args.slice(1), ['--limit']);
    const limit = parsed.values.get('--limit')
      ? parsePositiveInt(parsed.values.get('--limit')!, '--limit')
      : 50;

    if (hasFlag(parsed, ['--all'])) {
      const dialogs = await listDialogs(ctx.telegram, { all: true, limit: 0 });
      const refreshed: Array<{ peerId: number; displayName: string }> = [];
      for (const dialog of dialogs) {
        const messages = await fetchChatHistory(ctx.telegram, {
          chatId: String(dialog.peer.id),
          limit,
        });
        await upsertPeer(db, { accountId, peer: dialog.peer });
        await upsertBothSummaries(
          ctx,
          accountId,
          dialog.peer.id,
          canonicalPeerKind(dialog.peer),
          dialog.peer.displayName,
          messages,
        );
        refreshed.push({ peerId: dialog.peer.id, displayName: dialog.peer.displayName });
        if (!ctx.config.jsonOutput) {
          console.log(`Refreshed ${dialog.peer.displayName}`);
        }
      }
      if (ctx.config.jsonOutput) {
        printJson({ ok: true, refreshedCount: refreshed.length, peers: refreshed });
      }
      return;
    }

    const peerInput = parsed.positionals[0];
    if (!peerInput) {
      throw new Error('Usage: tgchats summary refresh <peer> [--limit N] or --all');
    }
    await refreshPeerSummary(ctx, accountId, peerInput, limit);
    return;
  }

  throw new Error(`Unknown summary subcommand: ${sub}`);
}
