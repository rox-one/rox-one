/**
 * Composition test for the external `/hooks` ingress (port row f.8).
 *
 * Exercises the real pieces the bootstrap assembles — the fetch ingress, the
 * Node composition with the WebUI handler, the wake dispatcher bound to the
 * session-message path — behind a REAL `WsRpcServer` on an ephemeral port,
 * driven by real `fetch`. This is the same wiring that `bootstrapServer`
 * installs, without the config/lock/native-sidecar startup cost.
 */

import { afterAll, describe, expect, it } from 'bun:test'
import { request as nodeRequest, type IncomingMessage, type ServerResponse } from 'node:http'
import { WsRpcServer } from '../../transport/server.ts'
import { createHooksWakeDispatcher } from '../../bootstrap/headless-start.ts'
import { HookRegistry } from '../hooks.ts'
import { createHooksHttpIngress } from '../hooks-http.ts'
import { composeHooksNodeHandler, type NodeHttpHandler } from '../hooks-node.ts'

const HOOKS_TOKEN = 'integration-hooks-token-abcdef'

interface SessionStore {
  messages: Array<{ sessionId: string; text: string }>
  sendMessage(sessionId: string, message: string): Promise<void>
}

function createSessionStore(): SessionStore {
  const messages: Array<{ sessionId: string; text: string }> = []
  return {
    messages,
    async sendMessage(sessionId, message) {
      messages.push({ sessionId, text: message })
    },
  }
}

const webuiHandler: NodeHttpHandler = (req: IncomingMessage, res: ServerResponse) => {
  const path = new URL(req.url ?? '/', 'http://localhost').pathname
  if (req.method === 'GET' && (path === '/' || path === '')) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end('<html><body>WEBUI-SHELL</body></html>')
    return
  }
  if (req.method === 'POST' && path === '/echo') {
    // Echoes exactly what the downstream handler received, so tests can prove
    // the composition never drains a body it passes through.
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'text/plain' })
      res.end(Buffer.concat(chunks))
    })
    return
  }
  res.writeHead(404, { 'Content-Type': 'text/plain' })
  res.end('webui: not found')
}

const servers: WsRpcServer[] = []

async function startServer(httpHandler: NodeHttpHandler): Promise<WsRpcServer> {
  const server = new WsRpcServer({
    host: '127.0.0.1',
    port: 0,
    requireAuth: true,
    validateToken: async () => true,
    serverId: 'hooks-ingress-test',
    httpHandler,
  })
  await server.listen()
  servers.push(server)
  return server
}

afterAll(() => {
  for (const server of servers) server.close()
  servers.length = 0
})

/** Minimal raw HTTP client: lets a test send a path a URL parser would rewrite. */
function rawRequest(
  port: number,
  options: { method: string; path: string; headers?: Record<string, string>; body?: string },
): Promise<{ status: number; body: string }> {
  const { promise, resolve, reject } = Promise.withResolvers<{ status: number; body: string }>()
  const req = nodeRequest(
    { host: '127.0.0.1', port, method: options.method, path: options.path, headers: options.headers },
    (res) => {
      const chunks: Buffer[] = []
      res.on('data', (chunk: Buffer) => chunks.push(chunk))
      res.on('end', () =>
        resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }),
      )
    },
  )
  req.on('error', reject)
  if (options.body !== undefined) req.write(options.body)
  req.end()
  return promise
}

