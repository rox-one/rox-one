/**
 * Process configuration for rox-tg-bot. Every secret and deployment value
 * comes from the environment; nothing is baked in and no secret is logged.
 *
 * `TELEGRAM_BOT_TOKEN` and `TG_LINK_SERVICE_TOKEN` are required: without the
 * bot token the service cannot run the bot at all, and without the bearer
 * token the HTTP contract would be unauthenticated. The process refuses to
 * boot with a clear error instead of starting in a half-usable state.
 */
import { MAX_ATTEMPTS, LINK_TTL_MS } from './link.ts'

export interface BotPollingConfig {
  /** Base URL of the Telegram Bot API. */
  apiBase: string
  /** Long-poll timeout handed to getUpdates, in seconds. */
  pollTimeoutSec: number
  /** First retry delay after a failed poll. */
  backoffBaseMs: number
  /** Upper bound for the exponential retry delay. */
  backoffMaxMs: number
}

export interface Config {
  /** HTTP port the service listens on. */
  port: number
  /** Telegram bot token (required). */
  botToken: string
  /** Bot username used to build deep links; learned from getMe when absent. */
  botUsername: string
  /** Bearer token required on every /api/link/* call (required). */
  serviceToken: string
  /** SQLite database path (':memory:' in tests). */
  dbPath: string
  /** Lifetime of a link and its verification code. */
  ttlMs: number
  /** Wrong-code attempts accepted before the link is invalidated. */
  maxAttempts: number
  polling: BotPollingConfig
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConfigError'
  }
}

type Env = Record<string, string | undefined>

function optional(env: Env, name: string, fallback: string): string {
  const raw = env[name]
  return raw === undefined || raw === '' ? fallback : raw
}

/** Required, non-empty value; the message names the variable the operator must set. */
function required(env: Env, name: string): string {
  const raw = (env[name] ?? '').trim()
  if (raw === '') throw new ConfigError(`${name} is required`)
  return raw
}

function int(env: Env, name: string, fallback: number, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}): number {
  const raw = env[name]
  if (raw === undefined || raw === '') return fallback
  const value = Number(raw)
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new ConfigError(`${name} must be an integer in [${min}, ${max}], got ${JSON.stringify(raw)}`)
  }
  return value
}

function httpOrigin(name: string, raw: string): string {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new ConfigError(`${name} must be an absolute http(s) URL`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ConfigError(`${name} must use http or https`)
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new ConfigError(`${name} must not contain credentials, query or fragment`)
  }
  return url.origin
}

export function loadConfig(env: Env = process.env): Config {
  const botUsername = optional(env, 'BOT_USERNAME', '').trim().replace(/^@/, '')
  if (botUsername !== '' && !/^[A-Za-z0-9_]{5,32}$/.test(botUsername)) {
    throw new ConfigError(`BOT_USERNAME is not a valid bot username: ${JSON.stringify(botUsername)}`)
  }

  const dbPath = optional(env, 'TG_LINK_DB', '/var/lib/rox-tg-bot/state.sqlite').trim()
  if (dbPath === '') throw new ConfigError('TG_LINK_DB must not be empty')

  return {
    port: int(env, 'PORT', 8789, { min: 1, max: 65535 }),
    botToken: required(env, 'TELEGRAM_BOT_TOKEN'),
    botUsername,
    serviceToken: required(env, 'TG_LINK_SERVICE_TOKEN'),
    dbPath,
    ttlMs: int(env, 'TG_LINK_TTL_MS', LINK_TTL_MS, { min: 60_000, max: 24 * 60 * 60 * 1000 }),
    maxAttempts: int(env, 'TG_LINK_MAX_ATTEMPTS', MAX_ATTEMPTS, { min: 1, max: 100 }),
    polling: {
      apiBase: httpOrigin('TG_API_BASE', optional(env, 'TG_API_BASE', 'https://api.telegram.org')),
      pollTimeoutSec: int(env, 'TG_POLL_TIMEOUT_SEC', 25, { min: 1, max: 50 }),
      backoffBaseMs: int(env, 'TG_BACKOFF_BASE_MS', 1000, { min: 100, max: 60_000 }),
      backoffMaxMs: int(env, 'TG_BACKOFF_MAX_MS', 60_000, { min: 1000, max: 600_000 }),
    },
  }
}