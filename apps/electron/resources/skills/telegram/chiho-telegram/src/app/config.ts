import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { optionalEnv } from './env.js';
import { CliError } from './errors.js';

const DEFAULT_LIMIT = 5;
const DEFAULT_GEMINI_MODEL = 'gemini-2.0-flash';
const DEFAULT_OPENCLAW_MODEL = 'openclaw';
const DEFAULT_AI_TIMEOUT_MS = 30_000;
const DEFAULT_SESSION_PATH = join(
  homedir(),
  '.config',
  'telegram-for-agents',
  'telegram.session',
);

export type AiMode = 'gemini' | 'openclaw';

export interface AppConfig {
  apiId?: number;
  apiHash?: string;
  sessionPath: string;
  proxyUrl?: string;
  limit: number;
  all: boolean;
  databaseUrl?: string;
  accountLabel: string;
  aiMode?: AiMode;
  geminiApiKey?: string;
  geminiModel: string;
  openclawBaseUrl?: string;
  openclawApiKey?: string;
  openclawModel: string;
  aiTimeoutMs: number;
  jsonOutput: boolean;
}

function parseApiId(rawApiId: string): number {
  const apiId = Number.parseInt(rawApiId, 10);
  if (!Number.isInteger(apiId) || apiId <= 0) {
    throw new Error('TELEGRAM_API_ID must be a positive integer.');
  }
  return apiId;
}

function parseLimit(rawLimit: string): number {
  const limit = Number.parseInt(rawLimit, 10);
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new Error(`Invalid --limit value "${rawLimit}". Use a positive integer.`);
  }
  return limit;
}

function parseAllFromArgs(args: string[]): boolean {
  return args.includes('--all') || args.includes('-a');
}

function parseJsonOutputFromArgs(args: string[]): boolean {
  return args.includes('--json');
}

function parseLimitFromArgs(args: string[]): number {
  const index = args.findIndex((arg) => arg === '--limit' || arg === '-n');
  if (index === -1) {
    return DEFAULT_LIMIT;
  }

  const value = args[index + 1];
  if (!value) {
    throw new Error('Missing value for --limit.');
  }

  return parseLimit(value);
}

function parseAiTimeoutMs(rawTimeoutMs: string | undefined): number {
  if (!rawTimeoutMs) {
    return DEFAULT_AI_TIMEOUT_MS;
  }

  const parsed = Number.parseInt(rawTimeoutMs, 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error('AI_TIMEOUT_MS must be a positive integer.');
  }
  return parsed;
}

function parseAiMode(
  rawMode: string | undefined,
  geminiApiKey: string | undefined,
  openclawBaseUrl: string | undefined,
): AiMode | undefined {
  if (!rawMode) {
    if (geminiApiKey) return 'gemini';
    if (openclawBaseUrl) return 'openclaw';
    return undefined;
  }

  const lowered = rawMode.toLowerCase();
  if (lowered === 'gemini' || lowered === 'openclaw') {
    return lowered;
  }
  throw new CliError('AI_MODE must be one of: gemini, openclaw.', 'AI_MODE_INVALID');
}

export function ensureSessionDir(sessionPath: string): void {
  try {
    mkdirSync(dirname(sessionPath), { recursive: true });
  } catch {
    throw new CliError(
      'Telegram session storage directory could not be created. Check TELEGRAM_SESSION_PATH and local filesystem permissions.',
      'TELEGRAM_SESSION_STORAGE_OPEN_FAILED',
    );
  }
}

function assertSupportedNodeVersion() {
  const major = Number.parseInt(process.versions.node.split('.')[0] || '', 10);
  if (major === 22 || major === 23) {
    return;
  }

  throw new CliError(
    `Unsupported Node.js runtime ${process.versions.node}. Use Node 22 or 23.`,
    'UNSUPPORTED_NODE_VERSION',
  );
}

export function loadConfig(args: string[]): AppConfig {
  assertSupportedNodeVersion();
  const rawApiId = optionalEnv('TELEGRAM_API_ID');
  const apiId = rawApiId ? parseApiId(rawApiId) : undefined;
  const apiHash = optionalEnv('TELEGRAM_API_HASH');
  const sessionPath = optionalEnv('TELEGRAM_SESSION_PATH') ?? DEFAULT_SESSION_PATH;
  const proxyUrl = optionalEnv('TELEGRAM_PROXY_URL');
  const databaseUrl = optionalEnv('DATABASE_URL');
  const accountLabel = optionalEnv('TELEGRAM_ACCOUNT_LABEL') ?? 'default';
  const geminiApiKey = optionalEnv('GEMINI_API_KEY');
  const geminiModel = optionalEnv('GEMINI_MODEL') ?? DEFAULT_GEMINI_MODEL;
  const openclawBaseUrl = optionalEnv('OPENCLAW_BASE_URL');
  const openclawApiKey = optionalEnv('OPENCLAW_API_KEY');
  const openclawModel = optionalEnv('OPENCLAW_MODEL') ?? DEFAULT_OPENCLAW_MODEL;
  const aiTimeoutMs = parseAiTimeoutMs(optionalEnv('AI_TIMEOUT_MS'));
  const aiMode = parseAiMode(optionalEnv('AI_MODE'), geminiApiKey, openclawBaseUrl);

  if (aiMode === 'gemini' && !geminiApiKey) {
    throw new CliError('AI_MODE=gemini requires GEMINI_API_KEY.', 'AI_NOT_CONFIGURED');
  }
  if (aiMode === 'openclaw' && !openclawBaseUrl) {
    throw new CliError('AI_MODE=openclaw requires OPENCLAW_BASE_URL.', 'AI_NOT_CONFIGURED');
  }

  return {
    apiId,
    apiHash,
    sessionPath,
    proxyUrl,
    databaseUrl,
    accountLabel,
    aiMode,
    geminiApiKey,
    geminiModel,
    openclawBaseUrl,
    openclawApiKey,
    openclawModel,
    aiTimeoutMs,
    jsonOutput: parseJsonOutputFromArgs(args),
    all: parseAllFromArgs(args),
    limit: parseLimitFromArgs(args),
  };
}
