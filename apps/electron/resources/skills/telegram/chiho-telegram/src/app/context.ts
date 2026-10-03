import type { TelegramClient } from '@mtcute/node';
import type { DbPool } from '../db/pool.js';
import { createPool } from '../db/pool.js';
import { loadConfig, ensureSessionDir, type AppConfig } from './config.js';
import { createTelegramClient } from './telegram-client.js';
import type { AiService } from '../ai/service.js';
import { createAiService } from '../ai/service.js';

export interface AppContext {
  config: AppConfig;
  telegram: TelegramClient;
  db?: DbPool;
  accountId?: bigint;
  ai?: AiService;
  telegramClient?: TelegramClient;
}

export function createContext(args: string[]): AppContext {
  const config = loadConfig(args);
  const db = config.databaseUrl ? createPool(config.databaseUrl) : undefined;
  const ai = createAiService(config);

  const ctx = { config, db, ai } as AppContext;
  Object.defineProperty(ctx, 'telegram', {
    enumerable: true,
    get() {
      if (!ctx.telegramClient) {
        ensureSessionDir(config.sessionPath);
        ctx.telegramClient = createTelegramClient(config);
      }
      return ctx.telegramClient;
    },
  });

  return ctx;
}

export async function destroyContext(ctx: AppContext): Promise<void> {
  if (ctx.telegramClient) {
    try {
      await ctx.telegramClient.destroy();
    } catch (error) {
      if (!ctx.config.jsonOutput) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Warning: failed to destroy Telegram client cleanly (${message}).`);
      }
    }
  }
  if (ctx.db) {
    await ctx.db.end();
  }
}
