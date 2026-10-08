/**
 * HTTP surface of rox-maild. Bun's built-in server only — one process, three
 * routes, no framework.
 */
import { MAX_INBOUND_BODY_BYTES, type Config } from './config.ts'
import { handleHealth } from './health.ts'
import { json, readRawBody } from './http.ts'
import { handleInbound } from './inbound.ts'
import { IdempotencyCache } from './idempotency.ts'
import { log } from './log.ts'
import { handleProvision } from './provision.ts'
import { deliverRaw, type SmtpTarget } from './smtp.ts'

export interface ServerDeps {
  config: Config
  /** Test seam: replaces SMTP delivery, the broker and Stalwart calls. */
  deliver?: (target: SmtpTarget, mailFrom: string, rcptTo: string, raw: Buffer) => Promise<void>
  fetchImpl?: (input: string, init?: RequestInit) => Promise<Response>
}

export interface MaildServer {
  readonly port: number
  stop(closeActiveConnections?: boolean): void
}

export function createRequestHandler(deps: ServerDeps): (request: Request) => Promise<Response> {
  const { config } = deps
  const fetchImpl = deps.fetchImpl ?? ((input: string, init?: RequestInit) => fetch(input, init))
  const dedupe = new IdempotencyCache<string>(config.dedupeCapacity)
  const deliver = deps.deliver ?? deliverRaw

  return async (request: Request): Promise<Response> => {
    const { pathname } = new URL(request.url)
    try {
      if (pathname === '/api/health') {
        if (request.method !== 'GET' && request.method !== 'HEAD') return methodNotAllowed('GET, HEAD')
        const result = await handleHealth(config, fetchImpl)
        return json(result.status, result.body)
      }

      if (pathname === '/api/inbound') {
        if (request.method !== 'POST') return methodNotAllowed('POST')
        const read = await readRawBody(request, MAX_INBOUND_BODY_BYTES)
        if (!read.ok) {
          log('warn', 'inbound rejected: body too large')
          return json(413, { error: 'payload_too_large', limitBytes: config.maxInboundBytes })
        }
        const result = await handleInbound(request, read.buffer, { config, dedupe, deliver })
        log(result.status === 200 ? 'info' : 'warn', 'inbound', { status: result.status, ...result.body })
        return json(result.status, result.body)
      }

      if (pathname === '/api/provision') {
        if (request.method !== 'POST') return methodNotAllowed('POST')
        const result = await handleProvision(request, { config, ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}) })
        log(result.status === 200 ? 'info' : 'warn', 'provision', { status: result.status, error: result.body.error })
        return json(result.status, result.body)
      }

      return json(404, { error: 'not_found' })
    } catch (error) {
      log('error', 'unhandled request error', { pathname, detail: error instanceof Error ? error.message : String(error) })
      return json(500, { error: 'internal_error' })
    }
  }
}

export function methodNotAllowed(allow: string): Response {
  return json(405, { error: 'method_not_allowed' }, { allow })
}

export function startServer(deps: ServerDeps): MaildServer {
  const handler = createRequestHandler(deps)
  const server = Bun.serve({
    port: deps.config.port,
    hostname: '0.0.0.0',
    maxRequestBodySize: MAX_INBOUND_BODY_BYTES + 1024,
    idleTimeout: 120,
    fetch: handler,
  })
  return server
}