import { describe, expect, test } from 'bun:test'

import { DEFAULT_UNFURL_LIMITS, buildUnfurlGraph, decodeUrlTokens, unfurlUrl } from '../unfurlCore.ts'
import type { UnfurlNode, UnfurlResult } from '../../types.ts'

function nodeWith(nodes: UnfurlNode[], predicate: (node: UnfurlNode) => boolean): UnfurlNode | undefined {
  return nodes.find(predicate)
}

describe('unfurlCore.decodeUrlTokens', () => {
  test('decomposes URL structure with the root as every top-level parent', () => {
    const { tokens, truncated } = decodeUrlTokens('https://example.com/a/b?x=1#frag')
    expect(truncated).toBe(false)

    const scheme = tokens.find((token) => token.dataType === 'url.scheme')
    expect(scheme?.value).toBe('https')
    expect(scheme?.parentId).toBe('1')

    const host = tokens.find((token) => token.dataType === 'url.hostname')
    expect(host?.value).toBe('example.com')

    const segments = tokens.filter((token) => token.dataType === 'url.path.segment').map((token) => token.value)
    expect(segments).toEqual(['a', 'b'])

    const pair = tokens.find((token) => token.dataType === 'url.query.pair')
    expect(pair?.key).toBe('x')
    expect(pair?.value).toBe('1')
  })

  test('decodes a base64-wrapped URL', () => {
    const wrapped = Buffer.from('https://evil.example', 'utf8').toString('base64')
    const result = unfurlUrl(`https://example.com/?u=${wrapped}`, 1)

    expect(result.error).toBeNull()
    expect(result.tokens).toContain(wrapped)
    const host = nodeWith(result.graph.nodes, (node) => node.dataType === 'url.hostname' && node.value === 'evil.example')
    expect(host).toBeDefined()
  })

  test('expands JWT header and payload fields', () => {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' }), 'utf8').toString('base64url')
    const payload = Buffer.from(
      JSON.stringify({ sub: 'user123', iss: 'https://issuer.example', exp: 1700000000 }),
      'utf8',
    ).toString('base64url')
    const jwt = `${header}.${payload}.${Buffer.from('signature1234', 'utf8').toString('base64url')}`

    const result = unfurlUrl(`https://example.com/cb?token=${jwt}`, 1)

    expect(result.error).toBeNull()
    expect(result.tokens).toContain(jwt)
    const subject = nodeWith(result.graph.nodes, (node) => node.dataType === 'json' && node.key === 'sub')
    expect(subject?.value).toBe('user123')
    // `exp` is a NumericDate, so it must also resolve as a unix-seconds timestamp.
    const expiry = result.timestamps.find((timestamp) => timestamp.kind === 'unix-seconds')
    expect(expiry?.epochMs).toBe(1700000000 * 1000)
  })

  test('decodes a hex-encoded string', () => {
    const result = unfurlUrl('https://example.com/?h=48656c6c6f', 1)
    const decoded = nodeWith(result.graph.nodes, (node) => node.decoder === 'hex' && node.value === 'Hello')
    expect(decoded).toBeDefined()
  })

  test('percent-decodes a redirect parameter into a nested URL node', () => {
    const result = unfurlUrl('https://t.co/?redirect=https%3A%2F%2Fexample.com%2Fpath', 1)
    const nested = nodeWith(result.graph.nodes, (node) => node.dataType === 'url' && node.value === 'https://example.com/path')
    expect(nested).toBeDefined()
    const host = nodeWith(result.graph.nodes, (node) => node.dataType === 'url.hostname' && node.value === 'example.com')
    expect(host).toBeDefined()
    // The nested URL hangs off the decoded string, not off the root.
    expect(nested?.parentId).not.toBe('1')
  })

  test('decodes an embedded unix-milliseconds timestamp to the right ISO string', () => {
    const epochMs = 1700000000000
    const result = unfurlUrl(`https://example.com/?ts=${epochMs}`, 1)

    const iso = new Date(epochMs).toISOString()
    const timestamp = result.timestamps.find((entry) => entry.kind === 'unix-millis')
    expect(timestamp).toBeDefined()
    expect(timestamp?.epochMs).toBe(epochMs)
    expect(timestamp?.iso).toBe(iso)

    const node = nodeWith(result.graph.nodes, (item) => item.dataType === 'timestamp.unix-millis')
    expect(node?.value).toBe(iso)
    expect(node?.id).toBe(timestamp?.nodeId ?? undefined)
  })

  test('decodes a base64-wrapped redirect URL all the way to its timestamp', () => {
    const url =
      'https://example.com/r?u=aHR0cHM6Ly9leGFtcGxlLm9yZy9hP3Q9MTc4MzkwMTI0NzkzOA%3D%3D&jwt=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NSIsImV4cCI6MTc4MzkwMTI0N30.x'
    const result = unfurlUrl(url, 1)

    expect(result.error).toBeNull()
    expect(result.truncated).toBe(false)
    const nested = nodeWith(
      result.graph.nodes,
      (node) => node.dataType === 'url' && node.value === 'https://example.org/a?t=1783901247938',
    )
    expect(nested).toBeDefined()
    expect(result.timestamps.length).toBeGreaterThan(0)
    const millis = result.timestamps.find((timestamp) => timestamp.kind === 'unix-millis')
    expect(millis?.epochMs).toBe(1783901247938)
  })

  test('flags truncation when the node cap is exceeded', () => {
    const params = Array.from({ length: 400 }, (_, index) => `k${index}=v${index}`).join('&')
    const { truncated, tokens } = decodeUrlTokens(`https://example.com/?${params}`)
    expect(truncated).toBe(true)
    expect(tokens.length).toBeLessThanOrEqual(DEFAULT_UNFURL_LIMITS.maxNodes - 1)
  })

  test('flags truncation when a small node cap is given', () => {
    const { truncated } = decodeUrlTokens('https://example.com/a/b/c/d/e', { ...DEFAULT_UNFURL_LIMITS, maxNodes: 3 })
    expect(truncated).toBe(true)
  })

  test('flags truncation when an explicit depth cap is exceeded', () => {
    const wrapped = Buffer.from('https://deep.example/x', 'utf8').toString('base64')
    const { truncated } = decodeUrlTokens(`https://example.com/?u=${encodeURIComponent(wrapped)}`, {
      ...DEFAULT_UNFURL_LIMITS,
      maxDepth: 1,
    })
    expect(truncated).toBe(true)
  })
})

