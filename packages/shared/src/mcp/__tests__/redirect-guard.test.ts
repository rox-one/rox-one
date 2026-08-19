/**
 * Redirect guard for remote MCP transports — SSRF regression tests.
 *
 * SDK v1.29 SSEClientTransport / StreamableHTTPClientTransport call fetch with
 * the default redirect:'follow': a hostile or compromised MCP server can 302
 * the client onto internal endpoints (cloud metadata, admin panels) from the
 * main/desktop process. CraftMcpClient must inject a guarded fetch that
 * follows ONLY same-origin redirects and refuses cross-origin ones with a
 * typed error — the cross-origin target must never even be hit.
 */
import { describe, expect, it } from 'bun:test'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { CraftMcpClient } from '../client.ts'
import { createMcpGuardedFetch, McpRedirectError } from '../guarded-fetch.ts'

interface TestServer {
  server: Server
  port: number
  hits: string[]
}

function listen(
  handler: (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => void,
): Promise<TestServer> {
  const hits: string[] = []
  const server = createServer((req, res) => {
    hits.push(`${req.method} ${req.url}`)
    handler(req, res)
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () =>
      resolve({ server, port: (server.address() as AddressInfo).port, hits }),
    )
  })
}

async function closeAll(...servers: TestServer[]): Promise<void> {
  await Promise.all(servers.map((s) => new Promise<void>((r) => s.server.close(() => r()))))
}

/** Fire listTools without awaiting the handshake (SDK retries); watch side effects. */
async function probe(client: CraftMcpClient, waitMs: number): Promise<void> {
  const p = client.listTools().catch(() => {})
  await new Promise((r) => setTimeout(r, waitMs))
  await client.close().catch(() => {})
  await Promise.race([p, new Promise((r) => setTimeout(r, 500))])
}

describe('createMcpGuardedFetch', () => {
  it('passes non-redirect responses through untouched', async () => {
    const target = await listen((req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' })
      res.end('ok')
    })
    const guarded = createMcpGuardedFetch()
    const res = await guarded(`http://127.0.0.1:${target.port}/mcp`)
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('ok')
    expect(target.hits).toEqual(['GET /mcp'])
    await closeAll(target)
  })

  it('follows a same-origin redirect', async () => {
    const target = await listen((req, res) => {
      if (req.url === '/mcp') {
        res.writeHead(302, { location: '/mcp-final' })
        res.end()
        return
      }
      res.writeHead(200, { 'content-type': 'text/plain' })
      res.end('final')
    })
    const guarded = createMcpGuardedFetch()
    const res = await guarded(`http://127.0.0.1:${target.port}/mcp`)
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('final')
    expect(target.hits).toEqual(['GET /mcp', 'GET /mcp-final'])
    await closeAll(target)
  })

  it('preserves method and body across a same-origin 307', async () => {
    const target = await listen((req, res) => {
      if (req.url === '/mcp') {
        res.writeHead(307, { location: '/mcp-final' })
        res.end()
        return
      }
      let body = ''
      req.on('data', (c) => (body += c))
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'text/plain' })
        res.end(`${req.method}:${body}`)
      })
    })
    const guarded = createMcpGuardedFetch()
    const res = await guarded(`http://127.0.0.1:${target.port}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"jsonrpc":"2.0"}',
    })
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('POST:{"jsonrpc":"2.0"}')
    await closeAll(target)
  })

  it('throws McpRedirectError on a cross-origin redirect and never issues the second request', async () => {
    const internal = await listen((req, res) => {
      res.writeHead(200)
      res.end('internal-metadata')
    })
    const edge = await listen((req, res) => {
      res.writeHead(302, { location: `http://127.0.0.1:${internal.port}/latest/meta-data` })
      res.end()
    })
    const guarded = createMcpGuardedFetch()
    const err = await guarded(`http://127.0.0.1:${edge.port}/sse`).catch((e) => e)
    expect(err).toBeInstanceOf(McpRedirectError)
    expect(String(err?.message)).toMatch(/redirect/i)
    expect(internal.hits).toEqual([])
    await closeAll(edge, internal)
  })

  it('refuses a redirect chain that starts same-origin and escapes cross-origin', async () => {
    const internal = await listen((req, res) => {
      res.writeHead(200)
      res.end('internal')
    })
    const edge = await listen((req, res) => {
      if (req.url === '/hop1') {
        res.writeHead(302, { location: '/hop2' })
        res.end()
        return
      }
      res.writeHead(302, { location: `http://127.0.0.1:${internal.port}/x` })
      res.end()
    })
    const guarded = createMcpGuardedFetch()
    const err = await guarded(`http://127.0.0.1:${edge.port}/hop1`).catch((e) => e)
    expect(err).toBeInstanceOf(McpRedirectError)
    expect(edge.hits).toEqual(['GET /hop1', 'GET /hop2'])
    expect(internal.hits).toEqual([])
    await closeAll(edge, internal)
  })

  it('caps same-origin redirect loops with McpRedirectError', async () => {
    const loop = await listen((req, res) => {
      res.writeHead(302, { location: '/again' })
      res.end()
    })
    const guarded = createMcpGuardedFetch()
    const err = await guarded(`http://127.0.0.1:${loop.port}/again`).catch((e) => e)
    expect(err).toBeInstanceOf(McpRedirectError)
    expect(String(err?.message)).toMatch(/too many redirects/i)
    await closeAll(loop)
  })

  it('returns a 3xx without a Location header as-is (no redirect to follow)', async () => {
    const target = await listen((req, res) => {
      res.writeHead(304)
      res.end()
    })
    const guarded = createMcpGuardedFetch()
    const res = await guarded(`http://127.0.0.1:${target.port}/mcp`)
    expect(res.status).toBe(304)
    await closeAll(target)
  })
})

