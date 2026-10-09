/**
 * Web UI session authentication.
 *
 * Cookie-based JWT session auth for the browser-served web UI.
 * - Login: verify password → issue signed JWT → set HttpOnly cookie
 * - OIDC: Pocket ID / Rox ID authorization-code + PKCE → same session cookie
 * - Validation: check cookie on every HTTP request + WebSocket upgrade
 * - Rate limiting: per-IP brute-force protection on /api/auth
 */

import { SignJWT, jwtVerify } from 'jose'
import {
  createHash,
  createPublicKey,
  randomBytes,
  verify as cryptoVerify,
} from 'node:crypto'

/**
 * Structural shape of a JWK parsed from a JWKS document. Kept local rather than
 * importing `node:crypto`'s `JsonWebKey` (not exported consistently across the
 * repo's toolchains) and index-signed so it stays assignable to the
 * `createPublicKey` JWK input under every tsconfig.
 */
interface JsonWebKey {
  kty?: string
  kid?: string
  use?: string
  alg?: string
  [key: string]: unknown
}

// ---------------------------------------------------------------------------
// JWT helpers (via jose library)
// ---------------------------------------------------------------------------

const JWT_EXPIRY_SECONDS = 86_400 // 24 hours

/** Fields embedded in a web UI session JWT. Password sessions only use `sub`. */
export interface JwtPayload {
  sub: string
  iat: number
  exp: number
  /** OIDC user email (present only for Rox ID / OIDC sessions). */
  email?: string
  /** OIDC display name. */
  name?: string
  /** OIDC preferred username. */
  username?: string
  /** OIDC issuer the session was established against. */
  issuer?: string
}

/** Optional identity to embed when minting a session token. */
export interface SessionClaims {
  sub?: string
  email?: string
  name?: string
  username?: string
  issuer?: string
}

export async function signJwt(payload: JwtPayload, secret: string): Promise<string> {
  const key = new TextEncoder().encode(secret)
  const claims: Record<string, unknown> = { sub: payload.sub }
  if (payload.email) claims.email = payload.email
  if (payload.name) claims.name = payload.name
  if (payload.username) claims.username = payload.username
  if (payload.issuer) claims.issuer = payload.issuer
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt(payload.iat)
    .setExpirationTime(payload.exp)
    .sign(key)
}

export async function verifyJwt(token: string, secret: string): Promise<JwtPayload | null> {
  try {
    const key = new TextEncoder().encode(secret)
    const { payload } = await jwtVerify(token, key, { algorithms: ['HS256'] })
    return {
      sub: payload.sub as string,
      iat: payload.iat as number,
      exp: payload.exp as number,
      ...(typeof payload.email === 'string' ? { email: payload.email } : {}),
      ...(typeof payload.name === 'string' ? { name: payload.name } : {}),
      ...(typeof payload.username === 'string' ? { username: payload.username } : {}),
      ...(typeof payload.issuer === 'string' ? { issuer: payload.issuer } : {}),
    }
  } catch {
    return null
  }
}

/**
 * Mint a web UI session token.
 *
 * The password login flow calls this with no claims (subject `webui`), exactly
 * as before. The OIDC flow passes the verified user so `/api/auth/me` can
 * surface the signed-in Rox ID identity.
 */
export async function createSessionToken(secret: string, claims: SessionClaims = {}): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  return signJwt({
    sub: claims.sub ?? 'webui',
    iat: now,
    exp: now + JWT_EXPIRY_SECONDS,
    email: claims.email,
    name: claims.name,
    username: claims.username,
    issuer: claims.issuer,
  }, secret)
}

// ---------------------------------------------------------------------------
// Cookie helpers
// ---------------------------------------------------------------------------

const SESSION_COOKIE_NAME = 'craft_session'

export function buildSessionCookie(jwt: string, secure: boolean): string {
  const parts = [
    `${SESSION_COOKIE_NAME}=${jwt}`,
    'HttpOnly',
    'SameSite=Strict',
    'Path=/',
    `Max-Age=${JWT_EXPIRY_SECONDS}`,
  ]
  if (secure) parts.push('Secure')
  return parts.join('; ')
}

