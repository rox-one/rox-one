/**
 * Room tokens: compact JWS (HS256). Required claims:
 *   sub, room, scope ('edit'|'comment'|'view'), iss, aud, iat, nbf, exp
 * optional: name, epoch (revocation epoch, default 0).
 * Lifetime (exp - iat) is capped at MAX_TOKEN_TTL_SEC (15 min): clients refresh
 * through the token endpoint and send the new token in-band (MSG_AUTH);
 * long-lived share links therefore only ever mint short tokens.
 * Phase 3 adds EdDSA/JWKS issued by id.rox.one; `verifyRoomToken` is the seam.
 */
export type Scope = 'edit' | 'comment' | 'view'
export interface RoomClaims {
  sub: string; room: string; scope: Scope
  iss: string; aud: string; iat: number; nbf: number; exp: number
  name?: string; epoch?: number
}

export const MAX_TOKEN_TTL_SEC = 15 * 60
const CLOCK_SKEW_SEC = 30

export interface VerifyOptions {
  secret: string
  issuer: string
  audience: string
  now?: number
  /** Minimum accepted epoch for (room, sub); tokens below it are revoked. */
  minEpoch?: (room: string, sub: string) => number
}

const enc = new TextEncoder()
const b64url = (b: Uint8Array) => Buffer.from(b).toString('base64url')
const fromB64url = (s: string) => new Uint8Array(Buffer.from(s, 'base64url'))

const keyCache = new Map<string, Promise<CryptoKey>>()
function hmacKey(secret: string): Promise<CryptoKey> {
  let k = keyCache.get(secret)
  if (!k) {
    k = crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
    keyCache.set(secret, k)
  }
  return k
}

export async function signRoomToken(claims: RoomClaims, secret: string): Promise<string> {
  const head = b64url(enc.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })))
  const body = b64url(enc.encode(JSON.stringify(claims)))
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(`${head}.${body}`)))
  return `${head}.${body}.${b64url(sig)}`
}

export type VerifyResult = { ok: true; claims: RoomClaims } | { ok: false; reason: string }

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v)

export async function verifyRoomToken(token: string, room: string, opts: VerifyOptions): Promise<VerifyResult> {
  const now = opts.now ?? Math.floor(Date.now() / 1000)
  const parts = token.split('.')
  if (parts.length !== 3) return { ok: false, reason: 'malformed' }
  const [h, b, s] = parts as [string, string, string]
  let header: { alg?: string }
  let c: Partial<RoomClaims>
  try {
    header = JSON.parse(Buffer.from(h, 'base64url').toString('utf8'))
    c = JSON.parse(Buffer.from(b, 'base64url').toString('utf8'))
  } catch { return { ok: false, reason: 'malformed' } }
  if (!header || header.alg !== 'HS256') return { ok: false, reason: 'alg' }
  const valid = await crypto.subtle.verify('HMAC', await hmacKey(opts.secret), fromB64url(s), enc.encode(`${h}.${b}`))
  if (!valid) return { ok: false, reason: 'signature' }
  if (!c || typeof c !== 'object') return { ok: false, reason: 'malformed' }
  if (c.iss !== opts.issuer) return { ok: false, reason: 'iss' }
  if (c.aud !== opts.audience) return { ok: false, reason: 'aud' }
  if (!isInt(c.iat) || !isInt(c.nbf) || !isInt(c.exp)) return { ok: false, reason: 'times' }
  if (c.iat > now + CLOCK_SKEW_SEC || c.nbf > now + CLOCK_SKEW_SEC) return { ok: false, reason: 'nbf' }
  if (c.exp <= now) return { ok: false, reason: 'expired' }
  if (c.exp - c.iat > MAX_TOKEN_TTL_SEC || c.exp <= c.iat) return { ok: false, reason: 'ttl' }
  if (c.room !== room) return { ok: false, reason: 'room' }
  if (c.scope !== 'edit' && c.scope !== 'comment' && c.scope !== 'view') return { ok: false, reason: 'scope' }
  if (typeof c.sub !== 'string' || !c.sub || c.sub.length > 200) return { ok: false, reason: 'sub' }
  if (c.name !== undefined && (typeof c.name !== 'string' || c.name.length > 200)) return { ok: false, reason: 'name' }
  if (c.epoch !== undefined && !isInt(c.epoch)) return { ok: false, reason: 'epoch' }
  if (opts.minEpoch && (c.epoch ?? 0) < opts.minEpoch(room, c.sub)) return { ok: false, reason: 'revoked' }
  return { ok: true, claims: c as RoomClaims }
}
