/**
 * External HTTP ingress for the in-process {@link HookRegistry} (port row f.8).
 *
 * The registry (`./hooks.ts`) is an observation seam driven by the host
 * scheduler; this module exposes it to trusted external callers over a small,
 * self-contained web-standard fetch handler so a webhook can
 * `POST /hooks/<event>` and have the registry dispatch it exactly as an
 * in-process caller would.
 *
 * Security posture (deliberately small and explicit):
 *   - The shared token is only ever accepted from the `Authorization: Bearer`
 *     header or `X-Rox-Hook-Token`. A `?token=` query is ALWAYS rejected with
 *     400 — capabilities never belong in URLs (they leak to logs/referrers).
 *   - The token comparison reuses the host's timing-safe helper
 *     (`secureTokenCompare`, RX-SEC-0007); it hashes both sides first so both
 *     the contents and the length of the secret stay constant-time.
 *   - Failed attempts are throttled per client IP (~20/min) so the endpoint
 *     cannot be brute-forced; a throttled caller gets 429 + `Retry-After`.
 *   - The route must not exist when no token is configured. The factory
 *     requires a non-empty token; the bootstrap simply does not install the
 *     ingress in that case, so there is no 401 oracle for an unconfigured
 *     deployment.
 *   - Bodies are bounded BEFORE they are buffered, and neither the token nor
 *     the request body is ever logged.
 *
 * Deliberate non-goals (see the port STATUS f.8 row): replay/idempotency
 * caching is NOT implemented here — a hook delivery is dispatched every time
 * it is accepted. See the slice report for the explicit deferral.
 */

import { secureTokenCompare } from '../bootstrap/headless-start.ts'
import type { HookRegistry } from './hooks.ts'

/** Resolved `POST /hooks/wake` payload handed to the injected dispatcher. */
export interface HooksWakePayload {
  readonly sessionId: string
  readonly text: string
}

/** Delivers a wake payload through the host's existing session-message path. */
export type HooksWakeDispatcher = (payload: HooksWakePayload) => Promise<void> | void

export interface HooksHttpLogger {
  warn: (message: string) => void
  error?: (message: string, error?: unknown) => void
}

export interface HooksHttpIngressOptions {
  /** Registry the accepted deliveries dispatch through. */
  hooks: HookRegistry
  /** Shared secret. A request without it can never be accepted. */
  token: string
  /** Injected wake delivery (bound to the existing SessionManager path by the bootstrap). */
  dispatchWake: HooksWakeDispatcher
  /** Route prefix. Defaults to `/hooks`. */
  basePath?: string
  /**
   * Maximum accepted request body size in bytes. Checked against
   * `Content-Length` first and enforced while streaming, so an oversized body
   * is never fully buffered. Defaults to 256 KiB.
   */
  bodyLimitBytes?: number
  /** Wall clock (ms). Injectable for throttle tests. Defaults to `Date.now`. */
  clock?: () => number
  logger?: HooksHttpLogger
  /**
   * Client-IP resolver for the failure throttle. Defaults to the first
   * `X-Forwarded-For` hop, then `X-Real-IP`, then `'unknown'`. The throttle is
   * a best-effort DoS mitigation layered behind token auth, not an authority.
   */
  resolveClientIp?: (req: Request) => string
}

/** Read-only observability snapshot of one installed ingress. */
export interface HooksIngressSnapshot {
  readonly basePath: string
  readonly bodyLimitBytes: number
  /** Event names currently registered in the registry. */
  readonly events: readonly string[]
  /** Accepted hook deliveries (dispatched through the registry). */
  readonly dispatched: number
  /** Accepted wake deliveries handed to the dispatcher. */
  readonly wakeDelivered: number
  /** Requests rejected for any reason (auth, method, unknown event, bad body). */
  readonly rejected: number
  /** Requests rejected specifically by the failure throttle (429). */
  readonly throttled: number
}

export interface HooksHttpIngress {
  readonly basePath: string
  /** Whether `pathname` is within this ingress' route prefix. */
  matches(pathname: string): boolean
  /**
   * Handle a request. Resolves to a `Response` when the request belongs to this
   * ingress (including error responses), or `null` when it does not, so a caller
   * can fall through to the next handler.
   */
  handle(req: Request): Promise<Response | null>
  /** Current observability snapshot. */
  snapshot(): HooksIngressSnapshot
}

