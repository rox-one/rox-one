import type { AppContext } from '../app/context.js';
import { parseCommandArgs } from '../app/cli-args.js';
import { ensureAuthorized, normalizePeerRef } from '../services/telegram.js';
import { printJson } from '../output.js';

export async function runArchive(ctx: AppContext, args: string[]): Promise<void> {
  const parsed = parseCommandArgs(args);
  const peers = parsed.positionals.map(normalizePeerRef);
  if (peers.length === 0) {
    throw new Error('Usage: tgchats archive <peer...>');
  }
  await ensureAuthorized(ctx.telegram);
  await ctx.telegram.archiveChats(peers);
  if (ctx.config.jsonOutput) {
    printJson({ ok: true, action: 'archive', count: peers.length });
    return;
  }
  console.log(`Archived ${peers.length} chat(s).`);
}

export async function runUnarchive(ctx: AppContext, args: string[]): Promise<void> {
  const parsed = parseCommandArgs(args);
  const peers = parsed.positionals.map(normalizePeerRef);
  if (peers.length === 0) {
    throw new Error('Usage: tgchats unarchive <peer...>');
  }
  await ensureAuthorized(ctx.telegram);
  await ctx.telegram.unarchiveChats(peers);
  if (ctx.config.jsonOutput) {
    printJson({ ok: true, action: 'unarchive', count: peers.length });
    return;
  }
  console.log(`Unarchived ${peers.length} chat(s).`);
}
