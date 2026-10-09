import { afterEach, describe, expect, it, vi } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  HANDOFF_TOKEN_MAX_TTL_MS,
  HandoffTokenStore,
  hashHandoffToken,
} from '../auth'
import { createWebuiHandler, type WebuiHandler } from '../http-server'
import type { Logger } from '../../runtime/platform'

const SECRET = 'handoff-test-secret'
const PASSWORD = 'handoff-test-password'
const TEMP_DIRS: string[] = []
const HANDLERS: WebuiHandler[] = []

function createTestWebuiDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'craft-webui-handoff-'))
  TEMP_DIRS.push(dir)
  writeFileSync(join(dir, 'login.html'), '<!doctype html><html><body>login</body></html>')
  writeFileSync(join(dir, 'index.html'), '<!doctype html><html><body>app shell</body></html>')
  mkdirSync(join(dir, 'login-assets'))
  return dir
}

const silentLogger: Logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }

function createHandler(overrides?: { handoffTtlMs?: number; logger?: Logger }): WebuiHandler {
  const handler = createWebuiHandler({
    webuiDir: createTestWebuiDir(),
    secret: SECRET,
    password: PASSWORD,
    wsProtocol: 'ws',
    wsPort: 9100,
    getHealthCheck: () => ({ status: 'ok' }),
    logger: overrides?.logger ?? silentLogger,
    handoffTtlMs: overrides?.handoffTtlMs,
  })
  HANDLERS.push(handler)
  return handler
}

function handoffRequest(token?: string, extra?: { url?: string; accept?: string; method?: string }) {
  const headers: Record<string, string> = {}
  if (token) headers['X-Handoff-Token'] = token
  if (extra?.accept) headers.Accept = extra.accept
  return new Request(extra?.url ?? 'http://127.0.0.1/handoff', {
    method: extra?.method ?? 'GET',
    headers,
  })
}

afterEach(() => {
  while (HANDLERS.length > 0) HANDLERS.pop()?.dispose()
  while (TEMP_DIRS.length > 0) {
    const dir = TEMP_DIRS.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

describe('HandoffTokenStore', () => {
  it('redeems a minted token exactly once', () => {
    const store = new HandoffTokenStore()
    const { token } = store.mint()
    expect(store.redeem(token)).toBe('ok')
    expect(store.redeem(token)).toBe('invalid')
    expect(store.size).toBe(0)
  })

  it('rejects an expired token and consumes it anyway (no replay)', () => {
    const store = new HandoffTokenStore(1_000)
    const { token, expiresAt } = store.mint(0)
    expect(expiresAt).toBe(1_000)
    expect(store.redeem(token, 1_001)).toBe('expired')
    expect(store.redeem(token, 1_001)).toBe('invalid')
  })

  it('never retains the raw token — only its sha256 digest', () => {
    const store = new HandoffTokenStore()
    const { token } = store.mint()
    const digests = store.storedDigests()
    expect(digests).toEqual([hashHandoffToken(token)])
    expect(digests).not.toContain(token)
    expect(store.redeem(token)).toBe('ok')
  })

  it('bounds the TTL to at most 120 s and rejects non-positive values', () => {
    expect(() => new HandoffTokenStore(HANDOFF_TOKEN_MAX_TTL_MS + 1)).toThrow()
    expect(() => new HandoffTokenStore(0)).toThrow()
    expect(() => new HandoffTokenStore(-1)).toThrow()
  })

  it('sweeps expired records', () => {
    const store = new HandoffTokenStore(1_000)
    store.mint(0)
    expect(store.size).toBe(1)
    store.sweep(2_000)
    expect(store.size).toBe(0)
  })
})

describe('GET /handoff route', () => {
  it('consumes a token from the header and sets the session cookie', async () => {
    const handler = createHandler()
    const { token } = handler.createHandoffToken()

    const res = await handler.fetch(handoffRequest(token))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(res.headers.get('set-cookie')).toContain('craft_session=')
  })

  it('rejects a replayed token', async () => {
    const handler = createHandler()
    const { token } = handler.createHandoffToken()

    expect((await handler.fetch(handoffRequest(token))).status).toBe(200)
    const replay = await handler.fetch(handoffRequest(token))
    expect(replay.status).toBe(401)
    expect(await replay.json()).toEqual({ error: 'Invalid handoff token' })
  })

  it('rejects an expired token', async () => {
    vi.useFakeTimers()
    try {
      const handler = createHandler({ handoffTtlMs: 5 })
      const { token } = handler.createHandoffToken()
      vi.advanceTimersByTime(10)

      const res = await handler.fetch(handoffRequest(token))
      expect(res.status).toBe(401)
      expect(await res.json()).toEqual({ error: 'Handoff token expired' })
    } finally {
      vi.useRealTimers()
    }
  })

  it('rejects an unknown token', async () => {
    const handler = createHandler()
    const res = await handler.fetch(handoffRequest('not-a-real-token-000000000000'))
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'Invalid handoff token' })
  })

  it('never reads a token from the query string', async () => {
    const handler = createHandler()
    const { token } = handler.createHandoffToken()

    const viaQuery = await handler.fetch(handoffRequest(undefined, { url: `http://127.0.0.1/handoff?token=${token}` }))
    expect(viaQuery.status).toBe(400)
    expect(await viaQuery.json()).toEqual({ error: 'Handoff token required' })

    // The token must remain unconsumed and still redeemable via the header.
    expect((await handler.fetch(handoffRequest(token))).status).toBe(200)
  })

  it('does not put the token into logs on success or failure', async () => {
    const calls: string[] = []
    const logger = {
      info: (...args: unknown[]) => calls.push(JSON.stringify(args)),
      warn: (...args: unknown[]) => calls.push(JSON.stringify(args)),
      error: (...args: unknown[]) => calls.push(JSON.stringify(args)),
      debug: (...args: unknown[]) => calls.push(JSON.stringify(args)),
    }
    const handler = createHandler({ logger })

    const { token } = handler.createHandoffToken()
    expect((await handler.fetch(handoffRequest(token))).status).toBe(200)
    const { token: second } = handler.createHandoffToken()
    expect((await handler.fetch(handoffRequest(second))).status).toBe(200)

    const unknown = 'unknown-token-000000000000000000000000'
    expect((await handler.fetch(handoffRequest(unknown))).status).toBe(401)

    expect(calls.length).toBeGreaterThan(0)
    for (const entry of calls) {
      expect(entry).not.toContain(token)
      expect(entry).not.toContain(second)
      expect(entry).not.toContain(unknown)
    }
  })

  it('serves the SPA shell for a browser navigation, but not for non-HTML clients', async () => {
    const handler = createHandler()
    const html = await handler.fetch(handoffRequest(undefined, { accept: 'text/html,*/*' }))
    expect(html.status).toBe(200)
    expect(html.headers.get('content-type')).toContain('text/html')
    expect(html.headers.get('content-security-policy')).toContain("frame-ancestors 'none'")

    const json = await handler.fetch(handoffRequest(undefined, { accept: 'application/json' }))
    expect(json.status).toBe(400)
  })
})