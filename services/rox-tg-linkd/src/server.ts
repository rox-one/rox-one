/**
 * HTTP surface of rox-tg-linkd. Bun's built-in server only — four routes, no
 * framework, no dependencies.
 *
 *   POST /api/link/start   { roxUserId }        → pending link + deep link
 *   POST /api/link/verify  { roxUserId, code }  → linked | expired | invalid
 *   GET  /api/link/status?roxUserId=…           → current state
 *   POST /api/register/start   {}               → phone-registration token + deep link
 *   GET  /api/register/status?token=…           → waiting | ready | expired | cancelled | consumed
 *   POST /api/register/consume { token }        → consumed (single use)
 *   GET  /api/health                            → honest readiness
 */
import { timingSafeEqual } from 'node:crypto'
import type { Config } from './config.ts'
import { deepLinkHttps, deepLinkTg, effectiveStatus, isWellFormedCode, normalizeCode } from './link.ts'
import { log } from './log.ts'
import type { LinkStatus } from './link.ts'
import { maskPhone, type LinkStore, type RegistrationStatus, type VerifyResult } from './store.ts'

const MAX_BODY_BYTES = 8 * 1024

export interface ServerDeps {
  config: Config
  store: LinkStore
  /** Bot username provider (config value or getMe discovery); may be empty. */
  botUsername?: () => string
}

interface StartRequest {
  roxUserId?: unknown
}

interface VerifyRequest {
  roxUserId?: unknown
  code?: unknown
}

export interface StartResponse {
  ok: true
  roxUserId: string
  status: LinkStatus
  /**
   * Opaque pairing token (also embedded in `deepLink`). The desktop bridge
   * addresses the link by this id; it is never a second secret.
   */
  linkId?: string
  /** Present once the phone is shared (status `code-sent`). */
  code?: string
  deepLink?: string
  tgDeepLink?: string
  expiresAt?: number
  remainingMs?: number
}

export interface VerifyResponse {
  ok: true
  status: VerifyResult
}

export interface StatusResponse {
  ok: true
  status: LinkStatus
  expiresAt: number | null
  remainingMs: number
  /** Present once the phone is shared and the code is awaiting entry. */
  code?: string
}

export interface RegisterStartResponse {
  ok: true
  token: string
  deepLink: string
  tgDeepLink: string
  expiresAt: number
}

export interface RegisterStatusResponse {
  ok: true
  status: RegistrationStatus
  expiresAt: number
  /** Present once the phone is bound (status `ready`/`consumed`). */
  phone?: string
  phoneMasked?: string
  telegramUserId?: string
  telegramUsername?: string
  confirmedAt?: number
}

export interface RegisterConsumeResponse {
  ok: true
  status: 'consumed'
}

export function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  })
}

