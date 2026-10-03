import type { AppContext } from '../app/context.js';
import { ensureAuthorized } from '../services/telegram.js';
import { printJson } from '../output.js';
import { existsSync } from 'node:fs';

export async function runAuth(ctx: AppContext, args: string[] = []): Promise<void> {
  const sub = args[0];
  if (sub === 'status' || sub === '--status' || sub === '--check') {
    const sessionPresent = existsSync(ctx.config.sessionPath);
    const note = sessionPresent
      ? 'Session file exists. Run `tgchats whoami` to verify live authorization.'
      : 'Session file not found. Run `tgchats auth`.';
    if (ctx.config.jsonOutput) {
      printJson({
        ok: true,
        sessionPresent,
        note,
      });
      return;
    }
    console.log(note);
    return;
  }

  await ensureAuthorized(ctx.telegram);
  const me = await ctx.telegram.getMe();
  if (ctx.config.jsonOutput) {
    printJson({
      ok: true,
      authorized: true,
      account: {
        id: me.id,
        displayName: me.displayName,
        username: me.username ?? null,
      },
    });
    return;
  }
  console.log(`Logged in as ${me.displayName}.`);
}
