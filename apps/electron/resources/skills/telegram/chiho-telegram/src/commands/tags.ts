import type { AppContext } from '../app/context.js';
import { parseCommandArgs, optionValue, parsePositiveInt, hasFlag } from '../app/cli-args.js';
import {
  buildAiConversation,
  ensureAuthorized,
  fetchChatHistory,
  normalizePeerRef,
} from '../services/telegram.js';
import { requireAccountId } from '../app/account.js';
import { requireDb } from '../app/db.js';
import { clearPeerTags, listPeerTags, setPeerTags } from '../db/crm.js';
import { upsertPeer } from '../db/writes.js';
import { canonicalPeerKind } from '../db/peerIdentity.js';
import { printJson } from '../output.js';

export function parseTagsSetArgs(args: string[]): { peer: string; tags: string[] } {
  const parsed = parseCommandArgs(args);
  const [peer, ...tags] = parsed.positionals;
  if (!peer || tags.length === 0) {
    throw new Error('Usage: tgchats tags set <peer> <tag...>');
  }

  return { peer, tags };
}

export async function runTags(ctx: AppContext, args: string[]): Promise<void> {
  const db = requireDb(ctx);
  const accountId = await requireAccountId(ctx);

  const sub = args[0];
  if (!sub) {
    throw new Error('Usage: tgchats tags <set|clear|ls|suggest> ...');
  }

  if (sub === 'set') {
    const { peer: peerInput, tags } = parseTagsSetArgs(args.slice(1));

    await ensureAuthorized(ctx.telegram);
    const peer = await ctx.telegram.getPeer(normalizePeerRef(peerInput));
    await upsertPeer(db, { accountId, peer });
    await setPeerTags(db, {
      accountId,
      peerId: peer.id,
      peerKind: canonicalPeerKind(peer),
      tags,
      source: 'manual',
    });
    if (ctx.config.jsonOutput) {
      printJson({
        ok: true,
        peer: {
          id: peer.id,
          displayName: peer.displayName,
        },
        tags,
        source: 'manual',
      });
      return;
    }
    console.log(`Tags set for ${peer.displayName}: ${tags.join(', ')}`);
    return;
  }

  if (sub === 'clear') {
    const peerInput = args[1];
    if (!peerInput) {
      throw new Error('Usage: tgchats tags clear <peer>');
    }

    await ensureAuthorized(ctx.telegram);
    const peer = await ctx.telegram.getPeer(normalizePeerRef(peerInput));
    const removed = await clearPeerTags(db, {
      accountId,
      peerId: peer.id,
      peerKind: canonicalPeerKind(peer),
    });
    if (ctx.config.jsonOutput) {
      printJson({
        ok: true,
        peer: {
          id: peer.id,
          displayName: peer.displayName,
        },
        removed,
      });
      return;
    }
    console.log(`Cleared ${removed} tag${removed === 1 ? '' : 's'} for ${peer.displayName}.`);
    return;
  }

  if (sub === 'suggest') {
    if (!ctx.ai) {
      throw new Error(
        'AI mode is not configured. Set AI_MODE=gemini with GEMINI_API_KEY or AI_MODE=openclaw with OPENCLAW_BASE_URL.',
      );
    }

    const parsed = parseCommandArgs(args.slice(1), ['--limit']);
    const peerInput = parsed.positionals[0];
    if (!peerInput) {
      throw new Error('Usage: tgchats tags suggest <peer> [--limit N] [--apply]');
    }
    const limit = optionValue(parsed, ['--limit'])
      ? parsePositiveInt(optionValue(parsed, ['--limit'])!, '--limit')
      : 50;
    const apply = hasFlag(parsed, ['--apply']);

    await ensureAuthorized(ctx.telegram);
    const peer = await ctx.telegram.getPeer(normalizePeerRef(peerInput));
    const history = await fetchChatHistory(ctx.telegram, {
      chatId: String(peer.id),
      limit,
    });
    const suggestion = await ctx.ai.suggestTags({
      peerDisplayName: peer.displayName,
      messages: buildAiConversation(history),
    });
    if (suggestion.tags.length === 0) {
      if (ctx.config.jsonOutput) {
        printJson({
          ok: true,
          peer: { id: peer.id, displayName: peer.displayName },
          suggestedTags: [],
          applied: false,
        });
        return;
      }
      console.log('AI did not suggest tags.');
      return;
    }

    if (ctx.config.jsonOutput && !apply) {
      printJson({
        ok: true,
        peer: { id: peer.id, displayName: peer.displayName },
        suggestedTags: suggestion.tags,
        applied: false,
      });
      return;
    }

    console.log(`Suggested tags for ${peer.displayName}: ${suggestion.tags.join(', ')}`);
    if (apply) {
      await upsertPeer(db, { accountId, peer });
      await setPeerTags(db, {
        accountId,
        peerId: peer.id,
        peerKind: canonicalPeerKind(peer),
        tags: suggestion.tags,
        source: 'ai',
      });
      if (ctx.config.jsonOutput) {
        printJson({
          ok: true,
          peer: { id: peer.id, displayName: peer.displayName },
          suggestedTags: suggestion.tags,
          applied: true,
        });
        return;
      }
      console.log('Applied suggested tags.');
    } else {
      console.log('Use --apply to persist suggestions.');
    }
    return;
  }

  if (sub === 'ls') {
    const parsed = parseCommandArgs(args.slice(1), ['--peer']);
    const peerInput = optionValue(parsed, ['--peer']);
    let peerId: number | undefined;
    let peerKind: ReturnType<typeof canonicalPeerKind> | undefined;
    if (peerInput) {
      await ensureAuthorized(ctx.telegram);
      const peer = await ctx.telegram.getPeer(normalizePeerRef(peerInput));
      peerId = peer.id;
      peerKind = canonicalPeerKind(peer);
    }

    const rows = await listPeerTags(db, { accountId, peerId, peerKind });
    if (rows.length === 0) {
      if (ctx.config.jsonOutput) {
        printJson({ ok: true, count: 0, tags: [] });
        return;
      }
      console.log('No tags found.');
      return;
    }
    if (ctx.config.jsonOutput) {
      printJson({ ok: true, count: rows.length, tags: rows });
      return;
    }
    for (const row of rows) {
      console.log(`${row.peerId} | ${row.tag} | ${row.source}`);
    }
    return;
  }

  throw new Error(`Unknown tags subcommand: ${sub}`);
}
