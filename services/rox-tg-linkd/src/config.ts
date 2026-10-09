/**
 * Process configuration for rox-tg-linkd. Every secret and deployment value
 * comes from the environment; nothing is baked in and no secret is logged.
 *
 * `TG_BOT_TOKEN` is optional at the configuration level so the process can
 * start and answer `/api/health` honestly with `{ ok: false, reason:
 * "no-token" }` instead of pretending to be operational. The linking
 * endpoints refuse to create links until a token is configured.
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
  /** Bot token; empty means "not configured" (health reports no-token). */
  botToken: string
  /** Bot username used to build deep links; learned from getMe when absent. */
  botUsername: string
  /**
   * Bearer token required on /api/link/* and /api/register/*. Empty disables
   * the whole link surface: every call is refused (fail-closed).
   */
  authToken: string
  /** Lifetime of a verification code. */
  ttlMs: number
  /** Wrong-code attempts accepted before the pending link is invalidated. */
  maxAttempts: number
  /** SQLite database path (':memory:' in tests). */
  dbPath: string
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
  const botUsername = optional(env, 'TG_BOT_USERNAME', '').trim().replace(/^@/, '')
  if (botUsername !== '' && !/^[A-Za-z0-9_]{5,32}$/.test(botUsername)) {
    throw new ConfigError(`TG_BOT_USERNAME is not a valid bot username: ${JSON.stringify(botUsername)}`)
  }

  const dbPath = optional(env, 'LINK_DB_PATH', './data/rox-tg-linkd.sqlite').trim()
  if (dbPath === '') throw new ConfigError('LINK_DB_PATH must not be empty')

  return {
    port: int(env, 'PORT', 8095, { min: 1, max: 65535 }),
    botToken: optional(env, 'TG_BOT_TOKEN', '').trim(),
    botUsername,
    authToken: optional(env, 'LINK_AUTH_TOKEN', '').trim(),
    ttlMs: int(env, 'LINK_TTL_MS', LINK_TTL_MS, { min: 60_000, max: 24 * 60 * 60 * 1000 }),
    maxAttempts: int(env, 'LINK_MAX_ATTEMPTS', MAX_ATTEMPTS, { min: 1, max: 100 }),
    dbPath,
    polling: {
      apiBase: httpOrigin('TG_API_BASE', optional(env, 'TG_API_BASE', 'https://api.telegram.org')),
      pollTimeoutSec: int(env, 'TG_POLL_TIMEOUT_SEC', 25, { min: 1, max: 50 }),
      backoffBaseMs: int(env, 'TG_BACKOFF_BASE_MS', 1000, { min: 100, max: 60_000 }),
      backoffMaxMs: int(env, 'TG_BACKOFF_MAX_MS', 60_000, { min: 1000, max: 600_000 }),
    },
  }
}