import type { AppContext } from './context.js';
import type { DbPool } from '../db/pool.js';
import { CliError } from './errors.js';

export function requireDb(ctx: AppContext): DbPool {
  if (!ctx.db) {
    throw new CliError('DATABASE_URL is not set.', 'DATABASE_NOT_CONFIGURED');
  }
  return ctx.db;
}
