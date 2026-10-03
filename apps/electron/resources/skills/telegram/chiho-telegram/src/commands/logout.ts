import type { AppContext } from '../app/context.js';
import { ensureAuthorized } from '../services/telegram.js';
import { printJson } from '../output.js';

export async function runLogout(ctx: AppContext): Promise<void> {
  await ensureAuthorized(ctx.telegram);
  await ctx.telegram.logOut();
  if (ctx.config.jsonOutput) {
    printJson({ ok: true, loggedOut: true });
    return;
  }
  console.log('Logged out from Telegram.');
}
