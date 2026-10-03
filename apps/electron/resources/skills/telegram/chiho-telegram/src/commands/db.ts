import type { AppContext } from '../app/context.js';
import { migrate } from '../db/migrate.js';
import { printJson } from '../output.js';

export async function runDb(ctx: AppContext, args: string[]): Promise<void> {
  const sub = args[0];
  if (!sub || sub === 'help' || sub === '--help' || sub === '-h') {
    console.log(`Usage:
  tgchats db migrate
`);
    return;
  }

  if (sub !== 'migrate') {
    throw new Error(`Unknown db subcommand: ${sub}`);
  }

  if (!ctx.db) {
    throw new Error('DATABASE_URL is not set.');
  }

  await migrate(ctx.db);
  if (ctx.config.jsonOutput) {
    printJson({ ok: true, action: 'migrate' });
    return;
  }
  console.log('DB migrations applied.');
}
