/**
 * Loopback fixture gateway for meeting-agents E2E (I029 / #385).
 * Binds 127.0.0.1 only. Live counters — not canned constants.
 * This process is test-only; production packaging must not import it.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { randomBytes } from 'node:crypto'

export type GatewayCounts = {
  modelCalls: number
  remoteWrites: number
  forbiddenCalls: number
  segments: number
}

export type FixtureGateway = {
  readonly kind: 'loopback-fixture'
  readonly origin: string
  readonly token: string
  reset(caseId: string): Promise<void>
  emitSegment(segment: Record<string, unknown>): Promise<void>
  failNext(stage: string, mode: string): Promise<void>
  counts(): Promise<GatewayCounts>
  readRemote(operationId: string): Promise<unknown | null>
  recordForbidden(): Promise<void>
  close(): Promise<void>
}

type GatewayState = {
  caseId: string
  modelCalls: number
  remoteWrites: number
  forbiddenCalls: number
  segments: Array<Record<string, unknown>>
  failNext: { stage: string; mode: string } | null
  remotes: Map<string, unknown>
}

function emptyState(caseId = ''): GatewayState {
  return {
    caseId,
    modelCalls: 0,
    remoteWrites: 0,
    forbiddenCalls: 0,
    segments: [],
    failNext: null,
    remotes: new Map(),
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(json),
  })
  res.end(json)
}

function authorize(req: IncomingMessage, token: string): boolean {
  const header = req.headers.authorization ?? ''
  return header === `Bearer ${token}`
}

export async function createFixtureGateway(): Promise<FixtureGateway> {
  const token = randomBytes(16).toString('hex')
  const state = emptyState()

  const server: Server = createServer(async (req, res) => {
    try {
      if (!authorize(req, token)) {
        send(res, 401, { ok: false, reason: 'unauthorized' })
        return
      }
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      const method = req.method ?? 'GET'

      if (method === 'GET' && url.pathname === '/health') {
        send(res, 200, { ok: true, caseId: state.caseId })
        return
      }
      if (method === 'GET' && url.pathname === '/counts') {
        send(res, 200, {
          modelCalls: state.modelCalls,
          remoteWrites: state.remoteWrites,
          forbiddenCalls: state.forbiddenCalls,
          segments: state.segments.length,
        } satisfies GatewayCounts)
        return
      }
      if (method === 'POST' && url.pathname === '/reset') {
        const body = JSON.parse((await readBody(req)) || '{}') as { caseId?: string }
        Object.assign(state, emptyState(body.caseId ?? ''))
        send(res, 200, { ok: true })
        return
      }
      if (method === 'POST' && url.pathname === '/emitSegment') {
        const body = JSON.parse((await readBody(req)) || '{}') as Record<string, unknown>
        state.segments.push(body)
        send(res, 200, { ok: true, index: state.segments.length })
        return
      }
      if (method === 'POST' && url.pathname === '/failNext') {
        const body = JSON.parse((await readBody(req)) || '{}') as { stage?: string; mode?: string }
        state.failNext = { stage: body.stage ?? '', mode: body.mode ?? '' }
        send(res, 200, { ok: true })
        return
      }
      if (method === 'POST' && url.pathname === '/forbidden') {
        state.forbiddenCalls += 1
        send(res, 200, { ok: true, forbiddenCalls: state.forbiddenCalls })
        return
      }
      if (method === 'POST' && url.pathname === '/modelCall') {
        state.modelCalls += 1
        send(res, 200, { ok: true })
        return
      }
      if (method === 'POST' && url.pathname === '/remoteWrite') {
        state.remoteWrites += 1
        const body = JSON.parse((await readBody(req)) || '{}') as { operationId?: string; value?: unknown }
        if (body.operationId) state.remotes.set(body.operationId, body.value ?? true)
        send(res, 200, { ok: true })
        return
      }
      const remoteMatch = url.pathname.match(/^\/remote\/([^/]+)$/)
      if (remoteMatch && method === 'GET') {
        const id = decodeURIComponent(remoteMatch[1] ?? '')
        if (!state.remotes.has(id)) {
          send(res, 200, { value: null })
          return
        }
        send(res, 200, { value: state.remotes.get(id) })
        return
      }

      send(res, 404, { ok: false, reason: 'not-found' })
    } catch (err) {
      send(res, 500, { ok: false, reason: err instanceof Error ? err.message : 'gateway-error' })
    }
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })

  const addr = server.address()
  if (!addr || typeof addr === 'string') {
    server.close()
    throw new Error('fixture gateway failed to bind loopback')
  }
  const origin = `http://127.0.0.1:${addr.port}`

  async function authed(path: string, init?: RequestInit): Promise<Response> {
    return fetch(`${origin}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        ...(init?.headers ?? {}),
      },
    })
  }

  return {
    kind: 'loopback-fixture',
    origin,
    token,
    async reset(caseId: string) {
      const res = await authed('/reset', { method: 'POST', body: JSON.stringify({ caseId }) })
      if (!res.ok) throw new Error(`gateway reset failed: ${res.status}`)
    },
    async emitSegment(segment: Record<string, unknown>) {
      const res = await authed('/emitSegment', { method: 'POST', body: JSON.stringify(segment) })
      if (!res.ok) throw new Error(`gateway emitSegment failed: ${res.status}`)
    },
    async failNext(stage: string, mode: string) {
      const res = await authed('/failNext', { method: 'POST', body: JSON.stringify({ stage, mode }) })
      if (!res.ok) throw new Error(`gateway failNext failed: ${res.status}`)
    },
    async counts() {
      const res = await authed('/counts')
      if (!res.ok) throw new Error(`gateway counts failed: ${res.status}`)
      return (await res.json()) as GatewayCounts
    },
    async readRemote(operationId: string) {
      const res = await authed(`/remote/${encodeURIComponent(operationId)}`)
      if (!res.ok) throw new Error(`gateway readRemote failed: ${res.status}`)
      const body = (await res.json()) as { value: unknown | null }
      return body.value
    },
    async recordForbidden() {
      const res = await authed('/forbidden', { method: 'POST', body: '{}' })
      if (!res.ok) throw new Error(`gateway forbidden failed: ${res.status}`)
    },
    async close() {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()))
      })
    },
  }
}
