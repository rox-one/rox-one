import type { AppContext } from '../app/context.js';
import { ensureAuthorized, normalizePeerRef } from '../services/telegram.js';
import { requireAccountId } from '../app/account.js';
import { getPeerCompany, getSummary, listPeerTags, listTasksForPeer } from '../db/crm.js';
import { printJson } from '../output.js';
import { canonicalPeerKind } from '../db/peerIdentity.js';

export async function runOpen(ctx: AppContext, args: string[]): Promise<void> {
  const peerArg = args[0];
  if (!peerArg) {
    throw new Error('Usage: tgchats open <peer>');
  }

  await ensureAuthorized(ctx.telegram);
  const peer = await ctx.telegram.getPeer(normalizePeerRef(peerArg));

  if (!ctx.db) {
    if (ctx.config.jsonOutput) {
      printJson({
        ok: true,
        peer: {
          id: peer.id,
          type: peer.type,
          displayName: peer.displayName,
          username: peer.username ?? null,
        },
        metadata: null,
      });
      return;
    }

    console.log(`Name: ${peer.displayName}`);
    console.log(`ID: ${peer.id}`);
    console.log(`Type: ${peer.type}`);
    console.log(`Username: ${peer.username ?? '-'}`);
    console.log('DB metadata unavailable (set DATABASE_URL).');
    return;
  }

  const accountId = await requireAccountId(ctx);
  const peerKind = canonicalPeerKind(peer);
  const tags = await listPeerTags(ctx.db, { accountId, peerId: peer.id, peerKind });
  const company = await getPeerCompany(ctx.db, { accountId, peerId: peer.id, peerKind });
  const tasks = await listTasksForPeer(ctx.db, { accountId, peerId: peer.id, peerKind });
  const summary = await getSummary(ctx.db, {
    accountId,
    peerId: peer.id,
    peerKind,
    kind: 'rolling',
  });

  if (ctx.config.jsonOutput) {
    printJson({
      ok: true,
      peer: {
        id: peer.id,
        type: peer.type,
        displayName: peer.displayName,
        username: peer.username ?? null,
      },
      metadata: {
        tags: tags.map((tag) => ({ tag: tag.tag, source: tag.source })),
        company: company
          ? { companyName: company.companyName, role: company.role }
          : null,
        tasks: tasks.map((task) => ({
          taskId: task.taskId,
          dueAt: task.dueAt.toISOString(),
          why: task.why,
          priority: task.priority,
          status: task.status,
        })),
        summary: summary
          ? { content: summary.content, updatedAt: summary.updatedAt.toISOString() }
          : null,
      },
    });
    return;
  }

  console.log(`Name: ${peer.displayName}`);
  console.log(`ID: ${peer.id}`);
  console.log(`Type: ${peer.type}`);
  console.log(`Username: ${peer.username ?? '-'}`);

  console.log(`Tags: ${tags.map((tag) => tag.tag).join(', ') || '-'}`);
  console.log(`Company: ${company ? `${company.companyName}${company.role ? ` (${company.role})` : ''}` : '-'}`);
  console.log(`Open tasks: ${tasks.filter((task) => task.status === 'open').length}`);
  if (summary) {
    console.log(`Summary: ${summary.content}`);
  }
}
