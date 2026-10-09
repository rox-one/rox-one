import { describe, expect, it } from 'bun:test'
import { HookRegistry } from '../hooks.ts'
import { createHooksHttpIngress, HOOKS_WAKE_TEXT_LIMIT_BYTES, type HooksHttpIngress } from '../hooks-http.ts'
import { secureTokenCompare } from '../../bootstrap/headless-start.ts'

const TOKEN = 'hooks-secret-token-0123456789'
const BASE = 'http://127.0.0.1:9100'

interface Harness {
  registry: HookRegistry
  wakes: Array<{ sessionId: string; text: string }>
  logs: string[]
  ingress: HooksHttpIngress
  advance(ms: number): void
}

function harness(overrides: { bodyLimitBytes?: number } = {}): Harness {
  const registry = new HookRegistry()
  const wakes: Array<{ sessionId: string; text: string }> = []
  const logs: string[] = []
  let now = 0
  const ingress = createHooksHttpIngress({
    hooks: registry,
    token: TOKEN,
    dispatchWake: ({ sessionId, text }) => {
      wakes.push({ sessionId, text })
    },
    bodyLimitBytes: overrides.bodyLimitBytes ?? 64 * 1024,
    clock: () => now,
    logger: { warn: (message) => logs.push(message) },
  })
  return { registry, wakes, logs, ingress, advance: (ms) => { now += ms } }
}

function request(path: string, init: RequestInit = {}): Request {
  return new Request(`${BASE}${path}`, init)
}

function bearer(init: RequestInit = {}): RequestInit {
  return { ...init, headers: { ...(init.headers as Record<string, string> | undefined), authorization: `Bearer ${TOKEN}` } }
}

