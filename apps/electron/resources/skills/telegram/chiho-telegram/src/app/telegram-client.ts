import { createRequire } from 'node:module';
import { TelegramClient, SqliteStorage } from '@mtcute/node';
import { createProxyTransport } from '../proxy.js';
import type { AppConfig } from './config.js';
import { CliError } from './errors.js';

interface SqliteDatabase {
  close(): void;
  pragma(source: string): unknown;
}

type SqliteDatabaseFactory = (filename: string) => SqliteDatabase;

const require = createRequire(import.meta.url);
const sqlite3 = require('better-sqlite3') as SqliteDatabaseFactory;

export interface TelegramStorageProbeResult {
  disableWal: boolean;
  warning?: string;
}

export function probeTelegramSessionStorage(
  sessionPath: string,
  openDatabase: SqliteDatabaseFactory = (filename) => sqlite3(filename),
): TelegramStorageProbeResult {
  let db: SqliteDatabase | undefined;

  try {
    db = openDatabase(sessionPath);
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      String((error as { code?: string | number }).code) === 'ERR_DLOPEN_FAILED'
    ) {
      throw new CliError(
        'Telegram session storage native module failed to load. Reinstall dependencies or rebuild better-sqlite3 for this machine.',
        'TELEGRAM_SESSION_STORAGE_NATIVE_LOAD_FAILED',
      );
    }

    throw new CliError(
      'Telegram session storage could not be opened. Check TELEGRAM_SESSION_PATH and local filesystem permissions.',
      'TELEGRAM_SESSION_STORAGE_OPEN_FAILED',
    );
  }

  try {
    db.pragma('journal_mode = WAL');
    return { disableWal: false };
  } catch (error) {
    const code =
      typeof error === 'object' && error !== null && 'code' in error
        ? String((error as { code?: string | number }).code)
        : '';

    if (code === 'SQLITE_CANTOPEN' || code === 'SQLITE_READONLY') {
      return {
        disableWal: true,
        warning:
          'Telegram session storage does not support SQLite WAL here; falling back to compatibility mode.',
      };
    }

    throw new CliError(
      'Telegram session storage could not initialize SQLite journaling. Check TELEGRAM_SESSION_PATH and local filesystem permissions.',
      'TELEGRAM_SESSION_STORAGE_INIT_FAILED',
    );
  } finally {
    db.close();
  }
}

export function createTelegramClient(config: AppConfig): TelegramClient {
  if (!config.apiId || !config.apiHash) {
    throw new CliError(
      'Telegram credentials are not configured. Set TELEGRAM_API_ID and TELEGRAM_API_HASH.',
      'TELEGRAM_NOT_CONFIGURED',
    );
  }

  const transport = createProxyTransport(config.proxyUrl);
  if (transport) {
    console.log('Using proxy transport from TELEGRAM_PROXY_URL.');
  }

  const probe = probeTelegramSessionStorage(config.sessionPath);
  if (probe.warning && !config.jsonOutput) {
    console.log(probe.warning);
  }

  return new TelegramClient({
    apiId: config.apiId,
    apiHash: config.apiHash,
    storage: new SqliteStorage(
      config.sessionPath,
      probe.disableWal ? { disableWal: true } : undefined,
    ),
    ...(transport ? { transport } : {}),
  });
}