export function buildLogoutCookie(secure = false): string {
  const parts = [
    `${SESSION_COOKIE_NAME}=`,
    'HttpOnly',
    'SameSite=Strict',
    'Path=/',
    'Max-Age=0',
  ]
  if (secure) parts.push('Secure')
  return parts.join('; ')
}

export function extractSessionCookie(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null
  for (const pair of cookieHeader.split(';')) {
    const [name, ...rest] = pair.trim().split('=')
    if (name === SESSION_COOKIE_NAME) return rest.join('=')
  }
  return null
}

// ---------------------------------------------------------------------------
// Password verification (argon2id via Bun.password)
// ---------------------------------------------------------------------------

let hashedPassword: string | null = null

/**
 * Hash the login password at startup. Must be called before any auth requests.
 * The hash is stored in memory — the raw password is not retained.
 */
export async function initPasswordHash(plaintext: string): Promise<void> {
  hashedPassword = await Bun.password.hash(plaintext, { algorithm: 'argon2id' })
}

/**
 * Verify a user-supplied password against the pre-hashed password.
 * Uses Bun's built-in argon2id verification (constant-time).
 */
export async function verifyPassword(input: string): Promise<boolean> {
  if (!hashedPassword) return false
  return Bun.password.verify(input, hashedPassword)
}

// ---------------------------------------------------------------------------
// Rate limiter (per-IP + global, sliding window)
// ---------------------------------------------------------------------------

interface RateLimitEntry {
  attempts: number
  windowStart: number
}

export class RateLimiter {
  private entries = new Map<string, RateLimitEntry>()
  private readonly maxAttempts: number
  private readonly windowMs: number
  /** Global counter — blocks all IPs after too many total failures (defeats IP spoofing). */
  private readonly maxGlobalAttempts: number
  private globalAttempts = 0
  private globalWindowStart = Date.now()

  constructor(maxAttempts = 5, windowMs = 60_000, maxGlobalAttempts = 20) {
    this.maxAttempts = maxAttempts
    this.windowMs = windowMs
    this.maxGlobalAttempts = maxGlobalAttempts
  }

  /** Returns true if the request should be allowed, false if rate-limited. */
  check(ip: string): boolean {
    const now = Date.now()

    // Reset global window if expired
    if (now - this.globalWindowStart > this.windowMs) {
      this.globalAttempts = 0
      this.globalWindowStart = now
    }

    // Global rate limit — blocks everyone if too many total attempts
    this.globalAttempts++
    if (this.globalAttempts > this.maxGlobalAttempts) return false

    // Per-IP rate limit
    const entry = this.entries.get(ip)

    if (!entry || now - entry.windowStart > this.windowMs) {
      this.entries.set(ip, { attempts: 1, windowStart: now })
      return true
    }

    entry.attempts++
    if (entry.attempts > this.maxAttempts) return false
    return true
  }

