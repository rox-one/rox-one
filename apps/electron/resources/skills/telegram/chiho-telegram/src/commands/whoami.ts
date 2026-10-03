import type { AppContext } from '../app/context.js';
import { ensureAuthorized } from '../services/telegram.js';
import { printJson } from '../output.js';

export async function runWhoami(ctx: AppContext): Promise<void> {
  await ensureAuthorized(ctx.telegram);
  const me = await ctx.telegram.getMe();
  if (ctx.config.jsonOutput) {
    printJson({
      ok: true,
      account: {
        displayName: me.displayName,
        id: me.id,
        username: me.username ?? null,
      },
      accountLabel: ctx.config.accountLabel,
    });
    return;
  }

  console.log(`Name: ${me.displayName}`);
  console.log(`ID: ${me.id}`);
  console.log(`Username: ${me.username ?? '-'}`);
  console.log(`Account label: ${ctx.config.accountLabel}`);
}