const DEFAULT_BASE_PATH = '/hooks'
const DEFAULT_BODY_LIMIT_BYTES = 256 * 1024
/** `POST /hooks/wake` `text` is capped at 8 KiB. */
export const HOOKS_WAKE_TEXT_LIMIT_BYTES = 8 * 1024
const THROTTLE_WINDOW_MS = 60_000
const THROTTLE_MAX_FAILURES = 20
/** Upper bound on tracked client IPs, so a spoofed-source flood cannot grow memory. */
const THROTTLE_MAX_ENTRIES = 4096

/** Normalize a configured prefix to `/<segment>[/<segment>…]` with no trailing slash. */
export function normalizeHooksBasePath(basePath: string): string {
  const withLeading = basePath.startsWith('/') ? basePath : `/${basePath}`
  return withLeading.length > 1 ? withLeading.replace(/\/+$/, '') : withLeading
}

function defaultResolveClientIp(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for')
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim()
    if (first) return first
  }
  return req.headers.get('x-real-ip')?.trim() || 'unknown'
}

function json(body: unknown, status: number, headers?: Record<string, string>): Response {
  return Response.json(body, { status, headers })
}

/**
 * Rolling-window per-IP failure counter. Bounded in both time (stale windows
 * are swept) and size (oldest entries are evicted) so a hostile caller cannot
 * grow it without bound.
 */
class FailureThrottle {
  private readonly entries = new Map<string, { windowStart: number; count: number }>()

  constructor(
    private readonly windowMs: number,
    private readonly maxFailures: number,
    private readonly maxEntries: number,
    private readonly clock: () => number,
  ) {}

  /** Record a failed attempt; report whether the caller is now throttled. */
  recordFailure(ip: string): { throttled: boolean; retryAfterSeconds: number } {
    const now = this.clock()
    this.sweep(now)
    const entry = this.entries.get(ip)
    if (!entry || now - entry.windowStart >= this.windowMs) {
      this.entries.set(ip, { windowStart: now, count: 1 })
      this.enforceBound()
      return { throttled: false, retryAfterSeconds: 0 }
    }
    entry.count += 1
    if (entry.count > this.maxFailures) {
      const retryAfterSeconds = Math.max(1, Math.ceil((entry.windowStart + this.windowMs - now) / 1000))
      return { throttled: true, retryAfterSeconds }
    }
    return { throttled: false, retryAfterSeconds: 0 }
  }

  recordSuccess(ip: string): void {
    this.entries.delete(ip)
  }

  private sweep(now: number): void {
    for (const [ip, entry] of this.entries) {
      if (now - entry.windowStart >= this.windowMs) this.entries.delete(ip)
    }
  }

  private enforceBound(): void {
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value
      if (oldest === undefined) return
      this.entries.delete(oldest)
    }
  }
}

type BoundedBody =
  | { readonly ok: true; readonly bytes: Uint8Array }
  | { readonly ok: false }

/**
 * Read a request body without buffering more than `limit` bytes: the declared
 * `Content-Length` is checked first, and the stream is abandoned the moment the
 * running total crosses the limit.
 */
async function readBoundedBody(req: Request, limit: number): Promise<BoundedBody> {
  const declared = req.headers.get('content-length')
  if (declared !== null) {
    const declaredBytes = Number(declared)
    if (Number.isFinite(declaredBytes) && declaredBytes > limit) return { ok: false }
  }
  const body = req.body
  if (!body) return { ok: true, bytes: new Uint8Array(0) }
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > limit) {
        await reader.cancel().catch(() => {})
        return { ok: false }
      }
      chunks.push(value)
    }
  } catch {
    await reader.cancel().catch(() => {})
    return { ok: false }
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return { ok: true, bytes }
}

function parseWakePayload(body: unknown): HooksWakePayload | null {
  if (typeof body !== 'object' || body === null) return null
  // Parsed JSON boundary: read fields defensively off a named record, validating each below.
  const record = body as Record<string, unknown>
  if (typeof record.sessionId !== 'string' || record.sessionId.length === 0) return null
  if (typeof record.text !== 'string') return null
  if (new TextEncoder().encode(record.text).byteLength > HOOKS_WAKE_TEXT_LIMIT_BYTES) return null
  return { sessionId: record.sessionId, text: record.text }
}

/** Extract the presented shared secret from a bearer header or the hook-token header. */
function extractToken(req: Request): string | null {
  const header = req.headers.get('x-rox-hook-token')
  if (header && header.length > 0) return header
  const authorization = req.headers.get('authorization')
  if (authorization) {
    const match = /^Bearer\s+(.+)$/i.exec(authorization.trim())
    if (match?.[1]) return match[1].trim()
  }
  return null
}