describe('unfurlCore.buildUnfurlGraph', () => {
  test('roots at id 1 and links each child to its parent with a depth', () => {
    const { tokens } = decodeUrlTokens('https://example.com/a?x=1')
    const graph = buildUnfurlGraph('https://example.com/a?x=1', tokens)

    expect(graph.nodes[0]).toMatchObject({ id: '1', dataType: 'url', parentId: null })
    expect(new Set(graph.nodes.map((node) => node.id)).size).toBe(graph.nodes.length)
    expect(graph.edges).toHaveLength(tokens.length)
    expect(graph.edges[0]).toMatchObject({ id: 'e1', source: '1' })
    for (const edge of graph.edges) {
      const target = graph.nodes.find((node) => node.id === edge.target)
      expect(target?.parentId).toBe(edge.source)
    }
  })
})

describe('unfurlCore.unfurlUrl', () => {
  test('returns an error (never throws) for an unparseable URL', () => {
    let result: UnfurlResult | null = null
    expect(() => {
      result = unfurlUrl('http://[', 7)
    }).not.toThrow()

    expect(result).not.toBeNull()
    expect(result!.urlId).toBe(7)
    expect(result!.error).not.toBeNull()
    expect(result!.tokens).toEqual([])
    expect(result!.timestamps).toEqual([])
    expect(result!.identifiers).toEqual([])
    expect(result!.depth).toBe(0)
    // The graph is still root-only so the persisted row is always a valid graph.
    expect(result!.graph.nodes).toHaveLength(1)
    expect(result!.graph.nodes[0].id).toBe('1')
  })

  test('records identifiers and a non-zero depth for a rich URL', () => {
    const result = unfurlUrl('https://example.com/?sha=5d41402abc4b2a76b9719d911017c592', 1)
    expect(result.error).toBeNull()
    expect(result.depth).toBeGreaterThan(0)
    expect(result.identifiers.some((identifier) => identifier.kind === 'hash.md5')).toBe(true)
  })
})