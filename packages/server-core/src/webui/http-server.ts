/**
 * Web UI HTTP handler and standalone server.
 *
 * The core logic lives in `createWebuiHandler()` which returns a web-standard
 * fetch handler `(Request) => Promise<Response>`. This handler can be:
 *
 * 1. **Embedded** — attached to the WsRpcServer's HTTPS server via the
 *    node-adapter so that HTTP and WSS share a single port.
 * 2. **Standalone** — wrapped in `Bun.serve()` via `startWebuiHttpServer()`
 *    for separate-port deployments or development.
 */

import { join, extname } from 'node:path'
import {
  RateLimiter,
  initPasswordHash,
  verifyPassword,
  createSessionToken,
  validateSession,
  buildSessionCookie,
  buildLogoutCookie,
  buildOidcStateCookie,
  buildClearedOidcStateCookie,
  extractOidcStateCookie,
  constantTimeEqual,
  readOidcConfigFromEnv,
  discoverOidc,
  verifyOidcIdTokenWithJwks,
  createPkcePair,
  createRandomToken,
  type OidcConfig,
  type OidcLoginState,
  HandoffTokenStore,
} from './auth'
import { withWebuiSecurityHeaders } from './csp'
import { resolveWebuiFile } from './static-file'
import {
  MEDIA_PATH_PREFIX,
  createMediaTicket,
  mediaSessionFingerprint,
  resolveMediaFile,
  verifyMediaTicket,
} from './media-ticket'
import { generateCallbackPage } from '@rox/shared/auth'
import type { PlatformServices } from '../runtime/platform'

// Re-exported for the existing WebUI callers/tests that import it from here.
export { resolveWebuiFile } from './static-file'

// ---------------------------------------------------------------------------
// MIME types for static file serving
// ---------------------------------------------------------------------------

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.webp': 'image/webp',
  '.map': 'application/json',
}

function getMimeType(path: string): string {
  return MIME_TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream'
}

function getForwardedValue(req: Request, key: 'proto' | 'host'): string | null {
  const forwarded = req.headers.get('forwarded')
  if (!forwarded) return null

  const match = forwarded.match(new RegExp(`${key}="?([^;,"]+)"?`, 'i'))
  return match?.[1]?.trim() || null
}

function getRequestProto(req: Request): string {
  return req.headers.get('x-forwarded-proto')?.split(',')[0]?.trim()
    || getForwardedValue(req, 'proto')
    || new URL(req.url).protocol.replace(/:$/, '')
}

function getRequestHost(req: Request): string | null {
  return req.headers.get('x-forwarded-host')?.split(',')[0]?.trim()
    || getForwardedValue(req, 'host')
    || req.headers.get('host')
}

function formatHostWithPort(host: string, port: number): string {
  try {
    const parsed = new URL(`http://${host}`)
    const hostname = parsed.hostname.includes(':') ? `[${parsed.hostname}]` : parsed.hostname
    return `${hostname}:${port}`
  } catch {
    const withoutPort = host.replace(/:\d+$/, '')
    return `${withoutPort}:${port}`
  }
}

/** Public origin of a request, honoring trusted proxy headers (see getRequestProto/Host). */
function getRequestOrigin(req: Request): string | null {
  const host = getRequestHost(req)
  if (host) return `${getRequestProto(req)}://${host}`
  try {
    return new URL(req.url).origin
  } catch {
    return null
  }
}

/**
 * CSRF guard for cookie-authenticated, state-changing endpoints.
 *
 * Browsers send `Origin` on same-origin POSTs, so a cross-site form/fetch is
 * rejected on a mismatch. When `Origin` is absent (non-browser clients) the
 * `Sec-Fetch-Site` metadata is consulted if present; a request with neither
 * header is still gated by the session cookie and is treated as a local
 * operator call.
 */
function isSameOriginRequest(req: Request): boolean {
  const expected = getRequestOrigin(req)
  if (!expected) return false
  const origin = req.headers.get('origin')
  if (origin) return origin === expected
  const fetchSite = req.headers.get('sec-fetch-site')
  if (fetchSite === 'cross-site' || fetchSite === 'same-site') return false
  return true
}

/**
 * Self-contained pairing page served for `GET /handoff` (browser navigation,
 * no `X-Handoff-Token` header).
 *
 * The SPA shell cannot be used here: its `/assets/*` bundle sits behind the
 * session gate, so a cookie-less device — the whole point of pairing — would
 * never run the bootstrap that redeems the fragment. This minimal document
 * ships one inline script (its SHA-256 is folded into the strict CSP by
 * `withWebuiSecurityHeaders`, so no `'unsafe-inline'` is needed) that reads the
 * fragment (never sent to the server), redeems the token via the
 * `X-Handoff-Token` header, and then replaces the URL with `/`. No `/assets/*`
 * request is made, so nothing unauthenticated is exposed.
 */