export function createHooksHttpIngress(options: HooksHttpIngressOptions): HooksHttpIngress {
  const token = options.token
  if (typeof token !== 'string' || token.length === 0) {
    throw new Error('createHooksHttpIngress: a non-empty token is required')
  }
  const basePath = normalizeHooksBasePath(options.basePath ?? DEFAULT_BASE_PATH)
  const bodyLimitBytes = options.bodyLimitBytes ?? DEFAULT_BODY_LIMIT_BYTES
  const clock = options.clock ?? (() => Date.now())
  const logger = options.logger
  const resolveClientIp = options.resolveClientIp ?? defaultResolveClientIp
  const throttle = new FailureThrottle(THROTTLE_WINDOW_MS, THROTTLE_MAX_FAILURES, THROTTLE_MAX_ENTRIES, clock)
  const decoder = new TextDecoder()

  let dispatched = 0
  let wakeDelivered = 0
  let rejected = 0
  let throttled = 0

  function matches(pathname: string): boolean {
    return pathname === basePath || pathname.startsWith(`${basePath}/`)
  }

  function reject(status: number, error: string, headers?: Record<string, string>): Response {
    rejected += 1
    return json({ error }, status, headers)
  }

  async function handle(req: Request): Promise<Response | null> {
    let url: URL
    try {
      url = new URL(req.url)
    } catch {
      return reject(400, 'invalid request URL')
    }
    if (!matches(url.pathname)) return null

    // (1) A capability must never travel in a URL — reject it before anything else.
    if (url.searchParams.has('token')) {
      return reject(400, 'token must not be sent in the query string')
    }

    // (2) Only POST can deliver a hook.
    if (req.method !== 'POST') {
      return json({ error: 'method not allowed' }, 405, { Allow: 'POST' })
    }

    // (3) Shared-secret auth, throttled per client IP on failure.
    const ip = resolveClientIp(req)
    const provided = extractToken(req)
    if (provided === null || !secureTokenCompare(provided, token)) {
      const verdict = throttle.recordFailure(ip)
      if (verdict.throttled) {
        throttled += 1
        logger?.warn(`[hooks] throttled ${ip} after repeated auth failures`)
        return json({ error: 'too many failed attempts' }, 429, {
          'Retry-After': String(verdict.retryAfterSeconds),
        })
      }
      logger?.warn(`[hooks] rejected unauthenticated hook request from ${ip}`)
      return reject(401, 'unauthorized')
    }
    throttle.recordSuccess(ip)

    // (4) `/hooks` with no event name is not a route.
    const subpath = url.pathname === basePath ? '' : url.pathname.slice(basePath.length + 1)
    if (subpath === '') {
      return reject(404, 'not found')
    }

    if (subpath === 'wake') {
      return handleWake(req)
    }

    // (5) Unknown events are rejected BEFORE the body is touched.
    if (options.hooks.listenerCount(subpath) === 0) {
      return reject(404, 'unknown hook event')
    }

    // (6) Bound the body before buffering, then require valid JSON.
    const read = await readBoundedBody(req, bodyLimitBytes)
    if (!read.ok) {
      return reject(413, 'payload too large')
    }
    let payload: unknown
    try {
      payload = JSON.parse(decoder.decode(read.bytes))
    } catch {
      return reject(400, 'invalid JSON body')
    }

    // (7) Dispatch. A throwing listener is recorded in the result, never a 500.
    const result = await options.hooks.emit(subpath, payload)
    dispatched += 1
    if (result.failures.length > 0) {
      logger?.warn(`[hooks] event "${subpath}" had ${result.failures.length} listener failure(s)`)
    }
    return json({ invoked: result.invoked, failures: result.failures.length }, 200)
  }

  async function handleWake(req: Request): Promise<Response> {
    const read = await readBoundedBody(req, bodyLimitBytes)
    if (!read.ok) {
      return reject(413, 'payload too large')
    }
    let body: unknown
    try {
      body = JSON.parse(decoder.decode(read.bytes))
    } catch {
      return reject(400, 'invalid JSON body')
    }
    const payload = parseWakePayload(body)
    if (!payload) {
      return reject(400, 'invalid wake payload')
    }
    try {
      await options.dispatchWake(payload)
    } catch (error) {
      logger?.error?.(`[hooks] wake dispatch failed for session ${payload.sessionId}`, error)
      return json({ error: 'wake dispatch failed' }, 500)
    }
    wakeDelivered += 1
    return json({ ok: true }, 200)
  }

  return {
    basePath,
    matches,
    handle,
    snapshot: () => ({
      basePath,
      bodyLimitBytes,
      events: options.hooks.events(),
      dispatched,
      wakeDelivered,
      rejected,
      throttled,
    }),
  }
}