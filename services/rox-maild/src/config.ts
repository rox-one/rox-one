/**
 * Process configuration for rox-maild. Every secret and every deployment
 * specific value comes from the environment — nothing is baked in and no
 * secret is ever logged.
 */

/** Hard cap for a single inbound message (raw bytes, before base64). */
export const MAX_INBOUND_BYTES = 25 * 1024 * 1024
/** Byte cap for the JSON envelope carrying the raw message. */
export const MAX_INBOUND_BODY_BYTES = Math.ceil((MAX_INBOUND_BYTES * 4) / 3) + 64 * 1024

export interface Config {
  /** HTTP port the service listens on. */
  port: number
  /** Shared secret for `X-Rox-Signature` (HMAC-SHA256 over the raw body). */
  inboundSecret: string
  maxInboundBytes: number
  smtp: {
    host: string
    port: number
    timeoutMs: number
    /** Name announced in EHLO. */
    helo: string
  }
  /** How many recently delivered message ids are remembered for deduplication. */
  dedupeCapacity: number
  /** Rox broker origin used to verify access tokens. */
  brokerUrl: string
  /** Stalwart JMAP/management origin reachable from this process. */
  stalwartAdminUrl: string
  stalwartAdminUser: string
  stalwartAdminPassword: string
  /** Domain provisioned accounts live under. */
  mailDomain: string
  /** Public JMAP URL returned to clients by /api/provision. */
  jmapUrl: string
  /** Timeout for the token-verification call against the Rox broker. */
  brokerTimeoutMs: number
  /** Timeout for the Stalwart reachability probe on /api/health. */
  healthTimeoutMs: number
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConfigError'
  }
}

type Env = Record<string, string | undefined>

function str(env: Env, name: string, fallback?: string): string {
  const raw = env[name]
  if (raw === undefined || raw === '') {
    if (fallback !== undefined) return fallback
    throw new ConfigError(`Missing required environment variable ${name}`)
  }
  return raw
}

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
  const inboundSecret = str(env, 'MAIL_INBOUND_SECRET')

  const stalwartAdminUrl = httpOrigin('STALWART_ADMIN_URL', optional(env, 'STALWART_ADMIN_URL', 'http://127.0.0.1:8480'))
  const jmapUrl = httpOrigin('MAIL_JMAP_URL', optional(env, 'MAIL_JMAP_URL', stalwartAdminUrl))
  const brokerUrl = httpOrigin('ROX_BROKER_URL', optional(env, 'ROX_BROKER_URL', 'https://rox.one'))

  const mailDomain = optional(env, 'MAIL_DOMAIN', 'rox.one').trim().toLowerCase()
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(mailDomain)) {
    throw new ConfigError(`MAIL_DOMAIN is not a valid domain: ${JSON.stringify(mailDomain)}`)
  }

  return {
    port: int(env, 'PORT', 8080, { min: 1, max: 65535 }),
    inboundSecret,
    maxInboundBytes: MAX_INBOUND_BYTES,
    smtp: {
      host: optional(env, 'MAIL_SMTP_HOST', '127.0.0.1'),
      port: int(env, 'MAIL_SMTP_PORT', 2525, { min: 1, max: 65535 }),
      timeoutMs: int(env, 'MAIL_SMTP_TIMEOUT_MS', 20_000, { min: 1000, max: 120_000 }),
      helo: optional(env, 'MAIL_SMTP_HELO', 'rox-maild'),
    },
    dedupeCapacity: int(env, 'MAIL_DEDUPE_CAPACITY', 5000, { min: 16, max: 1_000_000 }),
    brokerUrl,
    stalwartAdminUrl,
    stalwartAdminUser: str(env, 'STALWART_ADMIN_USER'),
    stalwartAdminPassword: str(env, 'STALWART_ADMIN_PASSWORD'),
    mailDomain,
    jmapUrl,
    brokerTimeoutMs: int(env, 'ROX_BROKER_TIMEOUT_MS', 10_000, { min: 1000, max: 60_000 }),
    healthTimeoutMs: int(env, 'MAIL_HEALTH_TIMEOUT_MS', 2500, { min: 250, max: 30_000 }),
  }
}