/**
 * LiveKit webhook verification (no livekit-server-sdk dependency).
 *
 * LiveKit POSTs `Content-Type: application/webhook+json` with an Authorization
 * JWT signed by the API secret; the claim set includes `sha256` = standard
 * Base64 of SHA-256(raw body). See
 * https://docs.livekit.io/intro/basics/rooms-participants-tracks/webhooks-events/
 *
 * Never log the secret, the auth JWT, or the raw body.
 */
import { createHmac, createHash, timingSafeEqual } from 'crypto'

export type LiveKitWebhookEventName =
  | 'room_started'
  | 'room_finished'
  | 'participant_joined'
  | 'participant_left'
  | 'participant_connection_aborted'
  | 'track_published'
  | 'track_unpublished'
  | 'egress_started'
  | 'egress_updated'
  | 'egress_ended'
  | 'ingress_started'
  | 'ingress_ended'
  | string

export interface LiveKitWebhookRoom {
  sid?: string
  name?: string
  emptyTimeout?: number
  maxParticipants?: number
  creationTime?: number | string
  numParticipants?: number
  metadata?: string
}

export interface LiveKitWebhookParticipant {
  sid?: string
  identity?: string
  name?: string
  state?: number | string
  joinedAt?: number | string
}

export interface LiveKitWebhookEvent {
  id?: string
  event: LiveKitWebhookEventName
  createdAt?: number
  room?: LiveKitWebhookRoom
  participant?: LiveKitWebhookParticipant
}

export class LiveKitWebhookError extends Error {
  constructor(readonly code: 'UNAUTHORIZED' | 'INVALID', message: string) {
    super(message)
    this.name = 'LiveKitWebhookError'
  }
}

const b64url = (input: Buffer | string): string =>
  Buffer.from(input).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')

const b64std = (input: Buffer): string => input.toString('base64')

function safeEqualStr(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}

/** Channel id encoded in a contract-v1 room name (`rox-ch-<channelId>`), or null. */
export function channelIdFromCallRoomName(roomName: string): string | null {
  if (typeof roomName !== 'string' || !roomName.startsWith('rox-ch-')) return null
  const id = roomName.slice('rox-ch-'.length)
  return /^[A-Za-z0-9._:-]{1,128}$/.test(id) ? id : null
}

/**
 * Verify the LiveKit Authorization JWT and body checksum, then parse the event.
 * Rejects when credentials are missing — never skips auth.
 */
export function verifyLiveKitWebhook(
  body: string,
  authHeader: string | undefined,
  apiKey: string,
  apiSecret: string,
  opts: { nowSeconds?: number; clockToleranceSeconds?: number } = {},
): LiveKitWebhookEvent {
  if (!apiKey || !apiSecret) throw new LiveKitWebhookError('UNAUTHORIZED', 'LiveKit credentials are not configured')
  if (!authHeader || typeof authHeader !== 'string') throw new LiveKitWebhookError('UNAUTHORIZED', 'authorization header is empty')
  if (typeof body !== 'string') throw new LiveKitWebhookError('INVALID', 'body must be the raw POST string')

  const token = authHeader.replace(/^Bearer\s+/i, '').trim()
  const parts = token.split('.')
  if (parts.length !== 3) throw new LiveKitWebhookError('UNAUTHORIZED', 'malformed authorization token')
  const [head, payload, sig] = parts as [string, string, string]
  const expectedSig = b64url(createHmac('sha256', apiSecret).update(`${head}.${payload}`).digest())
  if (!safeEqualStr(sig, expectedSig)) throw new LiveKitWebhookError('UNAUTHORIZED', 'invalid authorization signature')

  let claims: { iss?: string; exp?: number; nbf?: number; sha256?: string }
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
  } catch {
    throw new LiveKitWebhookError('UNAUTHORIZED', 'malformed authorization payload')
  }
  if (claims.iss !== apiKey) throw new LiveKitWebhookError('UNAUTHORIZED', 'authorization issuer mismatch')
  const now = opts.nowSeconds ?? Math.floor(Date.now() / 1000)
  const skew = Math.max(0, opts.clockToleranceSeconds ?? 60)
  if (typeof claims.exp === 'number' && now > claims.exp + skew) throw new LiveKitWebhookError('UNAUTHORIZED', 'authorization expired')
  if (typeof claims.nbf === 'number' && now + skew < claims.nbf) throw new LiveKitWebhookError('UNAUTHORIZED', 'authorization not yet valid')
  if (typeof claims.sha256 !== 'string' || !claims.sha256) throw new LiveKitWebhookError('UNAUTHORIZED', 'authorization missing body checksum')

  const bodyHashB64 = b64std(createHash('sha256').update(body, 'utf8').digest())
  if (!safeEqualStr(claims.sha256, bodyHashB64)) throw new LiveKitWebhookError('UNAUTHORIZED', 'body checksum mismatch')

  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    throw new LiveKitWebhookError('INVALID', 'body is not JSON')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new LiveKitWebhookError('INVALID', 'body is not an event object')
  const event = (parsed as { event?: unknown }).event
  if (typeof event !== 'string' || !event) throw new LiveKitWebhookError('INVALID', 'event name is required')
  return parsed as LiveKitWebhookEvent
}

/** Test helper: mint a LiveKit-shaped webhook Authorization JWT for a body. Never use in production paths that log. */
export function signLiveKitWebhookAuth(
  body: string,
  apiKey: string,
  apiSecret: string,
  opts: { nowSeconds?: number; ttlSeconds?: number } = {},
): string {
  const now = opts.nowSeconds ?? Math.floor(Date.now() / 1000)
  const ttl = Math.min(Math.max(30, opts.ttlSeconds ?? 300), 3600)
  const claims = {
    iss: apiKey,
    nbf: now - 10,
    exp: now + ttl,
    sha256: b64std(createHash('sha256').update(body, 'utf8').digest()),
  }
  const head = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const payload = b64url(JSON.stringify(claims))
  const sig = b64url(createHmac('sha256', apiSecret).update(`${head}.${payload}`).digest())
  return `${head}.${payload}.${sig}`
}
