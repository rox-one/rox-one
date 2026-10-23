/**
 * Relay transport for the workspace-service `im` module.
 *
 * The relay speaks NIP-01/NIP-42 (REST `POST {relayUrl}/events`). Every write
 * carries a NIP-98 (kind 27235) `Authorization: Nostr <base64(JSON(event))>`
 * header signed with the **service** key. Relay URL and service `nsec` come
 * only from the environment (`ROX_IM_RELAY_URL`, `ROX_IM_SERVICE_NSEC`, or the
 * `_FILE` variants) — never a literal, never logged.
 *
 * `ImRelayClient` is the seam the routes depend on; tests inject a fake.
 */

import { readFileSync } from 'node:fs'
import {
  buildNip98AuthEvent,
  buildRelayAdminEvent,
  parseSecretKey,
  type NostrEvent,
} from '@rox/shared/messenger-relay'

export interface ImRelayConfig {
  readonly relayUrl: string
  /** Service secret key, 64-char hex. Never logged or serialized. */
  readonly secretKey: string
  /** Lifetime of the token returned by `/v1/im/token`. */
  readonly tokenTtlSeconds: number
}

export interface ImPresenceEntry {
  readonly userId: string
  readonly status: 'online' | 'away' | 'offline'
  readonly lastSeenAt: string | null
}

export interface ImRelayClient {
  /** Publish the relay-admin add-member event; returns the signed event. */
  addMember(pubkey: string): Promise<NostrEvent>
  /** Publish the relay-admin remove-member event; returns the signed event. */
  removeMember(pubkey: string): Promise<NostrEvent>
  /** POST a signed event to `{relayUrl}/events` with a NIP-98 auth header. */
  publishEvent(event: NostrEvent): Promise<void>
  /** Read presence for the given rox user ids from the relay. */
  presence(userIds: readonly string[]): Promise<ImPresenceEntry[]>
}

/** The relay rejected the call or could not be reached (mapped to `502 RELAY_UNAVAILABLE`). */
export class ImRelayUnavailableError extends Error {
  readonly code = 'RELAY_UNAVAILABLE'
  constructor(readonly reason?: unknown) {
    super('relay unavailable')
    this.name = 'ImRelayUnavailableError'
  }
}

export const DEFAULT_IM_TOKEN_TTL_SECONDS = 300

const DEFAULT_ENV_KEYS = {
  relayUrl: 'ROX_IM_RELAY_URL',
  relayUrlFile: 'ROX_IM_RELAY_URL_FILE',
  secret: 'ROX_IM_SERVICE_NSEC',
  secretFile: 'ROX_IM_SERVICE_NSEC_FILE',
  ttl: 'ROX_IM_TOKEN_TTL_SECONDS',
} as const

function readSecret(path: string): string {
  return readFileSync(path, 'utf8').trim()
}

function httpUrl(value: string): string | null {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString().replace(/\/$/, '') : null
  } catch {
    return null
  }
}

/**
 * Resolve the relay configuration from the environment. Returns `null` (feature
 * off → routes 404) unless both a relay URL and a service key are present. The
 * `_FILE` variants take precedence and hold the raw value.
 */
export function resolveImRelayConfig(
  env: Record<string, string | undefined> = process.env,
  readFile: (path: string) => string = readSecret,
): ImRelayConfig | null {
  const rawUrl = (env[DEFAULT_ENV_KEYS.relayUrlFile] ? readFile(env[DEFAULT_ENV_KEYS.relayUrlFile]!) : env[DEFAULT_ENV_KEYS.relayUrl])?.trim()
  const rawSecret = (env[DEFAULT_ENV_KEYS.secretFile] ? readFile(env[DEFAULT_ENV_KEYS.secretFile]!) : env[DEFAULT_ENV_KEYS.secret])?.trim()
  if (!rawUrl || !rawSecret) return null
  const relayUrl = httpUrl(rawUrl)
  if (!relayUrl) throw new Error('ROX_IM_RELAY_URL must be an absolute http(s) URL')
  // parseSecretKey throws on a malformed key; never echo the value.
  const secretKey = Buffer.from(parseSecretKey(rawSecret)).toString('hex')
  const ttlRaw = env[DEFAULT_ENV_KEYS.ttl]
  const tokenTtlSeconds = ttlRaw === undefined || ttlRaw === ''
    ? DEFAULT_IM_TOKEN_TTL_SECONDS
    : (() => {
        const parsed = Number(ttlRaw)
        if (!Number.isInteger(parsed) || parsed < 30 || parsed > 86_400) throw new Error('ROX_IM_TOKEN_TTL_SECONDS must be an integer between 30 and 86400')
        return parsed
      })()
  return { relayUrl, secretKey, tokenTtlSeconds }
}

