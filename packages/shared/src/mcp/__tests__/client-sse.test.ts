/**
 * SSE transport support — regression tests.
 *
 * CraftMcpClient used to implement ONLY StreamableHTTPClientTransport while
 * the source config/UI admitted transport:'sse'; the pool silently coerced
 * sse → http, which deterministically fails against pure legacy SSE servers
 * (they answer GET text/event-stream + accept client messages on a separate
 * POST endpoint, and 405 plain POSTs to the SSE URL).
 *
 * These tests run a real legacy-SSE MCP server (SDK SSEServerTransport, no
 * Streamable HTTP endpoint) and prove the full client path: CraftMcpClient,
 * McpClientPool mapping, and validateMcpConnection.
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { createServer, type Server as HttpServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { CraftMcpClient } from '../client.ts'
import { McpClientPool } from '../mcp-pool.ts'
import { validateMcpConnection } from '../validation.ts'

// ============================================================
// Stub legacy SSE-only MCP server
// ============================================================

interface SeenRequest {
  method: string
  path: string
  authorization?: string
}

let httpServer: HttpServer
let sseUrl: string
let authenticatedSseUrl: string
const seen: SeenRequest[] = []
const fixtureAuthorization = 'Bearer sse-token-123'

function buildMcpServerStub(): Server {
  const server = new Server(
    { name: 'sse-stub', version: '2.1.0' },
    { capabilities: { tools: {} } },
  )
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'echo_sse',
        description: 'Echo text back over SSE',
        inputSchema: {
          type: 'object' as const,
          properties: { text: { type: 'string' } },
          required: ['text'],
        },
      },
    ],
  }))
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    if (req.params.name !== 'echo_sse') {
      return {
        content: [{ type: 'text' as const, text: `unknown tool: ${req.params.name}` }],
        isError: true,
      }
    }
    const text = (req.params.arguments as { text?: string } | undefined)?.text ?? ''
    return { content: [{ type: 'text' as const, text: `sse-echo:${text}` }] }
  })
  return server
}

beforeAll(async () => {
  const transports = new Map<string, SSEServerTransport>()
  const authenticatedTransports = new Map<string, SSEServerTransport>()

  httpServer = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    seen.push({
      method: req.method ?? '?',
      path: url.pathname,
      authorization: req.headers['authorization'],
    })

    const authenticated = url.pathname === '/authenticated-sse' || url.pathname === '/authenticated-messages'
    if (authenticated && req.headers['authorization'] !== fixtureAuthorization) {
      res.writeHead(401).end('Unauthorized')
      return
    }

    if (req.method === 'GET' && (url.pathname === '/sse' || url.pathname === '/authenticated-sse')) {
      const sessions = authenticated ? authenticatedTransports : transports
      const transport = new SSEServerTransport(authenticated ? '/authenticated-messages' : '/messages', res)
      sessions.set(transport.sessionId, transport)
      res.on('close', () => {
        sessions.delete(transport.sessionId)
      })
      const mcp = buildMcpServerStub()
      mcp.connect(transport).catch(() => {})
      return
    }

    if (req.method === 'POST' && (url.pathname === '/messages' || url.pathname === '/authenticated-messages')) {
      const sessionId = url.searchParams.get('sessionId') ?? ''
      const transport = (authenticated ? authenticatedTransports : transports).get(sessionId)
      if (!transport) {
        res.writeHead(404).end('unknown session')
        return
      }
      transport.handlePostMessage(req, res).catch(() => {
        if (!res.headersSent) res.writeHead(500)
        res.end()
      })
      return
    }

    // Deliberately no Streamable HTTP endpoint: any plain JSON-RPC POST to
    // /sse (what the old sse→http coercion produced) gets a 405.
    res.writeHead(405).end('SSE-only stub: GET /sse + POST /messages only')
  })

  await new Promise<void>((resolve) => {
    httpServer.listen(0, '127.0.0.1', () => resolve())
  })
  const { port } = httpServer.address() as AddressInfo
  sseUrl = `http://127.0.0.1:${port}/sse`
  authenticatedSseUrl = `http://127.0.0.1:${port}/authenticated-sse`
})

afterAll(async () => {
  await new Promise<void>((resolve) => httpServer.close(() => resolve()))
})

// ============================================================
// CraftMcpClient
// ============================================================

describe('CraftMcpClient — SSE transport', () => {
  it('connects to a legacy SSE-only server and lists tools', async () => {
    const client = new CraftMcpClient({ transport: 'sse', url: sseUrl })
    try {
      const tools = await client.listTools()
      expect(tools.map((t) => t.name)).toEqual(['echo_sse'])
      expect(client.getServerInfo()).toEqual({ name: 'sse-stub', version: '2.1.0' })
    } finally {
      await client.close()
    }
  })

  it('calls a tool over the SSE POST channel', async () => {
    const client = new CraftMcpClient({ transport: 'sse', url: sseUrl })
    try {
      const result = (await client.callTool('echo_sse', { text: 'hello' })) as {
        content: Array<{ type: string; text?: string }>
      }
      expect(result.content[0]?.text).toBe('sse-echo:hello')
    } finally {
      await client.close()
    }
  })

  it('sends configured headers on the SSE handshake and the POST channel', async () => {
    const before = seen.length
    // Late traffic from an anonymous client belongs to the ordinary channel.
    const unrelated = await fetch(new URL('/messages?sessionId=unrelated', sseUrl), { method: 'POST' })
    await unrelated.text()
    expect(unrelated.status).toBe(404)
    const client = new CraftMcpClient({
      transport: 'sse',
      url: authenticatedSseUrl,
      headers: { Authorization: 'Bearer sse-token-123' },
    })
    try {
      await client.listTools()
    } finally {
      await client.close()
    }
    const related = seen.slice(before)
    const handshake = related.find((r) => r.method === 'GET' && r.path === '/authenticated-sse')
    const posts = related.filter((r) => r.method === 'POST' && r.path === '/authenticated-messages')
    expect(handshake?.authorization).toBe('Bearer sse-token-123')
    expect(posts.length).toBeGreaterThan(0)
    for (const post of posts) {
      expect(post.authorization).toBe('Bearer sse-token-123')
    }
  })

  it('rejects missing authorization on both protected SSE endpoints', async () => {
    const post = await fetch(new URL('/authenticated-messages?sessionId=unauthorized', authenticatedSseUrl), { method: 'POST' })
    await post.text()
    expect(post.status).toBe(401)
    const client = new CraftMcpClient({ transport: 'sse', url: authenticatedSseUrl })
    try {
      await expect(client.listTools()).rejects.toThrow()
    } finally {
      await client.close()
    }
  })

  it('fails cleanly when pointed at the SSE-only endpoint with HTTP transport', async () => {
    // Guard test: proves the stub really is SSE-only, i.e. the other tests
    // would fail under the old silent sse→http coercion.
    const client = new CraftMcpClient({ transport: 'http', url: sseUrl })
    await expect(client.listTools()).rejects.toThrow()
    await client.close().catch(() => {})
  })
})

// ============================================================
// McpClientPool mapping
// ============================================================

describe('McpClientPool — SSE source mapping', () => {
  it('connects a type:"sse" source via the real SSE transport (no http coercion)', async () => {
    const pool = new McpClientPool()
    try {
      const failures = await pool.sync({
        stub: { type: 'sse', url: sseUrl },
      })
      expect(failures).toEqual([])
      expect(pool.isConnected('stub')).toBe(true)
      expect(pool.getTools('stub').map((t) => t.name)).toEqual(['echo_sse'])

      const defs = pool.getProxyToolDefs()
      expect(defs.map((d) => d.name)).toEqual(['mcp__stub__echo_sse'])

      const result = await pool.callTool('mcp__stub__echo_sse', { text: 'via-pool' })
      expect(result.isError).toBe(false)
      expect(result.content).toBe('sse-echo:via-pool')
    } finally {
      await pool.disconnectAll()
    }
  })
})

// ============================================================
// validateMcpConnection
// ============================================================

describe('validateMcpConnection — SSE transport', () => {
  it('honors mcpTransport:"sse" instead of forcing Streamable HTTP', async () => {
    const result = await validateMcpConnection({ mcpUrl: sseUrl, mcpTransport: 'sse' })
    expect(result.success).toBe(true)
    expect(result.tools).toEqual(['echo_sse'])
    expect(result.serverInfo).toEqual({ name: 'sse-stub', version: '2.1.0' })
  })
})
