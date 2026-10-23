import { afterEach, describe, expect, it } from 'bun:test'
import {
  checkImChannelMembership,
  fetchImPresence,
  publishImServiceEvent,
  setImBridgeTransport,
  type ImBridgeTransport,
} from '../im-bridge.ts'

afterEach(() => setImBridgeTransport(null))

function transport(handler: (url: string, init?: RequestInit) => Promise<Response>, baseUrl = 'https://ws.example.test'): ImBridgeTransport {
  return {
    baseUrl: () => baseUrl,
    token: () => 'test-actor-jwt',
    fetch: (async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      return handler(url, init)
    }) as typeof fetch,
  }
}

describe('im-bridge membership', () => {
  it('returns unavailable when unconfigured (local fallback)', async () => {
    setImBridgeTransport(null)
    expect(await checkImChannelMembership('ch-1', 'user-1')).toBe('unavailable')
  })

  it('returns member on 200', async () => {
    setImBridgeTransport(transport(async (url) => {
      expect(url).toContain('/v1/im/channels/ch-1/members/user-1')
      return Response.json({ role: 'member' }, { status: 200 })
    }))
    expect(await checkImChannelMembership('ch-1', 'user-1')).toBe('member')
  })

  it('returns not-member on definitive 403', async () => {
    setImBridgeTransport(transport(async () => Response.json({ error: { code: 'FORBIDDEN' } }, { status: 403 })))
    expect(await checkImChannelMembership('ch-1', 'user-1')).toBe('not-member')
  })

  it('treats 404 / 502 / network as unavailable so pre-merge /im stays local', async () => {
    setImBridgeTransport(transport(async () => Response.json({ error: { code: 'NOT_FOUND' } }, { status: 404 })))
    expect(await checkImChannelMembership('ch-1', 'user-1')).toBe('unavailable')
    setImBridgeTransport(transport(async () => new Response('', { status: 502 })))
    expect(await checkImChannelMembership('ch-1', 'user-1')).toBe('unavailable')
    setImBridgeTransport(transport(async () => { throw new Error('ECONNREFUSED') }))
    expect(await checkImChannelMembership('ch-1', 'user-1')).toBe('unavailable')
  })

  it('rejects non-https non-loopback origins', async () => {
    setImBridgeTransport(transport(async () => Response.json({ role: 'member' }), 'http://evil.example'))
    expect(await checkImChannelMembership('ch-1', 'user-1')).toBe('unavailable')
  })
})

describe('im-bridge service-events', () => {
  it('posts call.started and reports published / duplicate', async () => {
    const seen: Array<{ url: string; body: unknown }> = []
    setImBridgeTransport(transport(async (url, init) => {
      seen.push({ url, body: JSON.parse(String(init?.body)) })
      return new Response(JSON.stringify({ eventId: 'evt-1' }), { status: seen.length === 1 ? 201 : 200 })
    }))
    const payload = { type: 'call.started' as const, roomName: 'rox-ch-ch-1', callId: 'call-1', startedBy: 'user-1', ts: 1_700_000_000_000 }
    expect(await publishImServiceEvent('ch-1', payload)).toBe('published')
    expect(await publishImServiceEvent('ch-1', payload)).toBe('duplicate')
    expect(seen[0]!.body).toMatchObject({ type: 'call.started', callId: 'call-1', roomName: 'rox-ch-ch-1' })
    expect(seen[0]!.url).toContain('/v1/im/channels/ch-1/service-events')
  })
})

describe('im-bridge presence', () => {
  it('returns null when unreachable (caller applies in-call + self fallback)', async () => {
    setImBridgeTransport(null)
    expect(await fetchImPresence(['a', 'b'])).toBeNull()
  })

  it('parses presence rows from GET /v1/im/presence', async () => {
    setImBridgeTransport(transport(async (url) => {
      expect(url).toContain('/v1/im/presence?userIds=alice,bob')
      return Response.json([
        { userId: 'alice', status: 'online', lastSeenAt: 10 },
        { userId: 'bob', status: 'away' },
        { userId: 'mallory', status: 'nope' },
      ])
    }))
    expect(await fetchImPresence(['alice', 'bob'])).toEqual([
      { userId: 'alice', status: 'online', lastSeenAt: 10 },
      { userId: 'bob', status: 'away' },
    ])
  })
})
