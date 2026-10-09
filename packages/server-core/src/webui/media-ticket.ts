/**
 * Short-lived signed tickets for media URLs.
 *
 * The SPA serves the browser's image/audio/video elements from `/media/...`
 * under a strict Content-Security-Policy. Rather than relax the policy (no
 * `data:`/`blob:` additions, no wildcard) or place the reusable session
 * credential in the URL, the browser asks an authenticated endpoint to mint a
 * capability URL that carries only a bounded, signed ticket.
 *
 * Modelled on OpenClaw `src/gateway/assistant-media-policy.ts` (assistant-media
 * `mediaTicket`, control-ui-csp row b1.5): a versioned
 * `v1.<payload>.<signature>` string, an HMAC over the encoded payload, and a
 * constant-time comparison on the verify path.
 *
 * Design choices:
 * - **Reusable within TTL** (not single-use). A browser media element issues
 *   several requests for one source (initial GET, `Range` probes, re-render
 *   after a view scroll), so a one-shot ticket would break legitimate playback.
 *   The window is kept short ({@link MEDIA_TICKET_DEFAULT_TTL_MS}) and the
 *   ticket is bound to the exact session, so replay by another actor is refused.
 * - **HMAC key from the existing secret fabric.** The key is derived from the
 *   handler's `secret` (ROX_SERVER_TOKEN) via domain separation — never a
 *   hard-coded constant.
 * - **Session binding.** The payload carries a digest of the session cookie
 *   token; verification compares it against the presented cookie, so a ticket
 *   minted for one session is rejected for another.
 * - **Uniform failure.** Every rejection returns `null` (the caller maps it to a
 *   single 403 body) so a caller cannot distinguish expired vs. tampered vs.
 *   cross-session tickets.
 *
 * The ticket value is a bearer-capability and MUST NOT be logged.
 */

import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { extractSessionCookie } from './auth'
import { resolveWebuiFile } from './static-file'

/** URL prefix owned by media-ticket authorisation. */
export const MEDIA_PATH_PREFIX = '/media/'

/** Default ticket lifetime. Short enough that a leaked URL is near-worthless. */
export const MEDIA_TICKET_DEFAULT_TTL_MS = 5 * 60_000
/** Hard ceiling; a longer requested TTL is clamped to this. */
export const MEDIA_TICKET_MAX_TTL_MS = 15 * 60_000

const TICKET_VERSION = 'v1'
const TICKET_KEY_DOMAIN = 'rox.webui.media-ticket.v1'

export interface MediaTicketPayload {
  /** Media path the ticket authorises (e.g. `/media/pic.png`). */
  path: string
  /** Expiry, epoch milliseconds. */
  exp: number
  /** Digest of the session cookie token the ticket is bound to. */
  sid: string
}

export interface MediaTicket {
  ticket: string
  expiresAt: number
}

/**
 * Derive the media-ticket HMAC key from the server secret. Domain-separated so
 * the same secret used for session JWTs never signs a media ticket with the
 * same key material.
 */
export function deriveMediaTicketKey(secret: string): Buffer {
  return createHmac('sha256', secret).update(TICKET_KEY_DOMAIN, 'utf8').digest()
}

/**
 * Fingerprint of the session credential presented on a request. `null` when no
 * session cookie is present — the ticket cannot be bound, so verification fails.
 */
export function mediaSessionFingerprint(cookieHeader: string | null): string | null {
  const token = extractSessionCookie(cookieHeader)
  if (!token) return null
  return createHash('sha256').update(token, 'utf8').digest('base64url')
}

/**
 * Resolve a `/media/...` URL path to a file inside `mediaDir`, reusing the
 * static-file containment check (traversal + NUL rejection).
 */
export function resolveMediaFile(mediaDir: string, urlPath: string): string | null {
  if (!urlPath.startsWith(MEDIA_PATH_PREFIX)) return null
  // Strip the prefix but keep a single leading slash for resolveWebuiFile.
  const relative = urlPath.slice(MEDIA_PATH_PREFIX.length - 1)
  if (!relative || relative === '/') return null
  return resolveWebuiFile(mediaDir, relative)
}

/**
 * Mint a media ticket bound to `path` and `sessionFingerprint`.
 *
 * `ttlMs` is clamped to `1..MEDIA_TICKET_MAX_TTL_MS`.
 */
export function createMediaTicket(params: {
  secret: string
  path: string
  sessionFingerprint: string
  now?: number
  ttlMs?: number
}): MediaTicket {
  const now = params.now ?? Date.now()
  const requestedTtl = params.ttlMs ?? MEDIA_TICKET_DEFAULT_TTL_MS
  const ttl = Math.max(1, Math.min(requestedTtl, MEDIA_TICKET_MAX_TTL_MS))
  const payload: MediaTicketPayload = {
    path: params.path,
    exp: now + ttl,
    sid: params.sessionFingerprint,
  }
  const encodedPayload = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  // The signature is an HMAC over the encoded payload — mint and verify below
  // must use the identical key and encoding, so this expression is repeated.
  const signature = createHmac('sha256', deriveMediaTicketKey(params.secret))
    .update(encodedPayload, 'utf8')
    .digest('base64url')
  return {
    ticket: `${TICKET_VERSION}.${encodedPayload}.${signature}`,
    expiresAt: payload.exp,
  }
}

/**
 * Verify a media ticket against the requested path and presented session.
 * Returns the payload when valid, otherwise `null` (no detail — see module note).
 */
export function verifyMediaTicket(
  ticket: string | null,
  params: {
    secret: string
    path: string
    sessionFingerprint: string | null
    now?: number
  },
): MediaTicketPayload | null {
  if (typeof ticket !== 'string') return null
  const parts = ticket.split('.')
  if (parts.length !== 3 || parts[0] !== TICKET_VERSION) return null
  const encodedPayload = parts[1]
  const signature = parts[2]
  if (!encodedPayload || !signature) return null

  const expected = createHmac('sha256', deriveMediaTicketKey(params.secret))
    .update(encodedPayload, 'utf8')
    .digest('base64url')
  // Timing-safe comparison over fixed-length digests (mirrors OpenClaw
  // `src/security/secret-equal.ts`): neither content nor length leaks via timing.
  if (
    !timingSafeEqual(
      createHash('sha256').update(signature, 'utf8').digest(),
      createHash('sha256').update(expected, 'utf8').digest(),
    )
  ) {
    return null
  }

  let payload: Partial<MediaTicketPayload>
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as Partial<MediaTicketPayload>
  } catch {
    return null
  }

  const now = params.now ?? Date.now()
  if (
    typeof payload.path !== 'string'
    || typeof payload.exp !== 'number'
    || !Number.isFinite(payload.exp)
    || typeof payload.sid !== 'string'
    || payload.exp < now
    || payload.path !== params.path
    || params.sessionFingerprint === null
    || payload.sid !== params.sessionFingerprint
  ) {
    return null
  }
  return payload as MediaTicketPayload
}