export function renderHandoffPage(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Rox - Pairing</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    background-color: #f7f7f7;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  }
  .card {
    max-width: 420px;
    padding: 24px 28px;
    border-radius: 8px;
    text-align: center;
    background-color: #ffffff;
    box-shadow: rgba(0, 0, 0, 0.12) 0 0 0 1px, rgba(0, 0, 0, 0.06) 0 4px 8px -2px;
  }
  h1 { font-size: 16px; font-weight: 600; color: #1a1a1a; margin-bottom: 12px; }
  #handoff-status { font-size: 14px; color: rgba(0, 0, 0, 0.6); }
  #handoff-status[data-state="error"] { color: #a14040; }
  noscript { display: block; margin-top: 12px; font-size: 13px; color: #a14040; }
  @media (prefers-color-scheme: dark) {
    body { background-color: #1a1a1a; }
    .card { background-color: #242424; box-shadow: rgba(255, 255, 255, 0.12) 0 0 0 1px; }
    h1 { color: #f2f2f2; }
    #handoff-status { color: rgba(255, 255, 255, 0.6); }
    #handoff-status[data-state="error"] { color: #e88080; }
  }
</style>
</head>
<body>
<main class="card">
  <h1>Pairing device</h1>
  <p id="handoff-status" role="status" aria-live="polite">Redeeming the pairing link&hellip;</p>
  <noscript>JavaScript is required to complete pairing.</noscript>
</main>
<script>
(function () {
  var status = document.getElementById('handoff-status');
  function fail(message) {
    if (status) { status.setAttribute('data-state', 'error'); status.textContent = message; }
  }
  var raw = window.location.hash.replace(/^#/, '');
  var token = raw.indexOf('handoff=') === 0 ? raw.slice(8) : raw;
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(token)) {
    fail('This pairing link is missing its token.');
    return;
  }
  fetch('/handoff', {
    method: 'GET',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { 'X-Handoff-Token': token },
  }).then(function (response) {
    if (!response.ok) {
      fail(response.status === 401
        ? 'This pairing link is invalid or has expired.'
        : 'Pairing failed. Please try again.');
      return;
    }
    window.location.replace('/');
  }).catch(function () {
    fail('Pairing failed. Please try again.');
  });
})();
</script>
</body>
</html>`
}

export function shouldUseSecureCookies(req: Request, secureCookies?: boolean): boolean {
  if (secureCookies != null) return secureCookies
  return getRequestProto(req) === 'https'
}

export interface ResolveWebSocketUrlOptions {
  publicWsUrl?: string
  wsProtocol: 'ws' | 'wss'
  wsPort: number
}

export function resolveWebSocketUrl(
  req: Request,
  { publicWsUrl, wsProtocol, wsPort }: ResolveWebSocketUrlOptions,
): string {
  if (publicWsUrl) return publicWsUrl

  const host = getRequestHost(req)
  if (host) {
    return `${wsProtocol}://${formatHostWithPort(host, wsPort)}`
  }

  return `${wsProtocol}://127.0.0.1:${wsPort}`
}

// ---------------------------------------------------------------------------
// Handler options (shared between embedded and standalone modes)
// ---------------------------------------------------------------------------

const OIDC_STATE_TTL_MS = 10 * 60_000

/**
 * Hard cap on concurrent pending OIDC login records. `GET /api/auth/login` is
 * unauthenticated and previously inserted one (verifier+nonce) record per
 * request with only a 10-minute TTL sweep, so an attacker could grow the map
 * without bound (memory DoS). Beyond this maximum the oldest record is evicted
 * (Map iteration is insertion-ordered) so a legitimate in-flight login is only
 * dropped under sustained abuse.
 */
const OIDC_MAX_PENDING_LOGINS = 256

/** Lifetime of the one-time OIDC `state` cookie — matches the server-side TTL. */
const OIDC_STATE_COOKIE_MAX_AGE_SECONDS = Math.floor(OIDC_STATE_TTL_MS / 1000)

/**
 * Minimal, honest Russian error page for failed Rox ID logins. No stack traces
 * or internal error identifiers leak to the browser.
 */
function renderLoginErrorPage(message: string): string {
  const escapes: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }
  const escaped = message.replace(/[&<>"']/g, char => escapes[char] ?? char)
  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Rox — Ошибка входа</title>
  <style>
    body { font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: #f8f8fa; color: #1a1a2e; padding: 16px; }
    .card { max-width: 28rem; width: 100%; padding: 32px; background: #fff; border: 1px solid #e4e4e8; border-radius: 20px; text-align: center; box-shadow: 0 32px 96px rgba(41, 25, 63, 0.14); }
    h1 { font-size: 20px; font-weight: 600; margin: 0 0 12px; }
    p { font-size: 14px; line-height: 1.5; color: rgba(26, 26, 46, 0.64); margin: 0 0 20px; }
    a { display: inline-block; padding: 10px 18px; font-size: 14px; font-weight: 500; color: #fff; background: #6d5dfc; border-radius: 8px; text-decoration: none; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Не удалось войти</h1>
    <p>${escaped}</p>
    <a href="/login">Вернуться к входу</a>
  </div>
</body>
</html>`
}

function loginErrorResponse(message: string, status: number, extraHeaders?: Record<string, string>): Response {
  return new Response(renderLoginErrorPage(message), {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8', ...extraHeaders },
  })
}

/** Dependencies for the /api/oauth/callback HTTP route (server-side OAuth completion). */
export interface OAuthCallbackDeps {
  flowStore: { getByState: (state: string) => any; remove: (state: string) => void }
  credManager: { exchangeAndStore: (...args: any[]) => Promise<any> }
  sessionManager: { completeAuthRequest: (...args: any[]) => Promise<void> }
  pushSourcesChanged: (workspaceId: string) => void
}

export interface WebuiHandlerOptions {
  /** Path to built web UI dist/ directory. */
  webuiDir: string
  /** Secret used to sign JWTs — typically ROX_SERVER_TOKEN (CRAFT_SERVER_TOKEN still works). */
  secret: string
  /** Optional separate web UI password. Falls back to `secret` for verification. */
  password?: string
  /** Explicit Secure-cookie override. When unset, infer from the request / proxy headers. */
  secureCookies?: boolean
  /** Optional browser-facing WebSocket URL override for reverse-proxy deployments. */
  publicWsUrl?: string
  /**
   * OIDC (Pocket ID / Rox ID) configuration. When omitted, the handler reads
   * ROX_WEBUI_OIDC_ISSUER / ROX_WEBUI_OIDC_CLIENT_ID / ROX_WEBUI_OIDC_CLIENT_SECRET /
   * ROX_WEBUI_PUBLIC_URL from the environment. When neither is present the shared
   * password login behaves exactly as before.
   */
  oidc?: OidcConfig
  /**
   * When OIDC is configured the shared-password route is disabled (404) so
   * enabling Rox ID actually removes master-token access. Set this to `true`
   * (or `ROX_WEBUI_PASSWORD_LOGIN=1` in the environment) to keep the residual
   * password path as a deliberate operator choice. Ignored when OIDC is unset.
   */
  allowPasswordLogin?: boolean
  /** RPC WebSocket protocol used when building a browser-facing fallback URL. */
  wsProtocol: 'ws' | 'wss'
  /** RPC WebSocket port used when building a browser-facing fallback URL. */
  wsPort: number
  /**
   * Extra http(s) origins allowed for cookie-authenticated WebSocket upgrades
   * (`CRAFT_WEBUI_ALLOWED_ORIGINS`). Each origin is admitted to the served
   * document's `connect-src` as an explicit ws(s) origin — never as a bare
   * scheme source.
   */
  allowedWebUiOrigins?: readonly string[]
  /** Health check function (injected from existing server handler). */
  getHealthCheck: () => { status: string }
  /** Logger. */
  logger: PlatformServices['logger']
  /** OAuth callback deps — when provided, enables /api/oauth/callback route. */
  oauthCallbackDeps?: OAuthCallbackDeps
  /**
   * Trusted proxy IPs. When the socket IP is in this list, proxy headers
   * (x-forwarded-for, x-real-ip) are used as the rate-limit key.
   * When empty/unset, proxy headers are ignored.
   */
  trustedProxies?: string[]
  /**
   * Direct client IP from the socket. Used when proxy headers are untrusted.
   * Standalone Bun.serve wires this to `server.requestIP(req)`.
   */
  resolveClientIp?: (req: Request) => string | null
  /**
   * Lifetime of a single-use pairing handoff token. Defaults to 120 s; the
   * accepted range is 1..120 s (see `HandoffTokenStore`).
   */
  handoffTtlMs?: number
  /**
   * Directory whose files are served under `/media/...` behind short-lived
   * signed tickets (see `./media-ticket`). Defaults to `<webuiDir>/media`.
   */
  mediaDir?: string
}

/** Request body for `POST /media/ticket`. */
export interface MediaTicketRequest {
  /** Server-relative media path, e.g. `/media/pic.png`. */
  path: string
}

/** Response body for `POST /media/ticket`. */
export interface MediaTicketResponse {
  /** Capability URL (`<path>?ticket=<ticket>`) — the ticket must not be logged. */
  url: string
  expiresAt: number
}

// ---------------------------------------------------------------------------
// Handler factory — the core request handler
// ---------------------------------------------------------------------------

export interface WebuiHandler {
  /** Web-standard fetch handler. */
  fetch: (req: Request) => Promise<Response>
  /** Call on shutdown to release timers. */
  dispose: () => void
  /** Inject OAuth callback deps after bootstrap (lazy wiring). */
  setOAuthCallbackDeps: (deps: OAuthCallbackDeps) => void
  /**
   * Mint a single-use pairing handoff token for this handler's store. The
   * caller builds the pairing URL (`<origin>/handoff#<token>`) and must treat
   * the token as a one-time secret: it is never logged or placed in a query.
   */
  createHandoffToken: () => { token: string; expiresAt: number }
}

/**
 * Create a web-standard fetch handler for the WebUI.
 *
 * This handler can be used directly with `Bun.serve({ fetch })`,
 * or adapted for Node's HTTP server via `nodeHttpAdapter()`.
 */
export function createWebuiHandler(options: WebuiHandlerOptions): WebuiHandler {
  const {
    webuiDir,
    secret,
    password,
    secureCookies,
    publicWsUrl,
    wsProtocol,
    wsPort,
    getHealthCheck,
    logger,
    trustedProxies,
    resolveClientIp,
  } = options

  const mediaDir = options.mediaDir ?? join(webuiDir, 'media')

  const rateLimiter = new RateLimiter(5, 60_000)
  // OIDC is opt-in: explicit option wins, otherwise the ROX_WEBUI_* environment.
  const oidc = options.oidc ?? readOidcConfigFromEnv()
  const authMode: 'password' | 'oidc' = oidc ? 'oidc' : 'password'
  const pendingOidcLogins = new Map<string, OidcLoginState & { createdAt: number }>()
  const cleanupTimer = setInterval(() => {
    rateLimiter.cleanup()
    const cutoff = Date.now() - OIDC_STATE_TTL_MS
    for (const [state, pending] of pendingOidcLogins) {
      if (pending.createdAt < cutoff) pendingOidcLogins.delete(state)
    }
  }, 120_000)

  // With OIDC enabled the shared-password route is disabled unless explicitly
  // opted in, so Rox ID actually replaces master-token access.
  const allowPasswordLogin = options.allowPasswordLogin
    ?? process.env.ROX_WEBUI_PASSWORD_LOGIN === '1'
  // OIDC public URLs over https always get Secure cookies; header-based
  // inference stays in play only for http (e.g. local deployments).
  const oidcPublicUrlIsHttps = oidc ? /^https:/i.test(oidc.publicUrl) : false
  if (oidc && !oidcPublicUrlIsHttps) {
    logger.warn('[webui] OIDC public URL is not https; session cookies follow request scheme inference')
  }

  const loginPassword = password || secret
  const trustedProxySet = new Set(trustedProxies ?? [])

  // Explicit cross-origin WebSocket endpoints admitted to `connect-src`.
  // Bare `ws:`/`wss:` scheme sources are never emitted (they authorize any
  // host); same-origin connections are covered by `'self'`.
  const connectSrcOrigins = [
    ...(publicWsUrl ? [publicWsUrl] : []),
    ...(options.allowedWebUiOrigins ?? []),
  ]

  // Hash the login password at startup (async, but resolves before first auth attempt in practice)
  const passwordReady = initPasswordHash(loginPassword)

  // Single-use pairing handoff tokens (hashed at rest, TTL-bounded).
  const handoffStore = new HandoffTokenStore(options.handoffTtlMs)
  const handoffCleanupTimer = setInterval(() => handoffStore.sweep(), 30_000)

  /** Extract client IP — only trusts proxy headers when the socket IP is a configured proxy. */
  function getClientIp(req: Request): string {
    const socketIp = resolveClientIp?.(req) ?? null
    if (trustedProxySet.size > 0 && socketIp && trustedProxySet.has(socketIp)) {
      return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
        ?? req.headers.get('x-real-ip')
        ?? socketIp
    }
    return socketIp ?? 'direct'
  }

  // NOTE: named `handleRequest`, not `fetch` — a local binding named `fetch`
  // would shadow the global `fetch` used for the OIDC token exchange below.
  async function handleRequest(req: Request): Promise<Response> {
    const url = new URL(req.url)
    const path = url.pathname
    const useSecureCookies = oidcPublicUrlIsHttps || shouldUseSecureCookies(req, secureCookies)

    // ── Pairing handoff (token only from a header; never from the URL) ──
    if (path === '/handoff' && req.method === 'GET') {
      const token = req.headers.get('x-handoff-token')
      if (!token) {
        // Browser navigation to the pairing link: serve the self-contained
        // handoff page. The SPA shell is unusable here — its bundle lives
        // behind this handler's own session gate — so the page redeems the
        // fragment (never sent to the server) with its inline script.
        const accept = req.headers.get('accept') ?? ''
        if (accept.includes('text/html')) {
          return new Response(renderHandoffPage(), {
            status: 200,
            headers: {
              'Content-Type': 'text/html; charset=utf-8',
              'Cache-Control': 'no-store',
            },
          })
        }
        return Response.json({ error: 'Handoff token required' }, { status: 400 })
      }

      const result = handoffStore.redeem(token)
      if (result !== 'ok') {
        logger.warn(`[webui] Handoff redemption rejected (${result})`)
        return Response.json(
          { error: result === 'expired' ? 'Handoff token expired' : 'Invalid handoff token' },
          { status: 401, headers: { 'Cache-Control': 'no-store' } },
        )
      }

      const jwt = await createSessionToken(secret)
      logger.info('[webui] Handoff token redeemed')
      return Response.json({ ok: true }, {
        status: 200,
        headers: {
          'Set-Cookie': buildSessionCookie(jwt, useSecureCookies),
          'Cache-Control': 'no-store',
        },
      })
    }

    // ── Mint a pairing link (authenticated operator only) ──
    // Requires a valid session cookie AND a same-origin request: the token is
    // a bearer credential for one pairing, so a CSRF'd cross-site mint could
    // hand it to an attacker. The URL carries the token in the fragment (never
    // a query string) and is returned only in this authenticated response.
    if (path === '/handoff/mint' && req.method === 'POST') {
      const mintSession = await validateSession(req.headers.get('cookie'), secret)
      if (!mintSession) {
        return Response.json({ error: 'Unauthorized' }, { status: 401, headers: { 'Cache-Control': 'no-store' } })
      }
      if (!isSameOriginRequest(req)) {
        logger.warn('[webui] Rejected cross-origin handoff mint request')
        return Response.json({ error: 'Cross-origin request rejected' }, { status: 403, headers: { 'Cache-Control': 'no-store' } })
      }
      const origin = getRequestOrigin(req)
      if (!origin) {
        return Response.json({ error: 'Unable to determine request origin' }, { status: 400, headers: { 'Cache-Control': 'no-store' } })
      }
      const { token, expiresAt } = handoffStore.mint()
      logger.info('[webui] Handoff token minted')
      return Response.json(
        { url: `${origin}/handoff#${token}`, expiresAt },
        { status: 200, headers: { 'Cache-Control': 'no-store' } },
      )
    }

    // ── Mint a media ticket (authenticated operator only) ──
    // Media elements load `/media/...?ticket=…`; the ticket is a short-lived
    // capability bound to this session and path, so the SPA never has to relax
    // CSP or place the reusable credential in a media URL. Mirrors the handoff
    // mint above: session cookie + same-origin required. The ticket is returned
    // once and must never be logged.
    if (path === '/media/ticket' && req.method === 'POST') {
      const mintSession = await validateSession(req.headers.get('cookie'), secret)
      if (!mintSession) {
        return Response.json({ error: 'Unauthorized' }, { status: 401, headers: { 'Cache-Control': 'no-store' } })
      }
      if (!isSameOriginRequest(req)) {
        logger.warn('[webui] Rejected cross-origin media ticket mint request')
        return Response.json({ error: 'Cross-origin request rejected' }, { status: 403, headers: { 'Cache-Control': 'no-store' } })
      }
      let body: MediaTicketRequest
      try {
        body = await req.json() as MediaTicketRequest
      } catch {
        return Response.json({ error: 'Invalid request body' }, { status: 400, headers: { 'Cache-Control': 'no-store' } })
      }
      if (typeof body?.path !== 'string' || !resolveMediaFile(mediaDir, body.path)) {
        return Response.json({ error: 'Invalid media path' }, { status: 400, headers: { 'Cache-Control': 'no-store' } })
      }
      const fingerprint = mediaSessionFingerprint(req.headers.get('cookie'))
      if (!fingerprint) {
        return Response.json({ error: 'Unauthorized' }, { status: 401, headers: { 'Cache-Control': 'no-store' } })
      }
      const { ticket, expiresAt } = createMediaTicket({
        secret,
        path: body.path,
        sessionFingerprint: fingerprint,
      })
      logger.info('[webui] Media ticket minted')
      const response: MediaTicketResponse = {
        url: `${body.path}?ticket=${encodeURIComponent(ticket)}`,
        expiresAt,
      }
      return Response.json(response, { status: 200, headers: { 'Cache-Control': 'no-store' } })
    }

    // ── Media (signed ticket only) ──
    // Authorised solely by the ticket (the ticket itself is bound to the
    // session cookie presented here). Uniform 403 on every failure mode so a
    // caller cannot tell expired from tampered from cross-session, and the
    // ticket is never echoed or logged.
    if (path.startsWith(MEDIA_PATH_PREFIX) && req.method === 'GET') {
      const rejected = () => {
        logger.warn('[webui] Media request rejected')
        return Response.json({ error: 'Media ticket rejected' }, { status: 403, headers: { 'Cache-Control': 'no-store' } })
      }
      const verified = verifyMediaTicket(url.searchParams.get('ticket'), {
        secret,
        path,
        sessionFingerprint: mediaSessionFingerprint(req.headers.get('cookie')),
      })
      if (!verified) return rejected()
      const safePath = resolveMediaFile(mediaDir, verified.path)
      if (!safePath) return rejected()
      const file = Bun.file(safePath)
      if (!(await file.exists())) {
        return new Response(null, { status: 404, headers: { 'Cache-Control': 'no-store' } })
      }
      return new Response(file, {
        headers: {
          'Content-Type': getMimeType(path),
          'Cache-Control': 'private, no-store',
        },
      })
    }

    // ── Health endpoint (no auth) ──
    if (path === '/health') {
      const health = getHealthCheck()
      return Response.json(health, {
        status: health.status === 'ok' ? 200 : 503,
      })
    }

    // ── Login page (no auth) ──
    if (path === '/login' || path === '/login/') {
      const loginFile = Bun.file(join(webuiDir, 'login.html'))
      if (await loginFile.exists()) {
        return new Response(loginFile, {
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        })
      }
      return new Response('Login page not found', { status: 404 })
    }

    // ── Static assets that login page needs (no auth) ──
    if (path === '/favicon.ico' || path.startsWith('/login-assets/')) {
      const safePath = resolveWebuiFile(webuiDir, path)
      if (!safePath) return new Response('Not Found', { status: 404 })
      const file = Bun.file(safePath)
      if (await file.exists()) {
        return new Response(file, {
          headers: { 'Content-Type': getMimeType(path) },
        })
      }
      return new Response('Not Found', { status: 404 })
    }

    // ── Auth mode probe (no auth) — the login page reads this before signing in ──
    if (path === '/api/auth/config' && req.method === 'GET') {
      return Response.json({ authMode })
    }

    // ── OIDC login: redirect to the IdP authorization endpoint with PKCE ──
    if (path === '/api/auth/login' && req.method === 'GET') {
      if (!oidc) return new Response('OIDC login is not enabled', { status: 404 })

      // Unauthenticated route that allocates pending state: apply the same
      // per-IP rate limit as the password POST before doing any work.
      const ip = getClientIp(req)
      if (!rateLimiter.check(ip)) {
        logger.warn(`[webui] Rate limited OIDC login start from ${ip}`)
        return loginErrorResponse('Слишком много попыток входа. Попробуйте позже.', 429)
      }

      try {
        const discovery = await discoverOidc(oidc.issuer)
        const state = createRandomToken(16)
        const nonce = createRandomToken(16)
        const { codeVerifier, codeChallenge } = createPkcePair()

        // Bound the pending map: evict the oldest record before inserting.
        if (pendingOidcLogins.size >= OIDC_MAX_PENDING_LOGINS) {
          const oldest = pendingOidcLogins.keys().next().value
          if (oldest !== undefined) pendingOidcLogins.delete(oldest)
        }
        pendingOidcLogins.set(state, { codeVerifier, nonce, createdAt: Date.now() })

        const authorizationUrl = new URL(discovery.authorization_endpoint)
        authorizationUrl.searchParams.set('response_type', 'code')
        authorizationUrl.searchParams.set('client_id', oidc.clientId)
        authorizationUrl.searchParams.set('redirect_uri', `${oidc.publicUrl}/api/auth/callback`)
        authorizationUrl.searchParams.set('scope', 'openid profile email')
        authorizationUrl.searchParams.set('state', state)
        authorizationUrl.searchParams.set('nonce', nonce)
        authorizationUrl.searchParams.set('code_challenge', codeChallenge)
        authorizationUrl.searchParams.set('code_challenge_method', 'S256')

        return new Response(null, {
          status: 302,
          headers: {
            Location: authorizationUrl.toString(),
            // One-time binding of this login to the initiating browser (see auth.ts).
            'Set-Cookie': buildOidcStateCookie(state, useSecureCookies, OIDC_STATE_COOKIE_MAX_AGE_SECONDS),
          },
        })
      } catch (err) {
        logger.error(`[webui] OIDC login start failed: ${err instanceof Error ? err.message : 'unknown'}`)
        return loginErrorResponse('Сервис Rox ID сейчас недоступен. Попробуйте позже.', 502)
      }
    }

    // ── OIDC callback: validate state, exchange the code, verify id_token ──
    if (path === '/api/auth/callback' && req.method === 'GET') {
      if (!oidc) return new Response('Not Found', { status: 404 })

      const clearStateCookie = { 'Set-Cookie': buildClearedOidcStateCookie(useSecureCookies) }
      const state = url.searchParams.get('state')
      const cookieState = extractOidcStateCookie(req.headers.get('cookie'))

      // Bind the callback to the browser that started the login: the one-time
      // oidc_state cookie must match the state query param exactly (login CSRF /
      // session-fixation guard) before any state lookup, code exchange or minting.
      if (!state || !cookieState || !constantTimeEqual(cookieState, state)) {
        return loginErrorResponse('Запрос входа не соответствует этой сессии браузера. Начните вход заново.', 400)
      }

      const code = url.searchParams.get('code')
      const pending = pendingOidcLogins.get(state)
      pendingOidcLogins.delete(state)

      if (!pending || Date.now() - pending.createdAt > OIDC_STATE_TTL_MS) {
        return loginErrorResponse('Сессия входа истекла или параметр state недействителен. Начните вход заново.', 400, clearStateCookie)
      }
      if (url.searchParams.get('error')) {
        return loginErrorResponse('Провайдер Rox ID отклонил вход. Попробуйте ещё раз.', 400, clearStateCookie)
      }
      if (!code) {
        return loginErrorResponse('Провайдер Rox ID не вернул код авторизации.', 400, clearStateCookie)
      }

      try {
        const discovery = await discoverOidc(oidc.issuer)
        const form = new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: `${oidc.publicUrl}/api/auth/callback`,
          client_id: oidc.clientId,
          code_verifier: pending.codeVerifier,
        })
        if (oidc.clientSecret) form.set('client_secret', oidc.clientSecret)

        const tokenResponse = await fetch(discovery.token_endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Accept: 'application/json',
          },
          body: form.toString(),
        })
        if (!tokenResponse.ok) throw new Error(`token endpoint returned ${tokenResponse.status}`)
        const tokenBody: unknown = await tokenResponse.json()
        if (typeof tokenBody !== 'object' || tokenBody === null || !('id_token' in tokenBody)
          || typeof tokenBody.id_token !== 'string') {
          throw new Error('token endpoint did not return an id_token')
        }

        const user = await verifyOidcIdTokenWithJwks(tokenBody.id_token, {
          jwksUri: discovery.jwks_uri,
          issuer: oidc.issuer,
          clientId: oidc.clientId,
          nonce: pending.nonce,
        })

        const jwt = await createSessionToken(secret, {
          sub: user.sub,
          email: user.email,
          name: user.name,
          username: user.username,
          issuer: oidc.issuer,
        })
        logger.info(`[webui] OIDC login succeeded for ${user.sub}`)

        const successHeaders = new Headers()
        successHeaders.set('Location', '/')
        successHeaders.append('Set-Cookie', buildSessionCookie(jwt, useSecureCookies))
        successHeaders.append('Set-Cookie', buildClearedOidcStateCookie(useSecureCookies))
        return new Response(null, { status: 302, headers: successHeaders })
      } catch (err) {
        logger.warn(`[webui] OIDC callback failed: ${err instanceof Error ? err.message : 'unknown'}`)
        return loginErrorResponse('Не удалось завершить вход через Rox ID. Попробуйте ещё раз.', 400, clearStateCookie)
      }
    }

    // ── Auth endpoint ──
    if (path === '/api/auth' && req.method === 'POST') {
      // With OIDC enabled, password login is a deliberate opt-in; otherwise the
      // route does not exist so master-token access is genuinely removed.
      if (oidc && !allowPasswordLogin) return new Response('Not Found', { status: 404 })

      await passwordReady
      const ip = getClientIp(req)

      if (!rateLimiter.check(ip)) {
        logger.warn(`[webui] Rate limited auth attempt from ${ip}`)
        return Response.json(
          { error: 'Too many attempts. Try again later.' },
          { status: 429 },
        )
      }

      let body: { password?: string }
      try {
        body = await req.json() as { password?: string }
      } catch {
        return Response.json({ error: 'Invalid request body' }, { status: 400 })
      }

      if (!body.password || typeof body.password !== 'string') {
        return Response.json({ error: 'Password is required' }, { status: 400 })
      }

      if (!await verifyPassword(body.password)) {
        logger.warn(`[webui] Failed auth attempt from ${ip}`)
        return Response.json({ error: 'Invalid credentials' }, { status: 401 })
      }

      const jwt = await createSessionToken(secret)
      logger.info(`[webui] Successful auth from ${ip}`)

      return Response.json({ ok: true }, {
        status: 200,
        headers: {
          'Set-Cookie': buildSessionCookie(jwt, useSecureCookies),
        },
      })
    }

    // ── Logout endpoint ──
    if (path === '/api/auth/logout' && (req.method === 'POST' || req.method === 'GET')) {
      if (req.method === 'GET') {
        // Browser-facing logout: clear the cookie and return to the login page.
        return new Response(null, {
          status: 302,
          headers: {
            Location: '/login',
            'Set-Cookie': buildLogoutCookie(useSecureCookies),
          },
        })
      }
      return new Response(null, {
        status: 204,
        headers: {
          'Set-Cookie': buildLogoutCookie(useSecureCookies),
        },
      })
    }

    // ── Current session identity (requires a session cookie) ──
    if (path === '/api/auth/me' && req.method === 'GET') {
      const session = await validateSession(req.headers.get('cookie'), secret)
      if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
      const isUserSession = session.sub !== 'webui' || !!session.email || !!session.name || !!session.username
      return Response.json({
        authMode,
        ...(session.issuer ?? oidc?.issuer ? { issuer: session.issuer ?? oidc?.issuer } : {}),
        user: isUserSession
          ? {
              sub: session.sub,
              ...(session.email ? { email: session.email } : {}),
              ...(session.name ? { name: session.name } : {}),
              ...(session.username ? { username: session.username } : {}),
            }
          : null,
      })
    }

    // ── OAuth callback (no cookie auth — state param is CSRF protection) ──
    // Receives redirect from the relay (or directly from OAuth provider for MCP sources).
    // Completes the token exchange server-side and renders a success/error page.
    if (path === '/api/oauth/callback' && req.method === 'GET' && options.oauthCallbackDeps) {
      const code = url.searchParams.get('code')
      const state = url.searchParams.get('state')
      const error = url.searchParams.get('error')
      const errorDescription = url.searchParams.get('error_description')

      if (error) {
        const flow = state ? options.oauthCallbackDeps.flowStore.getByState(state) : null
        if (flow && state) options.oauthCallbackDeps.flowStore.remove(state)
        const errorMsg = errorDescription || error
        logger.warn(`[webui] OAuth callback error: ${errorMsg}`)
        return new Response(generateCallbackPage({ title: 'Authorization Failed', isSuccess: false, errorDetail: errorMsg }), {
          status: 200,
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        })
      }

      if (!code || !state) {
        return new Response(generateCallbackPage({ title: 'Authorization Failed', isSuccess: false, errorDetail: 'Missing code or state parameter' }), {
          status: 400,
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        })
      }

      try {
        const { completeOAuthFlow } = await import('../handlers/rpc/oauth')
        const result = await completeOAuthFlow({
          code,
          state,
          flowStore: options.oauthCallbackDeps.flowStore,
          credManager: options.oauthCallbackDeps.credManager as any,
          sessionManager: options.oauthCallbackDeps.sessionManager,
          pushSourcesChanged: options.oauthCallbackDeps.pushSourcesChanged,
          logger,
          // No clientId/workspaceId — HTTP callback skips ownership checks (state is auth)
        })

        if (result.success) {
          return new Response(generateCallbackPage({ title: 'Authorization Successful', isSuccess: true }), {
            status: 200,
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
          })
        } else {
          return new Response(generateCallbackPage({ title: 'Authorization Failed', isSuccess: false, errorDetail: result.error }), {
            status: 200,
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
          })
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Token exchange failed'
        logger.error(`[webui] OAuth callback failed: ${msg}`)
        return new Response(generateCallbackPage({ title: 'Authorization Failed', isSuccess: false, errorDetail: msg }), {
          status: 200,
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        })
      }
    }

    // ── Config endpoint (requires session cookie) ──
    if (path === '/api/config' && req.method === 'GET') {
      const configSession = await validateSession(req.headers.get('cookie'), secret)
      if (!configSession) {
        return Response.json({ error: 'Unauthorized' }, { status: 401 })
      }
      return Response.json({
        wsUrl: resolveWebSocketUrl(req, { publicWsUrl, wsProtocol, wsPort }),
        // Password mode keeps its exact historical response shape; OIDC mode
        // advertises the auth mode so the client can adapt.
        ...(oidc ? { authMode } : {}),
      })
    }

    // Return the default workspace ID so the webui can include it in the WS handshake
    if (path === '/api/config/workspaces' && req.method === 'GET') {
      const configSession = await validateSession(req.headers.get('cookie'), secret)
      if (!configSession) {
        return Response.json({ error: 'Unauthorized' }, { status: 401 })
      }
      const { readWebDefaultWorkspace } = await import('./theme-storage')
      const active = readWebDefaultWorkspace()
      return Response.json({
        defaultWorkspaceId: active?.id ?? null,
        workspace: active ? { id: active.id, name: active.name } : null,
      })
    }

    // ── Everything below requires a valid session cookie ──
    const cookieHeader = req.headers.get('cookie')
    const session = await validateSession(cookieHeader, secret)

    if (!session) {
      const accept = req.headers.get('accept') ?? ''
      if (accept.includes('text/html') || path === '/' || path === '') {
        return Response.redirect('/login', 302)
      }
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // ── Serve SPA static files ──
    if (path !== '/') {
      const safePath = resolveWebuiFile(webuiDir, path)
      if (safePath) {
        const file = Bun.file(safePath)
        if (await file.exists()) {
          return new Response(file, {
            headers: { 'Content-Type': getMimeType(path) },
          })
        }
      }
    }

    // SPA fallback — serve index.html for all non-file routes
    const indexFile = Bun.file(join(webuiDir, 'index.html'))
    if (await indexFile.exists()) {
      return new Response(indexFile, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      })
    }

    return new Response('Not Found', { status: 404 })
  }

  return {
fetch: async (req: Request) => withWebuiSecurityHeaders(await handleRequest(req), connectSrcOrigins),
    dispose: () => {
      clearInterval(cleanupTimer)
      clearInterval(handoffCleanupTimer)
    },
    setOAuthCallbackDeps: (deps: OAuthCallbackDeps) => {
      options.oauthCallbackDeps = deps
    },
    createHandoffToken: () => handoffStore.mint(),
  }
}

// ---------------------------------------------------------------------------
// Standalone server (backwards-compatible, uses Bun.serve)
// ---------------------------------------------------------------------------

export interface WebuiHttpServerOptions extends WebuiHandlerOptions {
  /** Port to bind on. Use 0 for an ephemeral port in tests. */
  port: number
}

export async function startWebuiHttpServer(
  options: WebuiHttpServerOptions,
): Promise<{ port: number, stop: () => void }> {
  const { port, logger, ...handlerOpts } = options
  let bunServer: ReturnType<typeof Bun.serve> | undefined
  const handler = createWebuiHandler({
    ...handlerOpts,
    logger,
    resolveClientIp: handlerOpts.resolveClientIp ?? ((req) => bunServer?.requestIP(req)?.address ?? null),
  })

  bunServer = Bun.serve({
    port,
    fetch: handler.fetch,
  })

  const boundPort = bunServer.port ?? port
  logger.info(`[webui] Web UI server listening on http://0.0.0.0:${boundPort}`)

  return {
    port: boundPort,
    stop: () => {
      handler.dispose()
      bunServer?.stop()
    },
  }
}