describe('CraftMcpClient — redirect SSRF guard', () => {
  it('SSE transport never follows a cross-origin 302 from the MCP endpoint', async () => {
    const internal = await listen((req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.end('event: endpoint\ndata: /message\n\n')
    })
    const edge = await listen((req, res) => {
      res.writeHead(302, { location: `http://127.0.0.1:${internal.port}/latest/meta-data` })
      res.end()
    })
    const client = new CraftMcpClient({
      transport: 'sse',
      url: `http://127.0.0.1:${edge.port}/sse`,
    })
    await probe(client, 2_500)
    expect(edge.hits.length).toBeGreaterThan(0)
    expect(internal.hits).toEqual([])
    await closeAll(edge, internal)
  }, 15_000)

  it('Streamable HTTP transport rejects a cross-origin 302 with a typed error', async () => {
    const internal = await listen((req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end('{}')
    })
    const edge = await listen((req, res) => {
      res.writeHead(302, { location: `http://127.0.0.1:${internal.port}/admin` })
      res.end()
    })
    const client = new CraftMcpClient({
      transport: 'http',
      url: `http://127.0.0.1:${edge.port}/mcp`,
    })
    const err = await client.listTools().catch((e: unknown) => e)
    await client.close().catch(() => {})
    expect(err).toBeInstanceOf(McpRedirectError)
    expect(String((err as Error)?.message)).toMatch(/redirect/i)
    expect(internal.hits).toEqual([])
    await closeAll(edge, internal)
  }, 15_000)

  it('Streamable HTTP still completes the handshake across a same-origin 307', async () => {
    const mcp = await listen((req, res) => {
      if (req.url === '/mcp') {
        res.writeHead(307, { location: '/mcp-final' })
        res.end()
        return
      }
      let body = ''
      req.on('data', (c) => (body += c))
      req.on('end', () => {
        let msg: { id?: unknown; method?: string; params?: { protocolVersion?: string } }
        try {
          msg = JSON.parse(body)
        } catch {
          res.writeHead(400).end()
          return
        }
        if (msg.id === undefined) {
          res.writeHead(202).end()
          return
        }
        if (msg.method === 'initialize') {
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end(
            JSON.stringify({
              jsonrpc: '2.0',
              id: msg.id,
              result: {
                protocolVersion: msg.params?.protocolVersion ?? '2025-11-25',
                capabilities: { tools: {} },
                serverInfo: { name: 'redirect-stub', version: '1.0.0' },
              },
            }),
          )
          return
        }
        if (msg.method === 'tools/list') {
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end(
            JSON.stringify({
              jsonrpc: '2.0',
              id: msg.id,
              result: {
                tools: [
                  {
                    name: 'ping',
                    description: 'ping',
                    inputSchema: { type: 'object', properties: {} },
                  },
                ],
              },
            }),
          )
          return
        }
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'nf' } }))
      })
    })
    const client = new CraftMcpClient({
      transport: 'http',
      url: `http://127.0.0.1:${mcp.port}/mcp`,
    })
    try {
      const tools = await client.listTools()
      expect(tools.map((t) => t.name)).toEqual(['ping'])
      expect(mcp.hits.filter((h) => h.includes('/mcp-final')).length).toBeGreaterThan(0)
    } finally {
      await client.close().catch(() => {})
      await closeAll(mcp)
    }
  }, 15_000)
})
