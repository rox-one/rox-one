/**
 * Shared helpers for the session-share Pages Functions.
 *
 * Security model (see apps/viewer/SECURITY.md):
 *   - share id  = public read capability    (GET is unauthenticated)
 *   - ownerKey  = owner mutation capability (PUT/DELETE require it)
 * Only a SHA-256 hash of the ownerKey is stored in R2 custom metadata.
 */

export interface Env {
  SHARES: R2Bucket
  VIEWER_ORIGIN?: string
}

export const MAX_SHARE_BYTES = 25 * 1024 * 1024

// Best-effort per-IP budgets (per-isolate; see SECURITY.md §8). A durable
// Cloudflare Rate Limiting rule is the recommended production layer.
export const CREATE_RATE_LIMIT = 30
export const MUTATION_RATE_LIMIT = 60
export const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000

export type ShareErrorCode =
  | 'INVALID_JSON'
  | 'INVALID_SESSION_PAYLOAD'
  | 'SHARE_OWNER_KEY_REQUIRED'
  | 'SHARE_OWNER_KEY_INVALID'
  | 'LEGACY_SHARE_IMMUTABLE'
  | 'SHARE_NOT_FOUND'
  | 'SHARE_TOO_LARGE'
  | 'SHARE_CONFLICT'
  | 'RATE_LIMITED'
  | 'SHARE_STORAGE_NOT_CONFIGURED'

export const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Share-Owner-Key',
  'X-Content-Type-Options': 'nosniff',
}

export function json(data: unknown, status = 200, extraHeaders?: Record<string, string>): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS, ...extraHeaders },
  })
}

export function shareError(
  code: ShareErrorCode,
  message: string,
  status: number,
  extraHeaders?: Record<string, string>,
): Response {
  return json({ error: message, code }, status, extraHeaders)
}

export function originOf(request: Request, env: Env): string {
  const configured = (env.VIEWER_ORIGIN || '').replace(/\/$/, '')
  if (configured) return configured
  const url = new URL(request.url)
  return `${url.protocol}//${url.host}`
}

const SHARE_ID_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-'

export function newId(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  let out = ''
  for (let i = 0; i < 21; i++) out += SHARE_ID_ALPHABET[bytes[i % 16]! % SHARE_ID_ALPHABET.length]!
  return out
}

export function isValidShareId(id: string): boolean {
  return /^[A-Za-z0-9_-]{1,64}$/.test(id)
}

