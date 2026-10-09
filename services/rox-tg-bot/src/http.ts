/**
 * HTTP surface of rox-tg-bot. Bun's built-in server only — four routes, no
 * framework, no dependencies. Every `/api/link/*` call requires
 * `Authorization: Bearer <TG_LINK_SERVICE_TOKEN>`.
 *
 *   POST /api/link/start   { accountId, accountLabel? } → { linkId, code:null, deepLink, expiresAt }
 *   GET  /api/link/status?linkId=…                      → { status, code?, phoneMasked?, confirmedAt? }
 *   POST /api/link/confirm { linkId, code }             → { status:"confirmed" }
 *   GET  /api/health                                    → honest readiness
 */
import { timingSafeEqual } from 'node:crypto'
import type { Config } from './config.ts'
import { deepLinkHttps } from './link.ts'
import { log } from './log.ts'
import type { ConfirmResult, LinkState } from './state.ts'

const MAX_BODY_BYTES = 8 * 1024

export interface ServerDeps {
  config: Config
  state: LinkState
  /** Bot username provider (BOT_USERNAME or getMe discovery); may be empty. */
  botUsername?: () => string
}

export interface StartResponse {
  linkId: string
  code: null
  deepLink: string
  expiresAt: number
}

export interface StatusResponse {
  status: string
  code?: string
  phoneMasked?: string
  confirmedAt?: number
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

function isAuthorized(request: Request, token: string): boolean {
  const match = /^Bearer\s+(.+)$/i.exec((request.headers.get('authorization') ?? '').trim())
  if (match === null) return false
  const provided = Buffer.from(match[1]!)
  const expected = Buffer.from(token)
  return provided.length === expected.length && timingSafeEqual(provided, expected)
}

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

function confirmHttpStatus(result: Exclude<ConfirmResult, 'not_found'>): number {
  if (result === 'confirmed') return 200
  if (result === 'expired') return 410
  return 400
}

export function createRequestHandler(deps: ServerDeps): (request: Request) => Promise<Response> {
  const { config, state } = deps
  const botUsername = () => (deps.botUsername ? deps.botUsername() : config.botUsername)

  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url)
    const { pathname } = url
    try {
      if (pathname === '/api/health') {
        if (request.method !== 'GET' && request.method !== 'HEAD') {
          return jsonResponse(405, { error: 'method_not_allowed' }, { allow: 'GET, HEAD' })
        }
        return jsonResponse(200, { ok: true, bot: botUsername() || null })
      }

      if (!pathname.startsWith('/api/link/')) return jsonResponse(404, { error: 'not_found' })
      if (!isAuthorized(request, config.serviceToken)) return jsonResponse(401, { error: 'unauthorized' })

      if (pathname === '/api/link/start') {
        if (request.method !== 'POST') return jsonResponse(405, { error: 'method_not_allowed' }, { allow: 'POST' })
        const bot = botUsername()
        if (bot === '') return jsonResponse(503, { error: 'no_bot_username' })
        const body = await readJson(request)
        const accountId = nonEmptyString(body?.accountId)
        if (!accountId) return jsonResponse(400, { error: 'invalid_account_id' })
        const accountLabel = nonEmptyString(body?.accountLabel)

        const now = Date.now()
        const link = state.createLink(accountId, accountLabel, now, config.ttlMs)
        const response: StartResponse = {
          linkId: link.linkId,
          code: null,
          deepLink: deepLinkHttps(bot, link.linkId),
          expiresAt: link.expiresAt,
        }
        return jsonResponse(200, response)
      }

      if (pathname === '/api/link/status') {
        if (request.method !== 'GET' && request.method !== 'HEAD') {
          return jsonResponse(405, { error: 'method_not_allowed' }, { allow: 'GET, HEAD' })
        }
        const linkId = nonEmptyString(url.searchParams.get('linkId'))
        if (!linkId) return jsonResponse(400, { error: 'invalid_link_id' })
        const view = state.status(linkId, Date.now())
        if (!view) return jsonResponse(404, { error: 'not_found' })
        const response: StatusResponse = { status: view.status }
        if (view.code !== undefined) response.code = view.code
        if (view.phoneMasked !== undefined) response.phoneMasked = view.phoneMasked
        if (view.confirmedAt !== undefined) response.confirmedAt = view.confirmedAt
        return jsonResponse(200, response)
      }

      if (pathname === '/api/link/confirm') {
        if (request.method !== 'POST') return jsonResponse(405, { error: 'method_not_allowed' }, { allow: 'POST' })
        const body = await readJson(request)
        const linkId = nonEmptyString(body?.linkId)
        if (!linkId || typeof body?.code !== 'string') return jsonResponse(400, { error: 'invalid_request' })
        const result = state.confirm(linkId, body.code, Date.now(), config.maxAttempts)
        if (result === 'not_found') return jsonResponse(404, { error: 'not_found' })
        log(result === 'confirmed' ? 'info' : 'warn', 'link confirm', { status: result })
        return jsonResponse(confirmHttpStatus(result), { status: result })
      }

      return jsonResponse(404, { error: 'not_found' })
    } catch (error) {
      log('error', 'unhandled request error', {
        pathname,
        detail: error instanceof Error ? error.message : String(error),
      })
      return jsonResponse(500, { error: 'internal_error' })
    }
  }
}

export interface RoxTgBotServer {
  readonly port: number
  stop(closeActiveConnections?: boolean): void
}

export function startServer(deps: ServerDeps): RoxTgBotServer {
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