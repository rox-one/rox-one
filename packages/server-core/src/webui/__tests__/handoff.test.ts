import { afterEach, describe, expect, it, vi } from 'bun:test'
import { createHash } from 'node:crypto'
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

  it('serves a self-contained handoff page for a browser navigation, but not for non-HTML clients', async () => {
    const handler = createHandler()
    const html = await handler.fetch(handoffRequest(undefined, { accept: 'text/html,*/*' }))
    expect(html.status).toBe(200)
    expect(html.headers.get('content-type')).toContain('text/html')
    expect(html.headers.get('content-security-policy')).toContain("frame-ancestors 'none'")
    expect(html.headers.get('cache-control')).toBe('no-store')
    // Self-contained: must not depend on the session-gated /assets bundle.
    const body = await html.text()
    expect(body).not.toContain('/assets/')
    expect(body).toContain('<script>')

    const json = await handler.fetch(handoffRequest(undefined, { accept: 'application/json' }))
    expect(json.status).toBe(400)
  })
})

/** Pull the single inline `<script>` body out of the handoff page. */
function extractHandoffScript(html: string): string {
  const match = html.match(/<script(?:\s[^>]*)?>([^]*?)<\/script>/i)
  if (!match) throw new Error('handoff page has no inline script')
  return match[1]!
}

interface HandoffScriptResult {
  statusText: string
  redirectedTo: string | null
  fetchCalls: Array<{ url: string; init: RequestInit | undefined }>
}

/**
 * Execute the handoff page's inline script against a minimal DOM/history mock,
 * exactly as a cookie-less browser would after landing on `/handoff#<token>`.
 * The script's promise chain is awaited deterministically by collecting the
 * promises `fetch` returns (no wall-clock waits).
 */
async function runHandoffScript(
  html: string,
  options: { hash: string; fetchImpl: (url: string, init?: RequestInit) => Promise<Response> },
): Promise<HandoffScriptResult> {
  const statusEl = { textContent: '', state: null as string | null }
  const fetchCalls: HandoffScriptResult['fetchCalls'] = []
  const pendingFetches: Array<Promise<Response>> = []
  let redirectedTo: string | null = null
  const windowMock = {
    location: {
      hash: options.hash,
      replace: (url: string) => { redirectedTo = url },
    },
  }
  const documentMock = {
    getElementById: (id: string) => (id === 'handoff-status'
      ? { setAttribute: (_n: string, v: string) => { statusEl.state = v }, set textContent(v: string) { statusEl.textContent = v }, get textContent() { return statusEl.textContent } }
      : null),
  }
  const instrumentedFetch = (url: string, init?: RequestInit) => {
    fetchCalls.push({ url, init })
    const pending = options.fetchImpl(url, init)
    pendingFetches.push(pending)
    return pending
  }
  const run = new Function('window', 'document', 'fetch', extractHandoffScript(html))
  run(windowMock, documentMock, instrumentedFetch)
  // The script attaches its `.then` immediately, so draining the collected
  // promises also drains its continuation — no arbitrary delay.
  await Promise.all(pendingFetches)
  await Promise.resolve()
  return { statusText: statusEl.textContent, redirectedTo, fetchCalls }
}

