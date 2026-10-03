import type { AppContext } from './context.js';
import { ensureAccountId } from '../db/crm.js';
import { CliError } from './errors.js';

export async function requireAccountId(ctx: AppContext): Promise<bigint> {
  if (!ctx.db) {
    throw new CliError('DATABASE_URL is not set.', 'DATABASE_NOT_CONFIGURED');
  }

  if (!ctx.accountId) {
    ctx.accountId = await ensureAccountId(ctx.db, {
      label: ctx.config.accountLabel,
      sessionPath: ctx.config.sessionPath,
    });
  }

  return ctx.accountId;
}
