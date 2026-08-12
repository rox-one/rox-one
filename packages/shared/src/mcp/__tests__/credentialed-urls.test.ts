/**
 * Credentialed MCP URLs (userinfo) — regression tests.
 *
 * `http://user:pass@host` used to be accepted without validation and logged
 * verbatim by the sources RPC handler. Fixes under test:
 *  1. Save-time: validateSourceConfig rejects MCP URLs containing userinfo.
 *  2. Defense in depth: CraftMcpClient strips userinfo before constructing
 *     the SDK transport, so a hand-edited config.json can never put
 *     credentials on the wire or into error messages.
 *  3. Logging: formatMcpUrlForLog emits only origin + pathname (no
 *     userinfo, no query string).
 */
import { describe, expect, it } from 'bun:test'
import { CraftMcpClient, formatMcpUrlForLog } from '../client.ts'
import { validateSourceConfig } from '../../config/validators.ts'

function mcpSourceConfig(url: string) {
  return {
    id: 'src-cred',
    name: 'Credentialed',
    slug: 'cred-src',
    enabled: true,
    provider: 'custom',
    type: 'mcp',
    mcp: { transport: 'http' as const, url, authType: 'none' as const },
  }
}

describe('validateSourceConfig — credentialed MCP URLs', () => {
  it('rejects an MCP URL with username and password', () => {
    const result = validateSourceConfig(mcpSourceConfig('http://user:pass@example.com/mcp'))
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => /credential|userinfo/i.test(e.message))).toBe(true)
  })

  it('rejects an MCP URL with a bare username', () => {
    const result = validateSourceConfig(mcpSourceConfig('https://token@example.com/sse'))
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => /credential|userinfo/i.test(e.message))).toBe(true)
  })

  it('accepts a clean MCP URL', () => {
    const result = validateSourceConfig(mcpSourceConfig('https://example.com/mcp?version=2'))
    expect(result.valid).toBe(true)
  })

  it('still accepts stdio configs (no URL involved)', () => {
    const result = validateSourceConfig({
      id: 'src-stdio',
      name: 'Stdio',
      slug: 'stdio-src',
      enabled: true,
      provider: 'custom',
      type: 'mcp',
      mcp: { transport: 'stdio', command: '/usr/bin/true' },
    })
    expect(result.valid).toBe(true)
  })
})

describe('CraftMcpClient — userinfo defense in depth', () => {
  function transportUrl(client: CraftMcpClient): URL {
    const url = (client as unknown as { transport?: { _url?: URL } }).transport?._url
    if (!url) throw new Error('test setup: transport has no _url')
    return url
  }

  it('strips userinfo from the SSE transport URL', () => {
    const client = new CraftMcpClient({
      transport: 'sse',
      url: 'http://user:pass@127.0.0.1:9999/sse',
    })
    const url = transportUrl(client)
    expect(url.username).toBe('')
    expect(url.password).toBe('')
    expect(url.href).not.toContain('user')
    expect(url.host).toBe('127.0.0.1:9999')
    expect(url.pathname).toBe('/sse')
  })

  it('strips userinfo from the Streamable HTTP transport URL', () => {
    const client = new CraftMcpClient({
      transport: 'http',
      url: 'http://user:pass@127.0.0.1:9999/mcp',
    })
    const url = transportUrl(client)
    expect(url.username).toBe('')
    expect(url.password).toBe('')
    expect(url.host).toBe('127.0.0.1:9999')
  })
})

describe('formatMcpUrlForLog', () => {
  it('strips userinfo, query, and hash', () => {
    expect(formatMcpUrlForLog('http://user:pass@example.com:8080/mcp?apikey=secret#frag')).toBe(
      'http://example.com:8080/mcp',
    )
  })

  it('keeps a clean URL origin + pathname', () => {
    expect(formatMcpUrlForLog('https://mcp.example.com/')).toBe('https://mcp.example.com/')
  })

  it('never throws on an unparseable URL', () => {
    expect(formatMcpUrlForLog('not a url')).toBe('<invalid-url>')
  })
})