  /** Periodic cleanup of stale entries (call on a timer). */
  cleanup(): void {
    const now = Date.now()
    for (const [ip, entry] of this.entries) {
      if (now - entry.windowStart > this.windowMs * 2) {
        this.entries.delete(ip)
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Session validator (used by both HTTP and WebSocket)
// ---------------------------------------------------------------------------

export async function validateSession(
  cookieHeader: string | null,
  secret: string,
): Promise<JwtPayload | null> {
  const token = extractSessionCookie(cookieHeader)
  if (!token) return null
  return verifyJwt(token, secret)
}

// ---------------------------------------------------------------------------
// OIDC (Pocket ID / Rox ID) — discovery, PKCE, JWKS and id_token verification
// ---------------------------------------------------------------------------
//
// Implemented with `node:crypto` only (no new dependencies). The shared-password
// flow above is unaffected: every helper here is opt-in and gated by whether an
// OIDC issuer is configured.

/** Resolved OIDC configuration for the web UI. */
export interface OidcConfig {
  /** IdP issuer, normalized without a trailing slash. Used for discovery + `iss` check. */
  issuer: string
  clientId: string
  /** Optional confidential-client secret (public PKCE clients omit it). */
  clientSecret?: string
  /** Public base URL of this web UI, without a trailing slash. */
  publicUrl: string
}

/** `iss`/`aud`/`exp`/`nonce`-verified OIDC user identity. */
export interface OidcUser {
  sub: string
  email?: string
  name?: string
  username?: string
}

/** Discovery document fields the login/callback flow relies on. */
export interface OidcDiscovery {
  issuer: string
  authorization_endpoint: string
  token_endpoint: string
  jwks_uri: string
}

/** Transient per-login values kept between /api/auth/login and /api/auth/callback. */
export interface OidcLoginState {
  codeVerifier: string
  nonce: string
}

const OIDC_CACHE_TTL_MS = 300_000
const discoveryCache = new Map<string, { value: OidcDiscovery; fetchedAt: number }>()
const jwksCache = new Map<string, { keys: JsonWebKey[]; fetchedAt: number }>()

/** Reset discovery/JWKS caches (test seam). */
export function resetOidcCaches(): void {
  discoveryCache.clear()
  jwksCache.clear()
}

/** Non-empty string field from an untrusted claims/discovery record. */
function readNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/**
 * Read OIDC configuration from the environment.
 * Returns null when no issuer is configured, which keeps the password flow intact.
 */
export function readOidcConfigFromEnv(env: Record<string, string | undefined> = process.env): OidcConfig | null {
  const issuer = env.ROX_WEBUI_OIDC_ISSUER?.trim()
  const clientId = env.ROX_WEBUI_OIDC_CLIENT_ID?.trim()
  const publicUrl = env.ROX_WEBUI_PUBLIC_URL?.trim()
  if (!issuer || !clientId || !publicUrl) return null
  const clientSecret = env.ROX_WEBUI_OIDC_CLIENT_SECRET?.trim()
  return {
    issuer: issuer.replace(/\/+$/, ''),
    clientId,
    publicUrl: publicUrl.replace(/\/+$/, ''),
    ...(clientSecret ? { clientSecret } : {}),
  }
}

/** Fetch (and cache) the OIDC discovery document for an issuer. */
export async function discoverOidc(
  issuer: string,
  options: { fetchImpl?: typeof fetch; ttlMs?: number; now?: number } = {},
): Promise<OidcDiscovery> {
  const fetchImpl = options.fetchImpl ?? fetch
  const ttlMs = options.ttlMs ?? OIDC_CACHE_TTL_MS
  const now = options.now ?? Date.now()
  const cached = discoveryCache.get(issuer)
  if (cached && now - cached.fetchedAt < ttlMs) return cached.value

  const url = `${issuer.replace(/\/+$/, '')}/.well-known/openid-configuration`
  const res = await fetchImpl(url, { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`OIDC discovery failed (${res.status})`)
  const body: unknown = await res.json()
  if (typeof body !== 'object' || body === null) throw new Error('OIDC discovery returned a non-object')
  const authorization = readNonEmptyString('authorization_endpoint' in body ? body.authorization_endpoint : undefined)
  const token = readNonEmptyString('token_endpoint' in body ? body.token_endpoint : undefined)
  const jwks = readNonEmptyString('jwks_uri' in body ? body.jwks_uri : undefined)
  if (!authorization || !token || !jwks) throw new Error('OIDC discovery is missing required endpoints')
  const value: OidcDiscovery = {
    issuer: ('issuer' in body ? readNonEmptyString(body.issuer) : undefined) ?? issuer,
    authorization_endpoint: authorization,
    token_endpoint: token,
    jwks_uri: jwks,
  }
  discoveryCache.set(issuer, { value, fetchedAt: now })
  return value
}

function isRsaSignatureJwk(value: unknown): value is JsonWebKey {
  if (typeof value !== 'object' || value === null) return false
  if (!('kty' in value) || value.kty !== 'RSA') return false
  if ('use' in value && value.use !== undefined && value.use !== 'sig') return false
  return true
}

/** Fetch (and cache) the JWKS document, keeping only RSA signature keys. */
export async function fetchJwks(
  jwksUri: string,
  options: { fetchImpl?: typeof fetch; ttlMs?: number; now?: number } = {},
): Promise<JsonWebKey[]> {
  const fetchImpl = options.fetchImpl ?? fetch
  const ttlMs = options.ttlMs ?? OIDC_CACHE_TTL_MS
  const now = options.now ?? Date.now()
  const cached = jwksCache.get(jwksUri)
  if (cached && now - cached.fetchedAt < ttlMs) return cached.keys

  const res = await fetchImpl(jwksUri, { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`JWKS fetch failed (${res.status})`)
  const body: unknown = await res.json()
  if (typeof body !== 'object' || body === null || !('keys' in body)) throw new Error('JWKS document has no keys')
  const rawKeys = body.keys
  if (!Array.isArray(rawKeys)) throw new Error('JWKS document has no keys')
  const keys = rawKeys.filter(isRsaSignatureJwk)
  if (keys.length === 0) throw new Error('JWKS document has no usable RSA keys')
  jwksCache.set(jwksUri, { keys, fetchedAt: now })
  return keys
}

/** Generate a PKCE verifier + S256 challenge (base64url, no padding). */
export function createPkcePair(): { codeVerifier: string; codeChallenge: string } {
  const codeVerifier = randomBytes(32).toString('base64url')
  const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url')
  return { codeVerifier, codeChallenge }
}

/** Random URL-safe token used for OIDC `state` and `nonce`. */
export function createRandomToken(bytes = 16): string {
  return randomBytes(bytes).toString('base64url')
}

function decodeJwtSegment(segment: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'))
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Malformed id_token segment')
  }
  return parsed as Record<string, unknown>
}

function selectSigningKey(keys: JsonWebKey[], kid: string | undefined): JsonWebKey {
  if (kid) {
    const match = keys.find(key => key.kid === kid)
    if (!match) throw new Error('No JWKS key matches the id_token kid')
    return match
  }
  if (keys.length === 1) return keys[0]!
  throw new Error('id_token has no kid and JWKS is ambiguous')
}

/**
 * Verify an RS256 id_token's signature and claims using only `node:crypto`.
 * Throws on any mismatch; callers render an honest error page instead of a stack.
 */
export function verifyOidcIdToken(
  idToken: string,
  options: { jwks: JsonWebKey[]; issuer: string; clientId: string; nonce: string; nowSeconds?: number },
): OidcUser {
  const parts = idToken.split('.')
  if (parts.length !== 3) throw new Error('Malformed id_token')
  const [headerSegment, payloadSegment, signatureSegment] = parts

  const header = decodeJwtSegment(headerSegment!)
  if (header.alg !== 'RS256') throw new Error('Unsupported id_token algorithm')
  const jwk = selectSigningKey(options.jwks, typeof header.kid === 'string' ? header.kid : undefined)
  const publicKey = createPublicKey(
    { key: jwk, format: 'jwk' } as unknown as Parameters<typeof createPublicKey>[0],
  )
  const signed = Buffer.from(`${headerSegment}.${payloadSegment}`)
  const signatureValid = cryptoVerify('RSA-SHA256', signed, publicKey, Buffer.from(signatureSegment!, 'base64url'))
  if (!signatureValid) throw new Error('Invalid id_token signature')

  const claims = decodeJwtSegment(payloadSegment!)
  if (claims.iss !== options.issuer) throw new Error('Invalid id_token issuer')
  const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud]
  if (!audience.includes(options.clientId)) throw new Error('Invalid id_token audience')
  const now = options.nowSeconds ?? Math.floor(Date.now() / 1000)
  if (typeof claims.exp !== 'number' || claims.exp <= now - 60) throw new Error('Expired id_token')
  if (typeof claims.nonce !== 'string' || claims.nonce !== options.nonce) throw new Error('Invalid id_token nonce')
  if (typeof claims.sub !== 'string' || claims.sub.length === 0) throw new Error('Missing id_token subject')

  const email = readNonEmptyString(claims.email)
  const name = readNonEmptyString(claims.name)
  const username = readNonEmptyString(claims.preferred_username)
  return {
    sub: claims.sub,
    ...(email ? { email } : {}),
    ...(name ? { name } : {}),
    ...(username ? { username } : {}),
  }
}