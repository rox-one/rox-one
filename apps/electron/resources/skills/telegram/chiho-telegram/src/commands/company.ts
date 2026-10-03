import type { AppContext } from '../app/context.js';
import { hasFlag, parseCommandArgs, optionValue, parsePositiveInt } from '../app/cli-args.js';
import {
  buildAiConversation,
  ensureAuthorized,
  fetchChatHistory,
  normalizePeerRef,
} from '../services/telegram.js';
import { requireDb } from '../app/db.js';
import { requireAccountId } from '../app/account.js';
import { getPeerCompany, linkPeerCompany, unlinkPeerCompany } from '../db/crm.js';
import { upsertPeer } from '../db/writes.js';
import { canonicalPeerKind } from '../db/peerIdentity.js';
import { printJson } from '../output.js';

export async function runCompany(ctx: AppContext, args: string[]): Promise<void> {
  const db = requireDb(ctx);
  const accountId = await requireAccountId(ctx);

  const sub = args[0];
  if (!sub) {
    throw new Error('Usage: tgchats company <link|unlink|show|suggest> ...');
  }

  if (sub === 'link') {
    const parsed = parseCommandArgs(args.slice(1), ['--company', '--role']);
    const peerInput = parsed.positionals[0];
    const companyName = optionValue(parsed, ['--company']);
    const role = optionValue(parsed, ['--role']);
    if (!peerInput || !companyName) {
      throw new Error(
        'Usage: tgchats company link <peer> --company "Acme" [--role "BD"]',
      );
    }

    await ensureAuthorized(ctx.telegram);
    const peer = await ctx.telegram.getPeer(normalizePeerRef(peerInput));
    await upsertPeer(db, { accountId, peer });

    await linkPeerCompany(db, {
      accountId,
      peerId: peer.id,
      peerKind: canonicalPeerKind(peer),
      companyName,
      role,
      source: 'manual',
    });
    if (ctx.config.jsonOutput) {
      printJson({
        ok: true,
        peer: { id: peer.id, displayName: peer.displayName },
        company: { companyName, role: role ?? null },
        source: 'manual',
      });
      return;
    }
    console.log(
      `Linked ${peer.displayName} to ${companyName}${role ? ` (${role})` : ''}.`,
    );
    return;
  }

  if (sub === 'unlink') {
    const peerInput = args[1];
    if (!peerInput) {
      throw new Error('Usage: tgchats company unlink <peer>');
    }

    await ensureAuthorized(ctx.telegram);
    const peer = await ctx.telegram.getPeer(normalizePeerRef(peerInput));
    const unlinked = await unlinkPeerCompany(db, {
      accountId,
      peerId: peer.id,
      peerKind: canonicalPeerKind(peer),
    });
    if (ctx.config.jsonOutput) {
      printJson({
        ok: true,
        peer: { id: peer.id, displayName: peer.displayName },
        unlinked,
      });
      return;
    }
    console.log(
      unlinked
        ? `Unlinked company for ${peer.displayName}.`
        : `No company linked for ${peer.displayName}.`,
    );
    return;
  }

  if (sub === 'show') {
    const peerInput = args[1];
    if (!peerInput) {
      throw new Error('Usage: tgchats company show <peer>');
    }

    await ensureAuthorized(ctx.telegram);
    const peer = await ctx.telegram.getPeer(normalizePeerRef(peerInput));
    const company = await getPeerCompany(db, {
      accountId,
      peerId: peer.id,
      peerKind: canonicalPeerKind(peer),
    });
    if (!company) {
      if (ctx.config.jsonOutput) {
        printJson({
          ok: true,
          peer: { id: peer.id, displayName: peer.displayName },
          company: null,
        });
        return;
      }
      console.log('No company linked.');
      return;
    }
    if (ctx.config.jsonOutput) {
      printJson({
        ok: true,
        peer: { id: peer.id, displayName: peer.displayName },
        company: { companyName: company.companyName, role: company.role },
      });
      return;
    }
    console.log(
      `${peer.displayName}: ${company.companyName}${company.role ? ` (${company.role})` : ''}`,
    );
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
      throw new Error('Usage: tgchats company suggest <peer> [--limit N] [--apply]');
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
    const suggestion = await ctx.ai.suggestCompany({
      peerDisplayName: peer.displayName,
      messages: buildAiConversation(history),
    });

    if (!suggestion.companyName) {
      if (ctx.config.jsonOutput) {
        printJson({
          ok: true,
          peer: { id: peer.id, displayName: peer.displayName },
          suggestion: null,
          applied: false,
        });
        return;
      }
      console.log('AI could not infer a company.');
      return;
    }

    const roleLabel = suggestion.role ? ` (${suggestion.role})` : '';
    if (ctx.config.jsonOutput && !apply) {
      printJson({
        ok: true,
        peer: { id: peer.id, displayName: peer.displayName },
        suggestion: {
          companyName: suggestion.companyName,
          role: suggestion.role,
        },
        applied: false,
      });
      return;
    }

    console.log(`Suggested company for ${peer.displayName}: ${suggestion.companyName}${roleLabel}`);

    if (apply) {
      const existing = await getPeerCompany(db, {
        accountId,
        peerId: peer.id,
        peerKind: canonicalPeerKind(peer),
      });
      if (existing) {
        if (ctx.config.jsonOutput) {
          printJson({
            ok: true,
            peer: { id: peer.id, displayName: peer.displayName },
            suggestion: {
              companyName: suggestion.companyName,
              role: suggestion.role,
            },
            applied: false,
            reason: 'existing_company',
            existing: {
              companyName: existing.companyName,
              role: existing.role,
            },
          });
          return;
        }
        console.log(
          `Existing company already linked (${existing.companyName}${existing.role ? ` (${existing.role})` : ''}); skipped apply.`,
        );
        return;
      }

      await upsertPeer(db, { accountId, peer });
      await linkPeerCompany(db, {
        accountId,
        peerId: peer.id,
        peerKind: canonicalPeerKind(peer),
        companyName: suggestion.companyName,
        role: suggestion.role ?? undefined,
        source: 'ai',
      });
      if (ctx.config.jsonOutput) {
        printJson({
          ok: true,
          peer: { id: peer.id, displayName: peer.displayName },
          suggestion: {
            companyName: suggestion.companyName,
            role: suggestion.role,
          },
          applied: true,
        });
        return;
      }
      console.log('Applied company suggestion.');
    } else {
      console.log('Use --apply to persist suggestion.');
    }
    return;
  }

  throw new Error(`Unknown company subcommand: ${sub}`);
}