function base64Url(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

/** Owner mutation capability: 256 bits of entropy, base64url (43 chars). */
export function newOwnerKey(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return base64Url(bytes)
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Fixed-length-loop comparison; no early exit on mismatch. */
export function timingSafeEqual(a: string, b: string): boolean {
  const ba = new TextEncoder().encode(a)
  const bb = new TextEncoder().encode(b)
  if (ba.length === 0 || bb.length === 0) return false
  let diff = ba.length ^ bb.length
  const len = Math.max(ba.length, bb.length)
  for (let i = 0; i < len; i++) {
    diff |= (ba[i] ?? 0) ^ (bb[i] ?? 0)
  }
  return diff === 0
}

/** Extract the presented owner key from `Authorization: Bearer` or `X-Share-Owner-Key`. */
export function extractOwnerKey(request: Request): string | null {
  const auth = request.headers.get('Authorization')
  if (auth) {
    const match = /^Bearer\s+(\S+)$/i.exec(auth.trim())
    if (!match) return null
    return match[1]!
  }
  const headerKey = request.headers.get('X-Share-Owner-Key')
  if (headerKey && headerKey.trim()) return headerKey.trim()
  return null
}

/** Key under which the SHA-256 hash of the ownerKey lives in R2 custom metadata. */
export const OWNER_KEY_HASH_META = 'ownerkeyhash'

export interface ShareHeadLike {
  customMetadata?: Record<string, string>
}

/**
 * Gate a mutation (PUT/DELETE) on the owner capability.
 * Returns null when authorized, otherwise the error Response to send.
 */
export async function checkOwnerCapability(request: Request, existing: ShareHeadLike): Promise<Response | null> {
  const storedHash = existing.customMetadata?.[OWNER_KEY_HASH_META]
  if (!storedHash) {
    // Legacy share: created before owner keys existed. Never silently allow
    // mutation — the unauthenticated overwrite path is permanently closed.
    return shareError(
      'LEGACY_SHARE_IMMUTABLE',
      'This share was created before share protection existed and can no longer be modified or deleted via the API. Create a new share instead.',
      403,
    )
  }
  const presented = extractOwnerKey(request)
  if (!presented) {
    return shareError(
      'SHARE_OWNER_KEY_REQUIRED',
      'This operation requires the share owner key (Authorization: Bearer <ownerKey>).',
      401,
      { 'WWW-Authenticate': 'Bearer realm="share-owner"' },
    )
  }
  const presentedHash = await sha256Hex(presented)
  if (!timingSafeEqual(presentedHash, storedHash)) {
    return shareError('SHARE_OWNER_KEY_INVALID', 'The provided share owner key does not match this share.', 403)
  }
  return null
}

export function isSessionPayload(v: unknown): v is { id: string; messages: unknown[] } {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  return typeof o.id === 'string' && Array.isArray(o.messages)
}

/** Early 413 based on Content-Length, before the body is read into memory. */
export function checkDeclaredSize(request: Request): Response | null {
  const declared = Number(request.headers.get('Content-Length') ?? 0)
  if (Number.isFinite(declared) && declared > MAX_SHARE_BYTES) {
    return shareError('SHARE_TOO_LARGE', 'Session file is too large to share', 413)
  }
  return null
}

/** Post-parse 413 using UTF-8 bytes — `String.length` is UTF-16 code units and under-counts. */
export function checkSharePayloadSize(raw: string): Response | null {
  if (new TextEncoder().encode(raw).byteLength > MAX_SHARE_BYTES) {
    return shareError('SHARE_TOO_LARGE', 'Session file is too large to share', 413)
  }
  return null
}

// ---------------------------------------------------------------------------
// Best-effort per-IP sliding-window rate limiting.
//
// Pages Functions have no durable cross-request state: this Map lives in
// isolate memory and is neither global nor persistent. It throttles single
// sources hitting a warm isolate; the durable enforcement layer is a
// Cloudflare Rate Limiting rule (see apps/viewer/SECURITY.md §8).
// ---------------------------------------------------------------------------

const rateBuckets = new Map<string, number[]>()

/**
 * Returns 0 when the request is allowed, otherwise the number of seconds the
 * caller should wait before retrying.
 */
export function checkRateLimit(scope: 'create' | 'mutate', ip: string): number {
  const limit = scope === 'create' ? CREATE_RATE_LIMIT : MUTATION_RATE_LIMIT
  const now = Date.now()
  const key = `${scope}:${ip}`
  const windowStart = now - RATE_LIMIT_WINDOW_MS
  const hits = (rateBuckets.get(key) ?? []).filter((t) => t > windowStart)

  // Bound isolate memory under spray attacks with many distinct IPs.
  if (rateBuckets.size > 10_000 && !rateBuckets.has(key)) {
    for (const [k, v] of rateBuckets) {
      if (v.every((t) => t <= windowStart)) rateBuckets.delete(k)
    }
    if (rateBuckets.size > 20_000) rateBuckets.clear()
  }

  if (hits.length >= limit) {
    rateBuckets.set(key, hits)
    return Math.max(1, Math.ceil((hits[0]! + RATE_LIMIT_WINDOW_MS - now) / 1000))
  }
  hits.push(now)
  rateBuckets.set(key, hits)
  return 0
}

export function clientIp(request: Request): string {
  return request.headers.get('CF-Connecting-IP')?.trim() || 'unknown'
}

export function rateLimitResponse(scope: 'create' | 'mutate', request: Request): Response | null {
  const retryAfter = checkRateLimit(scope, clientIp(request))
  if (retryAfter <= 0) return null
  return shareError('RATE_LIMITED', 'Too many requests, please retry later', 429, {
    'Retry-After': String(retryAfter),
  })
}