describe('cookie-less pairing flow over the handoff page', () => {
  const FLOW_HANDLERS: WebuiHandler[] = []

  function createFlowHandler(): WebuiHandler {
    const handler = createHandler()
    FLOW_HANDLERS.push(handler)
    return handler
  }

  afterEach(() => {
    while (FLOW_HANDLERS.length > 0) FLOW_HANDLERS.pop()?.dispose()
  })

  it('loads the page, redeems the fragment, sets the cookie and rejects replay', async () => {
    const handler = createFlowHandler()
    const { token } = handler.createHandoffToken()

    // 1. Cookie-less navigation: only the fragment carries the token.
    const pageRes = await handler.fetch(handoffRequest(undefined, { accept: 'text/html' }))
    expect(pageRes.status).toBe(200)
    const html = await pageRes.text()
    expect(html).not.toContain('/assets/')

    // The strict CSP admits the page's inline script by hash only.
    const scriptSrc = pageRes.headers.get('content-security-policy')!
      .split(';').map(part => part.trim()).find(part => part.startsWith('script-src'))!
    const scriptHash = `'sha256-${createHash('sha256').update(extractHandoffScript(html), 'utf8').digest('base64')}'`
    expect(scriptSrc).toContain(scriptHash)
    expect(scriptSrc).not.toContain('unsafe-inline')

    // 2. Browser executes the script: redeem via header, capture the cookie.
    let sessionCookie: string | null = null
    const result = await runHandoffScript(html, {
      hash: `#handoff=${token}`,
      fetchImpl: async (url, init) => {
        const res = await handler.fetch(new Request(new URL(url, 'http://127.0.0.1').href, init))
        const setCookie = res.headers.get('set-cookie')
        if (setCookie) sessionCookie = setCookie.split(';')[0]!
        return res
      },
    })

    expect(result.redirectedTo).toBe('/')
    expect(result.fetchCalls).toHaveLength(1)
    expect(result.fetchCalls[0]!.init?.headers).toEqual({ 'X-Handoff-Token': token })
    expect(sessionCookie!).toContain('craft_session=')

    // 3. The freshly minted cookie authenticates a gated request.
    const config = await handler.fetch(new Request('http://127.0.0.1/api/config', {
      headers: { cookie: sessionCookie! },
    }))
    expect(config.status).toBe(200)

    // 4. Single use: replaying the same token fails.
    expect((await handler.fetch(handoffRequest(token))).status).toBe(401)
  })

  it('shows an error and makes no request when the fragment has no usable token', async () => {
    const handler = createFlowHandler()
    const html = await (await handler.fetch(handoffRequest(undefined, { accept: 'text/html' }))).text()

    const result = await runHandoffScript(html, {
      hash: '#not-a-token',
      fetchImpl: async () => { throw new Error('fetch must not be called') },
    })

    expect(result.fetchCalls).toHaveLength(0)
    expect(result.redirectedTo).toBeNull()
    expect(result.statusText).toBe('This pairing link is missing its token.')
  })

  it('reports an expired/invalid token without redirecting', async () => {
    const handler = createFlowHandler()
    const html = await (await handler.fetch(handoffRequest(undefined, { accept: 'text/html' }))).text()

    const result = await runHandoffScript(html, {
      hash: '#handoff=unknown-token-000000000000',
      fetchImpl: (url, init) => handler.fetch(new Request(new URL(url, 'http://127.0.0.1').href, init)),
    })

    expect(result.fetchCalls).toHaveLength(1)
    expect(result.redirectedTo).toBeNull()
    expect(result.statusText).toBe('This pairing link is invalid or has expired.')
  })
})

describe('POST /handoff/mint', () => {
  async function authenticatedCookie(handler: WebuiHandler): Promise<string> {
    const res = await handler.fetch(new Request('http://127.0.0.1/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: PASSWORD }),
    }))
    expect(res.status).toBe(200)
    return res.headers.get('set-cookie')!.split(';')[0]!
  }

  function mintRequest(headers: Record<string, string>): Request {
    return new Request('http://127.0.0.1/handoff/mint', { method: 'POST', headers })
  }

  it('rejects an unauthenticated mint', async () => {
    const handler = createHandler()
    const res = await handler.fetch(mintRequest({ Origin: 'http://127.0.0.1' }))
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'Unauthorized' })
    expect(handler.createHandoffToken).toBeDefined()
  })

  it('rejects a cross-origin mint even with a valid session cookie', async () => {
    const handler = createHandler()
    const cookie = await authenticatedCookie(handler)
    const res = await handler.fetch(mintRequest({ cookie, Origin: 'https://evil.example' }))
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'Cross-origin request rejected' })
  })

  it('rejects a cross-site fetch metadata signal', async () => {
    const handler = createHandler()
    const cookie = await authenticatedCookie(handler)
    const res = await handler.fetch(mintRequest({ cookie, 'Sec-Fetch-Site': 'cross-site' }))
    expect(res.status).toBe(403)
  })

  it('mints a pairing URL for a same-origin authenticated operator that redeems exactly once', async () => {
    const handler = createHandler()
    const cookie = await authenticatedCookie(handler)

    const res = await handler.fetch(mintRequest({ cookie, Origin: 'http://127.0.0.1' }))
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')

    const body = await res.json() as { url: string; expiresAt: number }
    expect(body.url).toMatch(/^http:\/\/127\.0\.0\.1\/handoff#[A-Za-z0-9_-]{16,}$/)
    expect(body.expiresAt).toBeGreaterThan(Date.now())
    // The token lives in the fragment, never in a query string.
    expect(body.url.split('#')[0]).not.toContain('token')

    const token = body.url.split('#')[1]!
    expect((await handler.fetch(handoffRequest(token))).status).toBe(200)
    expect((await handler.fetch(handoffRequest(token))).status).toBe(401)
  })

  it('never logs the minted token', async () => {
    const calls: string[] = []
    const logger: Logger = {
      info: (...args: unknown[]) => calls.push(JSON.stringify(args)),
      warn: (...args: unknown[]) => calls.push(JSON.stringify(args)),
      error: (...args: unknown[]) => calls.push(JSON.stringify(args)),
      debug: (...args: unknown[]) => calls.push(JSON.stringify(args)),
    }
    const handler = createHandler({ logger })
    const cookie = await authenticatedCookie(handler)

    const res = await handler.fetch(mintRequest({ cookie, Origin: 'http://127.0.0.1' }))
    const { url } = await res.json() as { url: string }
    const token = url.split('#')[1]!

    expect(calls.length).toBeGreaterThan(0)
    for (const entry of calls) expect(entry).not.toContain(token)
  })
})