describe('external /hooks ingress composition', () => {
  it('serves the hooks route and the WebUI from one WsRpcServer', async () => {
    const registry = new HookRegistry()
    const received: unknown[] = []
    registry.on('deploy', (payload) => { received.push(payload) })

    const sessions = createSessionStore()
    const ingress = createHooksHttpIngress({
      hooks: registry,
      token: HOOKS_TOKEN,
      dispatchWake: createHooksWakeDispatcher(sessions),
    })
    const server = await startServer(composeHooksNodeHandler(ingress, webuiHandler))
    const base = `http://127.0.0.1:${server.port}`

    // -- POST a registered event with a bearer token -> 200 + real dispatch --
    const dispatched = await fetch(`${base}/hooks/deploy`, {
      method: 'POST',
      headers: { authorization: `Bearer ${HOOKS_TOKEN}` },
      body: JSON.stringify({ branch: 'main', sha: 'abc123' }),
    })
    expect(dispatched.status).toBe(200)
    expect(await dispatched.json()).toEqual({ invoked: 1, failures: 0 })
    expect(received).toEqual([{ branch: 'main', sha: 'abc123' }])

    // -- Without the header -> 401 --
    const unauthorized = await fetch(`${base}/hooks/deploy`, {
      method: 'POST',
      body: JSON.stringify({ branch: 'main' }),
    })
    expect(unauthorized.status).toBe(401)

    // -- wake a real session through the existing message path --
    const wake = await fetch(`${base}/hooks/wake`, {
      method: 'POST',
      headers: { authorization: `Bearer ${HOOKS_TOKEN}` },
      body: JSON.stringify({ sessionId: 'session-42', text: 'wake up' }),
    })
    expect(wake.status).toBe(200)
    expect(await wake.json()).toEqual({ ok: true })
    expect(sessions.messages).toEqual([{ sessionId: 'session-42', text: 'wake up' }])

    // -- The WebUI handler is still composed behind the ingress --
    const webui = await fetch(`${base}/`, { method: 'GET' })
    expect(webui.status).toBe(200)
    expect(await webui.text()).toContain('WEBUI-SHELL')

    // -- The snapshot reflects accepted deliveries --
    const snapshot = ingress.snapshot()
    expect(snapshot.dispatched).toBe(1)
    expect(snapshot.wakeDelivered).toBe(1)
    expect(snapshot.events).toContain('deploy')
  })

  it('does not install the route when no token is configured (falls through)', async () => {
    const notFound: NodeHttpHandler = (_req, res) => {
      res.writeHead(404, { 'Content-Type': 'text/plain' })
      res.end('downstream: not found')
    }
    const server = await startServer(composeHooksNodeHandler(null, notFound))
    const base = `http://127.0.0.1:${server.port}`

    // No ingress installed -> the /hooks path is unknown to the composition and
    // reaches the downstream handler, which answers 404 (never a 401 oracle).
    const response = await fetch(`${base}/hooks/deploy`, { method: 'POST', body: '{}' })
    expect(response.status).toBe(404)
    expect(await response.text()).toBe('downstream: not found')
  })

  it('bounds an oversized /hooks body (declared length) with 413 and never dispatches', async () => {
    const registry = new HookRegistry()
    const received: unknown[] = []
    registry.on('deploy', (payload) => { received.push(payload) })

    const sessions = createSessionStore()
    const ingress = createHooksHttpIngress({
      hooks: registry,
      token: HOOKS_TOKEN,
      dispatchWake: createHooksWakeDispatcher(sessions),
      bodyLimitBytes: 4096,
    })
    const server = await startServer(composeHooksNodeHandler(ingress, webuiHandler))
    const base = `http://127.0.0.1:${server.port}`

    const oversized = await fetch(`${base}/hooks/deploy`, {
      method: 'POST',
      headers: { authorization: `Bearer ${HOOKS_TOKEN}` },
      body: 'x'.repeat(64 * 1024),
    })
    expect(oversized.status).toBe(413)
    expect(await oversized.json()).toEqual({ error: 'payload too large' })
    expect(received).toEqual([])

    // The same composition still serves both sides right after the rejection.
    const webui = await fetch(`${base}/`, { method: 'GET' })
    expect(webui.status).toBe(200)
    const accepted = await fetch(`${base}/hooks/deploy`, {
      method: 'POST',
      headers: { authorization: `Bearer ${HOOKS_TOKEN}` },
      body: JSON.stringify({ branch: 'main' }),
    })
    expect(accepted.status).toBe(200)
    expect(received).toEqual([{ branch: 'main' }])
  })

  it('bounds an oversized chunked /hooks body (no declared length) with 413', async () => {
    const registry = new HookRegistry()
    const received: unknown[] = []
    registry.on('deploy', (payload) => { received.push(payload) })

    const sessions = createSessionStore()
    const ingress = createHooksHttpIngress({
      hooks: registry,
      token: HOOKS_TOKEN,
      dispatchWake: createHooksWakeDispatcher(sessions),
      bodyLimitBytes: 4096,
    })
    const server = await startServer(composeHooksNodeHandler(ingress, webuiHandler))

    const oversized = await rawRequest(server.port, {
      method: 'POST',
      path: '/hooks/deploy',
      headers: { authorization: `Bearer ${HOOKS_TOKEN}` },
      body: 'y'.repeat(32 * 1024),
    })
    expect(oversized.status).toBe(413)
    expect(oversized.body).toBe(JSON.stringify({ error: 'payload too large' }))
    expect(received).toEqual([])
  })

  it('a path outside the prefix never has its body read, even under a /hooks/… spelling', async () => {
    const registry = new HookRegistry()
    const sessions = createSessionStore()
    const ingress = createHooksHttpIngress({
      hooks: registry,
      token: HOOKS_TOKEN,
      dispatchWake: createHooksWakeDispatcher(sessions),
    })
    const server = await startServer(composeHooksNodeHandler(ingress, webuiHandler))

    // A URL parser resolves '/hooks/../echo' to '/echo'; the pre-filter must
    // agree, or the downstream handler would receive an already-drained body.
    const echoed = await rawRequest(server.port, {
      method: 'POST',
      path: '/hooks/../echo',
      body: 'hello-passthrough',
    })
    expect(echoed.status).toBe(200)
    expect(echoed.body).toBe('hello-passthrough')
  })
})