function nip98Header(event: NostrEvent): string {
  return `Nostr ${Buffer.from(JSON.stringify(event), 'utf8').toString('base64')}`
}

function unixSeconds(now: () => Date): number {
  return Math.floor(now().getTime() / 1000)
}

function presenceEntry(value: unknown): ImPresenceEntry | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  const row = value as Record<string, unknown>
  if (typeof row.userId !== 'string' || row.userId.length === 0) return null
  const status = row.status === 'online' || row.status === 'away' || row.status === 'offline' ? row.status : 'offline'
  const lastSeenAt = typeof row.lastSeenAt === 'string' ? row.lastSeenAt : null
  return { userId: row.userId, status, lastSeenAt }
}

export interface HttpImRelayClientOptions {
  readonly fetch?: typeof fetch
  readonly now?: () => Date
}

/** Real HTTP client: `POST {relayUrl}/events` with a NIP-98 header. */
export function createHttpImRelayClient(config: ImRelayConfig, options: HttpImRelayClientOptions = {}): ImRelayClient {
  const doFetch = options.fetch ?? globalThis.fetch
  const now = options.now ?? (() => new Date())

  async function publishEvent(event: NostrEvent): Promise<void> {
    const url = `${config.relayUrl}/events`
    const body = JSON.stringify(event)
    const auth = buildNip98AuthEvent({ secretKey: config.secretKey, url, method: 'POST', payload: body, createdAt: unixSeconds(now) })
    let response: Response
    try {
      response = await doFetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: nip98Header(auth) },
        body,
      })
    } catch (error) {
      throw new ImRelayUnavailableError(error)
    }
    if (!response.ok) throw new ImRelayUnavailableError(`relay responded ${response.status}`)
  }

  return {
    async addMember(pubkey) {
      const event = buildRelayAdminEvent({ secretKey: config.secretKey, action: 'add', pubkey, role: 'member' })
      await publishEvent(event)
      return event
    },
    async removeMember(pubkey) {
      const event = buildRelayAdminEvent({ secretKey: config.secretKey, action: 'remove', pubkey })
      await publishEvent(event)
      return event
    },
    publishEvent,
    async presence(userIds) {
      const url = `${config.relayUrl}/presence?userIds=${encodeURIComponent(userIds.join(','))}`
      const auth = buildNip98AuthEvent({ secretKey: config.secretKey, url, method: 'GET', payload: '', createdAt: unixSeconds(now) })
      let response: Response
      try {
        response = await doFetch(url, { method: 'GET', headers: { authorization: nip98Header(auth) } })
      } catch (error) {
        throw new ImRelayUnavailableError(error)
      }
      if (!response.ok) throw new ImRelayUnavailableError(`relay responded ${response.status}`)
      const payload = (await response.json().catch(() => null)) as unknown
      const list = Array.isArray(payload) ? payload : []
      return list.map(presenceEntry).filter((entry): entry is ImPresenceEntry => entry !== null)
    },
  }
}

export { }

/** In-memory relay client for tests: records every published event. */
export interface FakeImRelayClient extends ImRelayClient {
  readonly published: NostrEvent[]
  readonly members: string[]
  presenceResult: ImPresenceEntry[]
  failWith: Error | null
}

export function createFakeImRelayClient(): FakeImRelayClient {
  const published: NostrEvent[] = []
  const members: string[] = []
  const client: FakeImRelayClient = {
    published,
    members,
    presenceResult: [] as ImPresenceEntry[],
    failWith: null as Error | null,
    async addMember(pubkey: string) {
      if (client.failWith) throw client.failWith
      members.push(pubkey)
      const event = buildRelayAdminEvent({ secretKey: '01'.repeat(32), action: 'add', pubkey, role: 'member' })
      published.push(event)
      return event
    },
    async removeMember(pubkey: string) {
      if (client.failWith) throw client.failWith
      const index = members.indexOf(pubkey)
      if (index >= 0) members.splice(index, 1)
      const event = buildRelayAdminEvent({ secretKey: '01'.repeat(32), action: 'remove', pubkey })
      published.push(event)
      return event
    },
    async publishEvent(event: NostrEvent) {
      if (client.failWith) throw client.failWith
      published.push(event)
    },
    async presence(userIds: readonly string[]) {
      if (client.failWith) throw client.failWith
      const wanted = new Set(userIds)
      return client.presenceResult.filter(entry => wanted.has(entry.userId))
    },
  }
  return client
}