describe('createHooksHttpIngress', () => {
  it('rejects a ?token= query with 400 even when a valid bearer is also present', async () => {
    const h = harness()
    const response = await h.ingress.handle(request('/hooks/build?token=leaked', { method: 'POST', ...bearer({ body: '{}' }) }))
    expect(response?.status).toBe(400)
    expect(h.registry.listenerCount('build')).toBe(0)
  })

  it('rejects non-POST with 405 and Allow: POST', async () => {
    const h = harness()
    h.registry.on('build', () => {})
    const response = await h.ingress.handle(request('/hooks/build', { method: 'GET' }))
    expect(response?.status).toBe(405)
    expect(response?.headers.get('allow')).toBe('POST')
  })

  it('rejects a wrong or missing token with 401', async () => {
    const h = harness()
    h.registry.on('build', () => {})
    const missing = await h.ingress.handle(request('/hooks/build', { method: 'POST', body: '{}' }))
    expect(missing?.status).toBe(401)
    const wrong = await h.ingress.handle(request('/hooks/build', {
      method: 'POST',
      headers: { authorization: 'Bearer not-the-token' },
      body: '{}',
    }))
    expect(wrong?.status).toBe(401)
  })

  it('never logs the token or the request body', async () => {
    const h = harness()
    h.registry.on('build', () => {})
    await h.ingress.handle(request('/hooks/unknown', { method: 'POST', ...bearer({ body: '{"secret":"leak-me"}' }) }))
    await h.ingress.handle(request('/hooks/build', {
      method: 'POST',
      headers: { authorization: 'Bearer wrong-secret-999999999' },
      body: '{"secret":"leak-me"}',
    }))
    const joined = h.logs.join('\n')
    expect(h.logs.length).toBeGreaterThan(0)
    expect(joined).not.toContain(TOKEN)
    expect(joined).not.toContain('leak-me')
    expect(joined).not.toContain('wrong-secret-999999999')
  })

  it('accepts the token from Authorization: Bearer and from X-Rox-Hook-Token', async () => {
    const headerVariants: Array<Record<string, string>> = [
      { authorization: `Bearer ${TOKEN}` },
      { 'x-rox-hook-token': TOKEN },
    ]
    for (const headers of headerVariants) {
      const h = harness()
      let received: unknown
      h.registry.on('build', (payload) => { received = payload })
      const response = await h.ingress.handle(request('/hooks/build', { method: 'POST', headers, body: '{"ok":true}' }))
      expect(response?.status).toBe(200)
      expect(received).toEqual({ ok: true })
    }
  })

  it('delivers the exact parsed JSON body to every registered listener', async () => {
    const h = harness()
    const seen: unknown[] = []
    h.registry.on('deploy', (payload) => { seen.push(payload) })
    h.registry.on('deploy', (payload) => { seen.push(payload) })
    const body = '{"branch":"main","tags":["a","b"],"nested":{"n":7}}'
    const response = await h.ingress.handle(request('/hooks/deploy', { method: 'POST', ...bearer({ body }) }))
    expect(response?.status).toBe(200)
    expect(await response!.json()).toEqual({ invoked: 2, failures: 0 })
    expect(seen).toEqual([
      { branch: 'main', tags: ['a', 'b'], nested: { n: 7 } },
      { branch: 'main', tags: ['a', 'b'], nested: { n: 7 } },
    ])
  })

  it('returns 200 with failures > 0 when a listener throws', async () => {
    const h = harness()
    h.registry.on('build', () => {})
    h.registry.on('build', () => {
      throw new Error('listener exploded')
    })
    const response = await h.ingress.handle(request('/hooks/build', { method: 'POST', ...bearer({ body: '{}' }) }))
    expect(response?.status).toBe(200)
    const payload = await response!.json() as { invoked: number; failures: number }
    expect(payload.invoked).toBe(2)
    expect(payload.failures).toBeGreaterThan(0)
  })

  it('returns 404 for an empty subpath', async () => {
    const h = harness()
    for (const path of ['/hooks', '/hooks/']) {
      const response = await h.ingress.handle(request(path, { method: 'POST', ...bearer({ body: '{}' }) }))
      expect(response?.status).toBe(404)
    }
  })

  it('returns 404 for an unregistered event BEFORE touching the body', async () => {
    const h = harness({ bodyLimitBytes: 8 })
    h.registry.on('build', () => {})
    const oversized = 'x'.repeat(512)
    const response = await h.ingress.handle(request('/hooks/missing', { method: 'POST', ...bearer({ body: oversized }) }))
    // An event-check-after-body implementation would have produced 413 here.
    expect(response?.status).toBe(404)
  })

  it('bounds the body before buffering: over the limit -> 413, bad JSON -> 400', async () => {
    const h = harness({ bodyLimitBytes: 16 })
    h.registry.on('build', () => {})
    const tooLarge = await h.ingress.handle(request('/hooks/build', { method: 'POST', ...bearer({ body: 'x'.repeat(64) }) }))
    expect(tooLarge?.status).toBe(413)

    const badJson = await h.ingress.handle(request('/hooks/build', { method: 'POST', ...bearer({ body: 'not-json' }) }))
    expect(badJson?.status).toBe(400)
  })

  it('returns null for a path outside its base path', async () => {
    const h = harness()
    expect(await h.ingress.handle(request('/health', { method: 'POST' }))).toBeNull()
    expect(await h.ingress.handle(request('/hooksx/build', { method: 'POST' }))).toBeNull()
    expect(h.ingress.matches('/hooks/build')).toBe(true)
    expect(h.ingress.matches('/hooks')).toBe(true)
    expect(h.ingress.matches('/webui')).toBe(false)
  })

  describe('POST /hooks/wake', () => {
    it('validates and forwards a bounded payload to the injected dispatcher', async () => {
      const h = harness()
      const exactLimit = 'a'.repeat(HOOKS_WAKE_TEXT_LIMIT_BYTES)
      const ok = await h.ingress.handle(request('/hooks/wake', {
        method: 'POST',
        ...bearer({ body: JSON.stringify({ sessionId: 's-1', text: exactLimit }) }),
      }))
      expect(ok?.status).toBe(200)
      expect(await ok!.json()).toEqual({ ok: true })
      expect(h.wakes).toEqual([{ sessionId: 's-1', text: exactLimit }])

      const tooLong = 'a'.repeat(HOOKS_WAKE_TEXT_LIMIT_BYTES + 1)
      const rejected = await h.ingress.handle(request('/hooks/wake', {
        method: 'POST',
        ...bearer({ body: JSON.stringify({ sessionId: 's-1', text: tooLong }) }),
      }))
      expect(rejected?.status).toBe(400)
      expect(h.wakes).toHaveLength(1)
    })

    it('rejects a malformed wake payload with 400', async () => {
      const h = harness()
      for (const body of ['{}', '{"sessionId":""}', '{"sessionId":"s"}', '{"text":"hi"}', '"string"', 'null']) {
        const response = await h.ingress.handle(request('/hooks/wake', { method: 'POST', ...bearer({ body }) }))
        expect(response?.status).toBe(400)
      }
      expect(h.wakes).toHaveLength(0)
    })
  })

  describe('failure throttle', () => {
    it('emits 429 after ~20 failures and recovers once the window elapses', async () => {
      const h = harness()
      h.registry.on('build', () => {})
      const bad = () => request('/hooks/build', {
        method: 'POST',
        headers: { authorization: 'Bearer wrong' },
        body: '{}',
      })

      for (let attempt = 0; attempt < 20; attempt += 1) {
        expect((await h.ingress.handle(bad()))?.status).toBe(401)
      }
      const throttled = await h.ingress.handle(bad())
      expect(throttled?.status).toBe(429)
      expect(Number(throttled?.headers.get('retry-after'))).toBeGreaterThan(0)

      h.advance(61_000)
      expect((await h.ingress.handle(bad()))?.status).toBe(401)
    })
  })

  it('reports a live snapshot', async () => {
    const h = harness()
    h.registry.on('build', () => {})
    await h.ingress.handle(request('/hooks/build', { method: 'POST', ...bearer({ body: '{}' }) }))
    const snapshot = h.ingress.snapshot()
    expect(snapshot.basePath).toBe('/hooks')
    expect(snapshot.events).toEqual(['build'])
    expect(snapshot.dispatched).toBe(1)
    expect(snapshot.rejected).toBe(0)
  })

  it('computes a custom base path', () => {
    const h = harness()
    const custom = createHooksHttpIngress({
      hooks: h.registry,
      token: TOKEN,
      dispatchWake: () => {},
      basePath: 'internal/webhooks/',
    })
    expect(custom.basePath).toBe('/internal/webhooks')
    expect(custom.matches('/internal/webhooks/evt')).toBe(true)
    expect(custom.matches('/hooks/evt')).toBe(false)
  })

  it('refuses to install without a token', () => {
    const h = harness()
    expect(() => createHooksHttpIngress({
      hooks: h.registry,
      token: '',
      dispatchWake: () => {},
    })).toThrow()
  })

  it('compares tokens timing-safely across unequal lengths', () => {
    expect(secureTokenCompare(TOKEN, TOKEN)).toBe(true)
    expect(secureTokenCompare('short', TOKEN)).toBe(false)
    expect(secureTokenCompare(`${TOKEN}-and-then-some`, TOKEN)).toBe(false)
  })
})