async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  const declared = request.headers.get('content-length')
  if (declared !== null && Number(declared) > MAX_BODY_BYTES) return null
  try {
    const text = await request.text()
    if (text.length > MAX_BODY_BYTES) return null
    const parsed: unknown = JSON.parse(text)
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function isAuthorized(request: Request, config: Config): boolean {
  // Fail closed: an unconfigured token refuses every call instead of serving
  // the whole link surface unauthenticated. The comparison is constant-time so
  // the token cannot be recovered byte by byte through response timing.
  if (config.authToken === '') return false
  const header = request.headers.get('authorization') ?? ''
  const match = /^Bearer\s+(.+)$/i.exec(header.trim())
  if (match === null) return false
  const provided = Buffer.from(match[1]!)
  const expected = Buffer.from(config.authToken)
  return provided.length === expected.length && timingSafeEqual(provided, expected)
}

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

export function createRequestHandler(deps: ServerDeps): (request: Request) => Promise<Response> {
  const { config, store } = deps
  const botUsername = () => (deps.botUsername ? deps.botUsername() : config.botUsername)

  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url)
    const { pathname } = url
    try {
      if (pathname === '/api/health') {
        if (request.method !== 'GET' && request.method !== 'HEAD') return jsonResponse(405, { error: 'method_not_allowed' }, { allow: 'GET, HEAD' })
        if (config.botToken === '') return jsonResponse(200, { ok: false, reason: 'no-token' })
        return jsonResponse(200, { ok: true, bot: botUsername() || null })
      }

      const isLinkRoute = pathname.startsWith('/api/link/')
      const isRegisterRoute = pathname.startsWith('/api/register/')
      if (!isLinkRoute && !isRegisterRoute) return jsonResponse(404, { error: 'not_found' })
      if (!isAuthorized(request, config)) return jsonResponse(401, { error: 'unauthorized' })

      if (pathname === '/api/link/start') {
        if (request.method !== 'POST') return jsonResponse(405, { error: 'method_not_allowed' }, { allow: 'POST' })
        if (config.botToken === '') return jsonResponse(503, { error: 'no_bot_token' })
        const bot = botUsername()
        if (bot === '') return jsonResponse(503, { error: 'no_bot_username' })
        const body = await readJson(request)
        const roxUserId = nonEmptyString(body?.roxUserId)
        if (!roxUserId) return jsonResponse(400, { error: 'invalid_rox_user_id' })

        const now = Date.now()
        const linked = store.getLinked(roxUserId)
        if (linked) return jsonResponse(200, { ok: true, roxUserId, status: 'linked' } satisfies StartResponse)

        const pending = store.createOrGetPending(roxUserId, now, config.ttlMs)
        const status = effectiveStatus(pending.status, pending.expiresAt, now)
        const response: StartResponse = {
          ok: true,
          roxUserId,
          status,
          linkId: pending.token,
          deepLink: deepLinkHttps(bot, pending.token),
          tgDeepLink: deepLinkTg(bot, pending.token),
          expiresAt: pending.expiresAt,
          remainingMs: Math.max(0, pending.expiresAt - now),
          ...(status === 'code-sent' ? { code: pending.code ?? undefined } : {}),
        }
        return jsonResponse(200, response)
      }

      if (pathname === '/api/link/verify') {
        if (request.method !== 'POST') return jsonResponse(405, { error: 'method_not_allowed' }, { allow: 'POST' })
        const body = await readJson(request)
        const roxUserId = nonEmptyString(body?.roxUserId)
        if (!roxUserId) return jsonResponse(400, { error: 'invalid_rox_user_id' })
        const rawCode = body?.code
        if (typeof rawCode !== 'string' || !isWellFormedCode(rawCode)) {
          // A malformed code can never match; still counts as an attempt.
          store.verify(roxUserId, rawCode, Date.now(), config.maxAttempts)
          return jsonResponse(200, { ok: true, status: 'invalid' } satisfies VerifyResponse)
        }
        const status = store.verify(roxUserId, normalizeCode(rawCode), Date.now(), config.maxAttempts)
        log(status === 'linked' ? 'info' : 'warn', 'link verify', { status })
        return jsonResponse(200, { ok: true, status } satisfies VerifyResponse)
      }

      if (pathname === '/api/link/status') {
        if (request.method !== 'GET' && request.method !== 'HEAD') return jsonResponse(405, { error: 'method_not_allowed' }, { allow: 'GET, HEAD' })
        const roxUserId = nonEmptyString(url.searchParams.get('roxUserId'))
        if (!roxUserId) return jsonResponse(400, { error: 'invalid_rox_user_id' })
        const now = Date.now()
        const view = store.statusFor(roxUserId, now)
        return jsonResponse(200, {
          ok: true,
          status: view.status,
          expiresAt: view.expiresAt,
          remainingMs: view.expiresAt === null ? 0 : Math.max(0, view.expiresAt - now),
          ...(view.code ? { code: view.code } : {}),
        } satisfies StatusResponse)
      }

      if (pathname === '/api/register/start') {
        if (request.method !== 'POST') return jsonResponse(405, { error: 'method_not_allowed' }, { allow: 'POST' })
        if (config.botToken === '') return jsonResponse(503, { error: 'no_bot_token' })
        const bot = botUsername()
        if (bot === '') return jsonResponse(503, { error: 'no_bot_username' })
        const body = await readJson(request)
        if (body === null) return jsonResponse(400, { error: 'invalid_body' })

        const registration = store.createRegistration(Date.now(), config.ttlMs)
        const response: RegisterStartResponse = {
          ok: true,
          token: registration.token,
          deepLink: deepLinkHttps(bot, registration.token),
          tgDeepLink: deepLinkTg(bot, registration.token),
          expiresAt: registration.expiresAt,
        }
        return jsonResponse(201, response)
      }

      if (pathname === '/api/register/status') {
        if (request.method !== 'GET' && request.method !== 'HEAD') return jsonResponse(405, { error: 'method_not_allowed' }, { allow: 'GET, HEAD' })
        const token = nonEmptyString(url.searchParams.get('token'))
        if (!token) return jsonResponse(400, { error: 'invalid_token' })
        const view = store.registrationStatusFor(token, Date.now())
        if (!view) return jsonResponse(404, { error: 'not_found' })
        const bound = view.status === 'ready' || view.status === 'consumed'
        const response: RegisterStatusResponse = {
          ok: true,
          status: view.status,
          expiresAt: view.expiresAt,
          ...(bound && view.phone ? { phone: view.phone, phoneMasked: maskPhone(view.phone) } : {}),
          ...(bound && view.telegramUserId ? { telegramUserId: view.telegramUserId } : {}),
          ...(bound && view.telegramUsername ? { telegramUsername: view.telegramUsername } : {}),
          ...(bound && view.confirmedAt !== null ? { confirmedAt: view.confirmedAt } : {}),
        }
        return jsonResponse(200, response)
      }

      if (pathname === '/api/register/consume') {
        if (request.method !== 'POST') return jsonResponse(405, { error: 'method_not_allowed' }, { allow: 'POST' })
        const body = await readJson(request)
        const token = nonEmptyString(body?.token)
        if (!token) return jsonResponse(400, { error: 'invalid_token' })

        const result = store.consumeRegistration(token, Date.now())
        if (result === 'consumed') return jsonResponse(200, { ok: true, status: 'consumed' } satisfies RegisterConsumeResponse)
        if (result === 'already_consumed') return jsonResponse(409, { ok: false, error: 'already_consumed' })
        if (result === 'not_found') return jsonResponse(404, { ok: false, error: 'not_found' })
        if (result === 'expired') return jsonResponse(410, { ok: false, error: 'expired' })
        if (result === 'cancelled') return jsonResponse(409, { ok: false, error: 'cancelled' })
        return jsonResponse(409, { ok: false, error: 'not_ready' })
      }

      return jsonResponse(404, { error: 'not_found' })
    } catch (error) {
      log('error', 'unhandled request error', { pathname, detail: error instanceof Error ? error.message : String(error) })
      return jsonResponse(500, { error: 'internal_error' })
    }
  }
}

export interface LinkdServer {
  readonly port: number
  stop(closeActiveConnections?: boolean): void
}

export function startServer(deps: ServerDeps): LinkdServer {
  const handler = createRequestHandler(deps)
  const server = Bun.serve({
    port: deps.config.port,
    hostname: '0.0.0.0',
    maxRequestBodySize: MAX_BODY_BYTES,
    idleTimeout: 120,
    fetch: handler,
  })
  return { port: server.port ?? deps.config.port, stop: (close?: boolean) => server.stop(close) }
}