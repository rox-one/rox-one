import { afterEach, describe, expect, it, spyOn } from 'bun:test'
import { createE2bApiServer, executeE2bCode } from '../e2b-tools.ts'
import { ApiSourcePoolClient } from '../../mcp/api-source-pool-client.ts'
const mockFetch = (handler: (url: Parameters<typeof fetch>[0], options?: RequestInit) => Promise<Response>) => handler as typeof fetch

describe('E2B backend sandbox execution', () => {
  let fetchSpy: ReturnType<typeof spyOn> | undefined
  afterEach(() => { fetchSpy?.mockRestore(); fetchSpy = undefined })

  it('creates, executes and destroys a real tool request without sending its API key to code', async () => {
    const requests: { url: string; options?: RequestInit }[] = []
    fetchSpy = spyOn(globalThis, 'fetch').mockImplementation(mockFetch(async (url, options) => {
      requests.push({ url: String(url), options })
      if (options?.method === 'DELETE') return new Response(null, { status: 204 })
      if (String(url).endsWith('/v2/sandboxes')) return Response.json({ sandboxID: 'fixture123', domain: 'e2b.app', envdAccessToken: 'ephemeral-fixture' })
      return new Response('{"type":"stdout","text":"42\\n"}\n{"type":"result","text":"42"}\n')
    }))
    const server = createE2bApiServer({ name: 'e2b', baseUrl: 'https://api.e2b.dev', auth: { type: 'header', headerName: 'X-API-Key' } }, async () => 'backend-fixture-key')
    const client = new ApiSourcePoolClient(server.instance)
    try {
      expect((await client.listTools()).map((tool) => tool.name).sort()).toEqual(['api_e2b', 'execute_code'])
      const result = await client.callTool('execute_code', { code: 'print(6 * 7)', language: 'python' })
      expect(JSON.stringify(result)).toContain('42')
      expect(JSON.stringify(result)).not.toContain('backend-fixture-key')
      expect(JSON.stringify(result)).not.toContain('ephemeral-fixture')
      expect(requests.map((request) => request.url)).toEqual([
        'https://api.e2b.dev/v2/sandboxes', 'https://49999-fixture123.e2b.app/execute', 'https://api.e2b.dev/sandboxes/fixture123',
      ])
      expect(new Headers(requests[0]!.options!.headers).get('X-API-Key')).toBe('backend-fixture-key')
      expect(new Headers(requests[1]!.options!.headers).get('X-API-Key')).toBeNull()
      expect(new Headers(requests[1]!.options!.headers).get('X-Access-Token')).toBe('ephemeral-fixture')
      expect(JSON.parse(String(requests[0]!.options!.body)).templateID).toBe('code-interpreter-v1')
      expect(JSON.parse(String(requests[1]!.options!.body))).toEqual({ code: 'print(6 * 7)', language: 'python' })
      expect(requests.every((request) => request.options?.redirect === 'error')).toBe(true)
    } finally { await client.close() }
  })

  it('always cleans up when execution fails or returns Python errors', async () => {
    let deleted = 0
    let executionStatus = 502
    fetchSpy = spyOn(globalThis, 'fetch').mockImplementation(mockFetch(async (url, options) => {
      if (options?.method === 'DELETE') { deleted++; return new Response(null, { status: 204 }) }
      if (String(url).endsWith('/v2/sandboxes')) return Response.json({ sandboxID: 'fixture123' })
      return executionStatus === 502 ? new Response('upstream', { status: 502 }) : new Response('{"type":"error","name":"NameError","value":"unknown variable","traceback":"line 1"}\n')
    }))
    await expect(executeE2bCode('fixture-key', { code: 'print(x)' })).rejects.toThrow('E2B execution failed (502)')
    expect(deleted).toBe(1)
    executionStatus = 200
    const result = await executeE2bCode('fixture-key', { code: 'print(x)' })
    expect(result.error).toEqual({ name: 'NameError', value: 'unknown variable', traceback: 'line 1' })
    expect(deleted).toBe(2)
  })

  it('rejects a provider-returned external domain before sending any sandbox token', async () => {
    const urls: string[] = []
    fetchSpy = spyOn(globalThis, 'fetch').mockImplementation(mockFetch(async (url, options) => {
      urls.push(String(url))
      return options?.method === 'DELETE' ? new Response(null, { status: 204 }) : Response.json({ sandboxID: 'fixture123', domain: 'other.example', envdAccessToken: 'ephemeral-fixture' })
    }))
    await expect(executeE2bCode('fixture-key', { code: '1+1' })).rejects.toThrow('unsupported sandbox domain')
    expect(urls).toEqual(['https://api.e2b.dev/v2/sandboxes', 'https://api.e2b.dev/sandboxes/fixture123'])
  })

  it('bounds execution duration/code/output and sanitizes transport failures', async () => {
    fetchSpy = spyOn(globalThis, 'fetch').mockImplementation(mockFetch(async () => { throw new Error('sensitive=fixture-key') }))
    await expect(executeE2bCode('fixture-key', { code: '1', timeoutSeconds: 121 })).rejects.toThrow('5–120')
    await expect(executeE2bCode('fixture-key', { code: 'x'.repeat(128 * 1024 + 1) })).rejects.toThrow('128 KiB')
    expect(fetchSpy).not.toHaveBeenCalled()
    const server = createE2bApiServer({ name: 'e2b', baseUrl: 'https://api.e2b.dev' }, 'fixture-key')
    const client = new ApiSourcePoolClient(server.instance)
    try {
      const result = await client.callTool('execute_code', { code: '1' })
      expect(JSON.stringify(result)).toContain('check backend connectivity')
      expect(JSON.stringify(result)).not.toContain('sensitive=')
    } finally { await client.close() }
    let deleted = false
    fetchSpy.mockImplementation(mockFetch(async (url, options) => {
      if (options?.method === 'DELETE') { deleted = true; return new Response(null, { status: 204 }) }
      return String(url).endsWith('/v2/sandboxes') ? Response.json({ sandboxID: 'fixture123' }) : new Response('x'.repeat(1024 * 1024 + 1))
    }))
    await expect(executeE2bCode('fixture-key', { code: '1' })).rejects.toThrow('1 MiB')
    expect(deleted).toBe(true)
  })
})
