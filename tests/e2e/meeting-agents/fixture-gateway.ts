/**
 * I029 / #385 — loopback fixture gateway.
 * Lives only under tests/. Production factories never import this file.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { AddressInfo } from 'node:net'

export type FixtureCounts = {
  modelCalls: number
  remoteWrites: number
  forbiddenCalls: number
}

export type RemoteRecord = {
  operationId: string
  stage: string
  payload: unknown
}

export type FixtureGateway = {
  url: string
  port: number
  reset(caseId: string): void
  emitSegment(segment: { id: string; text: string; final?: boolean }): void
  failNext(stage: string, mode: string): void
  counts(): FixtureCounts
  readRemote(operationId: string): RemoteRecord | undefined
  recordOutbound(url: string): void
  close(): Promise<void>
}

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])

function hostOf(req: IncomingMessage): string {
  const raw = (req.headers.host ?? '').split(':')[0]?.replace(/^\[|\]$/g, '') ?? ''
  return raw
}

function isLoopbackHost(host: string): boolean {
  return LOOPBACK.has(host)
}

export function startFixtureGateway(): Promise<FixtureGateway> {
  let caseId = 'idle'
  let counts: FixtureCounts = { modelCalls: 0, remoteWrites: 0, forbiddenCalls: 0 }
  const remotes = new Map<string, RemoteRecord>()
  const segments: Array<{ id: string; text: string; final: boolean }> = []
  let fail: { stage: string; mode: string } | null = null

  const reset = (nextCaseId: string) => {
    caseId = nextCaseId
    counts = { modelCalls: 0, remoteWrites: 0, forbiddenCalls: 0 }
    remotes.clear()
    segments.length = 0
    fail = null
  }

  const recordOutbound = (url: string) => {
    try {
      const parsed = new URL(url)
      if (!LOOPBACK.has(parsed.hostname)) counts.forbiddenCalls += 1
    } catch {
      counts.forbiddenCalls += 1
    }
  }

  const server: Server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const host = hostOf(req)
    if (!isLoopbackHost(host)) {
      counts.forbiddenCalls += 1
      res.statusCode = 403
      res.end(JSON.stringify({ error: 'loopback-only' }))
      return
    }
    const url = new URL(req.url ?? '/', `http://127.0.0.1`)
    if (req.method === 'GET' && url.pathname === '/health') {
      res.end(JSON.stringify({ ok: true, caseId }))
      return
    }
    if (req.method === 'GET' && url.pathname === '/counts') {
      res.end(JSON.stringify(counts))
      return
    }
    if (req.method === 'GET' && url.pathname.startsWith('/remote/')) {
      const operationId = decodeURIComponent(url.pathname.slice('/remote/'.length))
      res.end(JSON.stringify(remotes.get(operationId) ?? null))
      return
    }
    if (req.method === 'POST' && url.pathname === '/reset') {
      const body = await readJson(req)
      reset(typeof body.caseId === 'string' ? body.caseId : 'idle')
      res.end(JSON.stringify({ ok: true, caseId }))
      return
    }
    if (req.method === 'POST' && url.pathname === '/segment') {
      const body = await readJson(req)
      segments.push({
        id: String(body.id ?? `seg-${segments.length}`),
        text: String(body.text ?? ''),
        final: body.final === true,
      })
      counts.modelCalls += 1
      res.end(JSON.stringify({ ok: true, n: segments.length }))
      return
    }
    if (req.method === 'POST' && url.pathname === '/write') {
      if (fail?.stage === 'write') {
        const mode = fail.mode
        fail = null
        res.statusCode = 500
        res.end(JSON.stringify({ error: mode }))
        return
      }
      const body = await readJson(req)
      const operationId = String(body.operationId ?? `op-${remotes.size}`)
      remotes.set(operationId, { operationId, stage: 'write', payload: body })
      counts.remoteWrites += 1
      res.end(JSON.stringify({ ok: true, operationId }))
      return
    }
    res.statusCode = 404
    res.end(JSON.stringify({ error: 'not-found' }))
  })

  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as AddressInfo).port
      resolve({
        url: `http://127.0.0.1:${port}`,
        port,
        reset,
        emitSegment(segment) {
          segments.push({ id: segment.id, text: segment.text, final: segment.final === true })
          counts.modelCalls += 1
        },
        failNext(stage, mode) {
          fail = { stage, mode }
        },
        counts: () => ({ ...counts }),
        readRemote(operationId) {
          return remotes.get(operationId)
        },
        recordOutbound,
        close: () => new Promise((done, failClose) => {
          server.close((err) => (err ? failClose(err) : done()))
        }),
      })
    })
    server.on('error', reject)
  })
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  if (chunks.length === 0) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
  } catch {
    return {}
  }
}
