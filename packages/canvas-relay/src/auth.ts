/**
 * Room tokens: compact JWS (HS256) with claims
 *   { sub, room, scope: 'edit'|'comment'|'view', exp, iat?, name? }.
 * MVP verifies with a shared secret (self-host mode). Phase 3 adds EdDSA/JWKS
 * issued by id.rox.one; `verifyRoomToken` is the single seam for that.
 */
export type Scope = 'edit' | 'comment' | 'view'
export interface RoomClaims { sub: string; room: string; scope: Scope; exp: number; iat?: number; name?: string }

const enc = new TextEncoder()
const b64url = (b: Uint8Array) => Buffer.from(b).toString('base64url')
const fromB64url = (s: string) => new Uint8Array(Buffer.from(s, 'base64url'))

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
}

export async function signRoomToken(claims: RoomClaims, secret: string): Promise<string> {
  const head = b64url(enc.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })))
  const body = b64url(enc.encode(JSON.stringify(claims)))
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(`${head}.${body}`)))
  return `${head}.${body}.${b64url(sig)}`
}

export type VerifyResult = { ok: true; claims: RoomClaims } | { ok: false; reason: string }

export async function verifyRoomToken(token: string, room: string, secret: string, nowSec = Math.floor(Date.now() / 1000)): Promise<VerifyResult> {
  const parts = token.split('.')
  if (parts.length !== 3) return { ok: false, reason: 'malformed' }
  const [h, b, s] = parts as [string, string, string]
  let header: { alg?: string }
  let claims: RoomClaims
  try {
    header = JSON.parse(Buffer.from(h, 'base64url').toString('utf8'))
    claims = JSON.parse(Buffer.from(b, 'base64url').toString('utf8'))
  } catch { return { ok: false, reason: 'malformed' } }
  if (header.alg !== 'HS256') return { ok: false, reason: 'alg' }
  const valid = await crypto.subtle.verify('HMAC', await hmacKey(secret), fromB64url(s), enc.encode(`${h}.${b}`))
  if (!valid) return { ok: false, reason: 'signature' }
  if (typeof claims.exp !== 'number' || claims.exp <= nowSec) return { ok: false, reason: 'expired' }
  if (claims.room !== room) return { ok: false, reason: 'room' }
  if (!['edit', 'comment', 'view'].includes(claims.scope)) return { ok: false, reason: 'scope' }
  if (typeof claims.sub !== 'string' || !claims.sub) return { ok: false, reason: 'sub' }
  return { ok: true, claims }
}
