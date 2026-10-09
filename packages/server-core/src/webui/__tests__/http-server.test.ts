import { afterEach, describe, expect, it } from 'bun:test'
import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createWebuiHandler, resolveWebuiFile, startWebuiHttpServer } from '../http-server'
import type { OidcConfig } from '../auth'

const SECRET = 'test-server-secret'
const PASSWORD = 'test-password'
const TEMP_DIRS: string[] = []
const SERVERS: Array<{ stop: () => void }> = []

const logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
} as any

function createTestWebuiDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'craft-webui-test-'))
  TEMP_DIRS.push(dir)
  writeFileSync(join(dir, 'login.html'), '<!doctype html><html><body>login</body></html>')
  writeFileSync(join(dir, 'index.html'), '<!doctype html><html><body>app</body></html>')
  mkdirSync(join(dir, 'login-assets'))
  writeFileSync(join(dir, 'login-assets', 'ok.css'), 'body{}')
  return dir
}

async function createServer(overrides?: {
  secureCookies?: boolean
  publicWsUrl?: string
  wsProtocol?: 'ws' | 'wss'
  wsPort?: number
}) {
  const server = await startWebuiHttpServer({
    port: 0,
    webuiDir: createTestWebuiDir(),
    secret: SECRET,
    password: PASSWORD,
    secureCookies: overrides?.secureCookies,
    publicWsUrl: overrides?.publicWsUrl,
    wsProtocol: overrides?.wsProtocol ?? 'wss',
    wsPort: overrides?.wsPort ?? 9100,
    getHealthCheck: () => ({ status: 'ok' }),
    logger,
  })

  SERVERS.push(server)

  return {
    server,
    baseUrl: `http://127.0.0.1:${server.port}`,
  }
}

function extractSessionCookie(res: Response): string {
  const setCookie = res.headers.get('set-cookie')
  expect(setCookie).toBeTruthy()
  return setCookie!.split(';')[0]!
}

afterEach(() => {
  while (SERVERS.length > 0) {
    SERVERS.pop()?.stop()
  }

  while (TEMP_DIRS.length > 0) {
    const dir = TEMP_DIRS.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

describe('startWebuiHttpServer', () => {
  it('allows plain-http login even when the RPC transport is wss', async () => {
    const { baseUrl } = await createServer({ wsProtocol: 'wss', wsPort: 9100 })

    const authRes = await fetch(`${baseUrl}/api/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: PASSWORD }),
    })

    expect(authRes.status).toBe(200)
    const setCookie = authRes.headers.get('set-cookie')
    expect(setCookie).toContain('craft_session=')
    expect(setCookie).not.toContain('Secure')

    const configRes = await fetch(`${baseUrl}/api/config`, {
      headers: {
        cookie: extractSessionCookie(authRes),
      },
    })

    expect(configRes.status).toBe(200)
    expect(await configRes.json()).toEqual({
      wsUrl: 'wss://127.0.0.1:9100',
    })
  })

  it('rejects invalid credentials', async () => {
    const { baseUrl } = await createServer()

    const res = await fetch(`${baseUrl}/api/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'wrong-password' }),
    })

    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'Invalid credentials' })
  })

  it('honors an explicit secure-cookie override', async () => {
    const { baseUrl } = await createServer({ secureCookies: true, wsProtocol: 'ws', wsPort: 9100 })

    const res = await fetch(`${baseUrl}/api/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: PASSWORD }),
    })

    expect(res.status).toBe(200)
    expect(res.headers.get('set-cookie')).toContain('Secure')
  })

  it('infers secure cookies from proxy https headers when no override is set', async () => {
    const { baseUrl } = await createServer({ wsProtocol: 'wss', wsPort: 9100 })

    const res = await fetch(`${baseUrl}/api/auth`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-Proto': 'https',
      },
      body: JSON.stringify({ password: PASSWORD }),
    })

    expect(res.status).toBe(200)
    expect(res.headers.get('set-cookie')).toContain('Secure')
  })

  it('derives a browser-facing websocket URL from forwarded public host headers', async () => {
    const { baseUrl } = await createServer({ wsProtocol: 'wss', wsPort: 9100 })

    const authRes = await fetch(`${baseUrl}/api/auth`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-Proto': 'https',
        'X-Forwarded-Host': 'craft.example.com:3100',
      },
      body: JSON.stringify({ password: PASSWORD }),
    })

    const configRes = await fetch(`${baseUrl}/api/config`, {
      headers: {
        cookie: extractSessionCookie(authRes),
        'X-Forwarded-Proto': 'https',
        'X-Forwarded-Host': 'craft.example.com:3100',
      },
    })

    expect(configRes.status).toBe(200)
    expect(await configRes.json()).toEqual({
      wsUrl: 'wss://craft.example.com:9100',
    })
  })

  it('returns an explicit public websocket URL override from /api/config', async () => {
    const { baseUrl } = await createServer({
      publicWsUrl: 'wss://craft.example.com/ws',
      wsProtocol: 'wss',
      wsPort: 9100,
    })

    const authRes = await fetch(`${baseUrl}/api/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: PASSWORD }),
    })

    const configRes = await fetch(`${baseUrl}/api/config`, {
      headers: {
        cookie: extractSessionCookie(authRes),
      },
    })

    expect(configRes.status).toBe(200)
    expect(await configRes.json()).toEqual({
      wsUrl: 'wss://craft.example.com/ws',
    })
  })
})

describe('WebUI login rate-limit IP keying', () => {
  const HANDLERS: Array<{ dispose: () => void }> = []

  afterEach(() => {
    while (HANDLERS.length > 0) {
      HANDLERS.pop()?.dispose()
    }
    while (TEMP_DIRS.length > 0) {
      const dir = TEMP_DIRS.pop()
      if (dir) rmSync(dir, { recursive: true, force: true })
    }
  })

  function createHandler(opts?: {
    resolveClientIp?: (req: Request) => string | null
    trustedProxies?: string[]
  }) {
    const handler = createWebuiHandler({
      webuiDir: createTestWebuiDir(),
      secret: SECRET,
      password: PASSWORD,
      wsProtocol: 'ws',
      wsPort: 9100,
      getHealthCheck: () => ({ status: 'ok' }),
      logger,
      resolveClientIp: opts?.resolveClientIp,
      trustedProxies: opts?.trustedProxies,
    })
    HANDLERS.push(handler)
    return handler
  }

  async function auth(handler: { fetch: (req: Request) => Promise<Response> }, extraHeaders?: Record<string, string>) {
    return handler.fetch(new Request('http://127.0.0.1/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...extraHeaders },
      body: JSON.stringify({ password: 'wrong-password' }),
    }))
  }

  it('rate-limits each resolved client IP independently', async () => {
    let ip = '203.0.113.10'
    const handler = createHandler({ resolveClientIp: () => ip })

    for (let i = 0; i < 5; i++) {
      expect((await auth(handler)).status).toBe(401)
    }
    expect((await auth(handler)).status).toBe(429)

    ip = '203.0.113.20'
    expect((await auth(handler)).status).toBe(401)
  })

  it('ignores spoofed X-Forwarded-For when the socket is not a trusted proxy', async () => {
    const handler = createHandler({
      resolveClientIp: () => '198.51.100.7',
      trustedProxies: ['10.0.0.1'],
    })

    for (let i = 0; i < 5; i++) {
      expect((await auth(handler, { 'X-Forwarded-For': '203.0.113.99' })).status).toBe(401)
    }
    expect((await auth(handler, { 'X-Forwarded-For': '203.0.113.1' })).status).toBe(429)
  })

  it('uses X-Forwarded-For only when the socket IP is a trusted proxy', async () => {
    const handler = createHandler({
      resolveClientIp: () => '10.0.0.1',
      trustedProxies: ['10.0.0.1'],
    })

    for (let i = 0; i < 5; i++) {
      expect((await auth(handler, { 'X-Forwarded-For': '203.0.113.40' })).status).toBe(401)
    }
    expect((await auth(handler, { 'X-Forwarded-For': '203.0.113.40' })).status).toBe(429)
    expect((await auth(handler, { 'X-Forwarded-For': '203.0.113.41' })).status).toBe(401)
  })
})

describe('resolveWebuiFile', () => {
  it('keeps assets inside the webui dir and rejects traversal', () => {
    const dir = createTestWebuiDir()
    expect(resolveWebuiFile(dir, '/login-assets/ok.css')).toBe(join(dir, 'login-assets', 'ok.css'))
    expect(resolveWebuiFile(dir, '/login-assets/../login.html')).toBe(join(dir, 'login.html'))
    expect(resolveWebuiFile(dir, '/login-assets/../../etc/passwd')).toBeNull()
    expect(resolveWebuiFile(dir, '/login-assets/..%2f..%2fetc/passwd')).toBeNull()
    expect(resolveWebuiFile(dir, '/login-assets/%2e%2e/%2e%2e/etc/passwd')).toBeNull()
  })
})

describe('WebUI static path containment', () => {
  it('does not serve files outside webuiDir via unauthenticated login-assets', async () => {
    const webuiDir = createTestWebuiDir()
    const outside = join(webuiDir, '..', 'secret.txt')
    writeFileSync(outside, 'classified')

    const handler = createWebuiHandler({
      webuiDir,
      secret: SECRET,
      password: PASSWORD,
      wsProtocol: 'ws',
      wsPort: 9100,
      getHealthCheck: () => ({ status: 'ok' }),
      logger,
    })

    try {
      const res = await handler.fetch(new Request('http://127.0.0.1/login-assets/..%2f..%2fsecret.txt'))
      expect(res.status).toBe(404)
      expect(await res.text()).not.toContain('classified')

      const ok = await handler.fetch(new Request('http://127.0.0.1/login-assets/ok.css'))
      expect(ok.status).toBe(200)
      expect(await ok.text()).toBe('body{}')
    } finally {
      handler.dispose()
    }
  })
})

// ---------------------------------------------------------------------------
// OIDC (Rox ID) session auth
// ---------------------------------------------------------------------------

const CLIENT_ID = 'test-client'

interface FakeIssuer {
  issuer: string
  setNonce: (nonce: string) => void
  /** Override minted id_token claims (`iss`/`aud`/`exp`). */
  setClaims: (patch: { iss?: string; aud?: string | string[]; exp?: number }) => void
  /** Sign id_tokens with a key that is NOT in the served JWKS. */
  setBrokenSignature: (broken: boolean) => void
  /** Rotate the signing key and served JWKS (new kid). */
  rotateKey: () => void
  /** How many times `/jwks` has been served. */
  jwksRequests: () => number
  stop: () => void
}

function createFakeIssuer(): FakeIssuer {
  const generate = (kid: string) => {
    const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
    const jwk = { ...publicKey.export({ format: 'jwk' }), kid, use: 'sig', alg: 'RS256' }
    return { jwk, privateKey }
  }

  let current = generate('test-key')
  const foreign = generateKeyPairSync('rsa', { modulusLength: 2048 })
  let nonceToSign = ''
  let claimOverrides: { iss?: string; aud?: string | string[]; exp?: number } = {}
  let brokenSignature = false
  let jwksServed = 0

  const server: Bun.Server<undefined> = Bun.serve({
    port: 0,
    fetch(req: Request): Response {
      const url = new URL(req.url)
      const base: string = `http://127.0.0.1:${server.port}`
      if (url.pathname === '/.well-known/openid-configuration') {
        return Response.json({
          issuer: base,
          authorization_endpoint: `${base}/authorize`,
          token_endpoint: `${base}/token`,
          jwks_uri: `${base}/jwks`,
        })
      }
      if (url.pathname === '/jwks') {
        jwksServed++
        return Response.json({ keys: [current.jwk] })
      }
      if (url.pathname === '/token') {
        const now = Math.floor(Date.now() / 1000)
        const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: current.jwk.kid })).toString('base64url')
        const payload = Buffer.from(JSON.stringify({
          iss: claimOverrides.iss ?? base,
          aud: claimOverrides.aud ?? CLIENT_ID,
          sub: 'rox-user-1',
          email: 'user@rox.one',
          name: 'Rox User',
          preferred_username: 'roxuser',
          nonce: nonceToSign,
          iat: now,
          exp: claimOverrides.exp ?? now + 300,
        })).toString('base64url')
        const signingKey = brokenSignature ? foreign.privateKey : current.privateKey
        const signature = sign('RSA-SHA256', Buffer.from(`${header}.${payload}`), signingKey).toString('base64url')
        return Response.json({ id_token: `${header}.${payload}.${signature}` })
      }
      return new Response('not found', { status: 404 })
    },
  })

  return {
    issuer: `http://127.0.0.1:${server.port}`,
    setNonce: (nonce: string) => { nonceToSign = nonce },
    setClaims: (patch) => { claimOverrides = { ...claimOverrides, ...patch } },
    setBrokenSignature: (broken: boolean) => { brokenSignature = broken },
    rotateKey: () => { current = generate('test-key-2') },
    jwksRequests: () => jwksServed,
    stop: () => server.stop(true),
  }
}

describe('WebUI OIDC (Rox ID) sessions', () => {
  const HANDLERS: Array<{ dispose: () => void }> = []
  const ISSUERS: FakeIssuer[] = []

  afterEach(() => {
    while (HANDLERS.length > 0) HANDLERS.pop()?.dispose()
    while (ISSUERS.length > 0) ISSUERS.pop()?.stop()
    while (TEMP_DIRS.length > 0) {
      const dir = TEMP_DIRS.pop()
      if (dir) rmSync(dir, { recursive: true, force: true })
    }
  })

  function createHandler(options?: { oidc?: OidcConfig; allowPasswordLogin?: boolean }) {
    const handler = createWebuiHandler({
      webuiDir: createTestWebuiDir(),
      secret: SECRET,
      password: PASSWORD,
      wsProtocol: 'ws',
      wsPort: 9100,
      getHealthCheck: () => ({ status: 'ok' }),
      logger,
      ...(options?.oidc ? { oidc: options.oidc } : {}),
      ...(options?.allowPasswordLogin !== undefined ? { allowPasswordLogin: options.allowPasswordLogin } : {}),
    })
    HANDLERS.push(handler)
    return handler
  }

  function oidcHandler(overrides?: { allowPasswordLogin?: boolean; publicUrl?: string }) {
    const issuer = createFakeIssuer()
    ISSUERS.push(issuer)
    const handler = createHandler({
      oidc: {
        issuer: issuer.issuer,
        clientId: CLIENT_ID,
        publicUrl: overrides?.publicUrl ?? 'http://127.0.0.1:3100',
      },
      allowPasswordLogin: overrides?.allowPasswordLogin,
    })
    return { handler, issuer }
  }

  async function startLogin(handler: { fetch: (req: Request) => Promise<Response> }) {
    const res = await handler.fetch(new Request('http://127.0.0.1/api/auth/login'))
    expect(res.status).toBe(302)
    const location = new URL(res.headers.get('location')!)
    const stateCookieHeader = res.headers.get('set-cookie')!
    return {
      url: location,
      state: location.searchParams.get('state')!,
      nonce: location.searchParams.get('nonce')!,
      stateCookieHeader,
      stateCookie: stateCookieHeader.split(';')[0]!,
    }
  }

  function callbackRequest(state: string, stateCookie?: string | null, code = 'auth-code') {
    return new Request(`http://127.0.0.1/api/auth/callback?code=${code}&state=${state}`, {
      headers: stateCookie ? { cookie: stateCookie } : {},
    })
  }

  it('redirects to the IdP with PKCE, state and nonce', async () => {
    const { handler, issuer } = oidcHandler()
    const { url, state, nonce, stateCookieHeader } = await startLogin(handler)

    expect(url.origin).toBe(issuer.issuer)
    expect(url.pathname).toBe('/authorize')
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('client_id')).toBe(CLIENT_ID)
    expect(url.searchParams.get('scope')).toBe('openid profile email')
    expect(url.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:3100/api/auth/callback')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('code_challenge')).toBeTruthy()
    expect(state).toBeTruthy()
    expect(nonce).toBeTruthy()

    // The state cookie binds the callback to this browser.
    expect(stateCookieHeader).toContain(`oidc_state=${state}`)
    expect(stateCookieHeader).toContain('HttpOnly')
    expect(stateCookieHeader).toContain('SameSite=Lax')
    expect(stateCookieHeader).toContain('Path=/')
    expect(stateCookieHeader).toContain('Max-Age=600')
  })

  it('sets a session cookie on a valid callback and authorizes protected endpoints', async () => {
    const { handler, issuer } = oidcHandler()
    const { state, nonce, stateCookie } = await startLogin(handler)
    issuer.setNonce(nonce)

    const callback = await handler.fetch(callbackRequest(state, stateCookie))
    expect(callback.status).toBe(302)
    expect(callback.headers.get('location')).toBe('/')
    const cookie = callback.headers.get('set-cookie')
    expect(cookie).toContain('craft_session=')
    // The one-time state cookie is cleared once consumed.
    expect(cookie).toContain('oidc_state=;')

    const cookieHeader = cookie!.split(';')[0]!
    const config = await handler.fetch(new Request('http://127.0.0.1/api/config', {
      headers: { cookie: cookieHeader },
    }))
    expect(config.status).toBe(200)
    expect(await config.json()).toEqual({ wsUrl: 'ws://127.0.0.1:9100', authMode: 'oidc' })

    const me = await handler.fetch(new Request('http://127.0.0.1/api/auth/me', {
      headers: { cookie: cookieHeader },
    }))
    expect(me.status).toBe(200)
    expect(await me.json()).toEqual({
      authMode: 'oidc',
      issuer: issuer.issuer,
      user: { sub: 'rox-user-1', email: 'user@rox.one', name: 'Rox User', username: 'roxuser' },
    })
  })

  it('rejects a tampered state without setting a cookie', async () => {
    const { handler, issuer } = oidcHandler()
    const { stateCookie } = await startLogin(handler)
    issuer.setNonce('irrelevant')

    const callback = await handler.fetch(callbackRequest('tampered-state', stateCookie))
    expect(callback.status).toBe(400)
    expect(callback.headers.get('set-cookie')).toBeNull()
    const body = await callback.text()
    expect(body).toContain('Не удалось войти')
  })

  it('rejects an id_token with the wrong nonce', async () => {
    const { handler, issuer } = oidcHandler()
    const { state, stateCookie } = await startLogin(handler)
    issuer.setNonce('wrong-nonce')

    const callback = await handler.fetch(callbackRequest(state, stateCookie))
    expect(callback.status).toBe(400)
    expect(callback.headers.get('set-cookie')).not.toContain('craft_session=')
    expect(await callback.text()).toContain('Не удалось войти')
  })

  it('rejects an id_token with an invalid signature', async () => {
    const { handler, issuer } = oidcHandler()
    const { state, nonce, stateCookie } = await startLogin(handler)
    issuer.setNonce(nonce)
    issuer.setBrokenSignature(true)

    const callback = await handler.fetch(callbackRequest(state, stateCookie))
    expect(callback.status).toBe(400)
    expect(callback.headers.get('set-cookie')).not.toContain('craft_session=')
    expect(await callback.text()).toContain('Не удалось войти')
  })

  it('rejects an id_token with the wrong issuer', async () => {
    const { handler, issuer } = oidcHandler()
    const { state, nonce, stateCookie } = await startLogin(handler)
    issuer.setNonce(nonce)
    issuer.setClaims({ iss: 'https://evil.example' })

    const callback = await handler.fetch(callbackRequest(state, stateCookie))
    expect(callback.status).toBe(400)
    expect(callback.headers.get('set-cookie')).not.toContain('craft_session=')
    expect(await callback.text()).toContain('Не удалось войти')
  })

  it('rejects an id_token with the wrong audience', async () => {
    const { handler, issuer } = oidcHandler()
    const { state, nonce, stateCookie } = await startLogin(handler)
    issuer.setNonce(nonce)
    issuer.setClaims({ aud: 'some-other-client' })

    const callback = await handler.fetch(callbackRequest(state, stateCookie))
    expect(callback.status).toBe(400)
    expect(callback.headers.get('set-cookie')).not.toContain('craft_session=')
    expect(await callback.text()).toContain('Не удалось войти')
  })

  it('rejects an expired id_token', async () => {
    const { handler, issuer } = oidcHandler()
    const { state, nonce, stateCookie } = await startLogin(handler)
    issuer.setNonce(nonce)
    issuer.setClaims({ exp: Math.floor(Date.now() / 1000) - 3600 })

    const callback = await handler.fetch(callbackRequest(state, stateCookie))
    expect(callback.status).toBe(400)
    expect(callback.headers.get('set-cookie')).not.toContain('craft_session=')
    expect(await callback.text()).toContain('Не удалось войти')
  })

  it('rejects a callback with no oidc_state cookie', async () => {
    const { handler, issuer } = oidcHandler()
    const { state, nonce } = await startLogin(handler)
    issuer.setNonce(nonce)

    const callback = await handler.fetch(callbackRequest(state, null))
    expect(callback.status).toBe(400)
    expect(callback.headers.get('set-cookie')).toBeNull()
    expect(await callback.text()).toContain('Не удалось войти')
  })

  it('rejects a callback carrying a foreign oidc_state cookie', async () => {
    const { handler, issuer } = oidcHandler()
    const { state, nonce } = await startLogin(handler)
    issuer.setNonce(nonce)

    const callback = await handler.fetch(callbackRequest(state, 'oidc_state=attacker-controlled'))
    expect(callback.status).toBe(400)
    expect(callback.headers.get('set-cookie')).toBeNull()
    expect(await callback.text()).toContain('Не удалось войти')
  })

  it('rejects a replayed state on the second callback', async () => {
    const { handler, issuer } = oidcHandler()
    const { state, nonce, stateCookie } = await startLogin(handler)
    issuer.setNonce(nonce)

    const first = await handler.fetch(callbackRequest(state, stateCookie))
    expect(first.status).toBe(302)
    expect(first.headers.get('set-cookie')).toContain('craft_session=')

    const replay = await handler.fetch(callbackRequest(state, stateCookie))
    expect(replay.status).toBe(400)
    expect(replay.headers.get('set-cookie')).not.toContain('craft_session=')
    expect(await replay.text()).toContain('Не удалось войти')
  })

  it('refetches JWKS once when the id_token kid is unknown (key rotation)', async () => {
    const { handler, issuer } = oidcHandler()

    // Warm the cached JWKS with the original key.
    const first = await startLogin(handler)
    issuer.setNonce(first.nonce)
    const firstCallback = await handler.fetch(callbackRequest(first.state, first.stateCookie))
    expect(firstCallback.status).toBe(302)
    const jwksAfterFirst = issuer.jwksRequests()
    expect(jwksAfterFirst).toBe(1)

    // Rotate the IdP signing key: the cached set no longer has the new kid.
    issuer.rotateKey()

    const second = await startLogin(handler)
    issuer.setNonce(second.nonce)
    const secondCallback = await handler.fetch(callbackRequest(second.state, second.stateCookie))
    expect(secondCallback.status).toBe(302)
    expect(secondCallback.headers.get('set-cookie')).toContain('craft_session=')
    // Exactly one cache-bypassing refetch recovered the rotated key.
    expect(issuer.jwksRequests()).toBe(jwksAfterFirst + 1)
  })

  it('rate-limits OIDC login starts per client IP before allocating state', async () => {
    const issuer = createFakeIssuer()
    ISSUERS.push(issuer)
    const handler = createHandler({
      oidc: { issuer: issuer.issuer, clientId: CLIENT_ID, publicUrl: 'http://127.0.0.1:3100' },
    })

    for (let i = 0; i < 5; i++) {
      const res = await handler.fetch(new Request('http://127.0.0.1/api/auth/login'))
      expect(res.status).toBe(302)
    }
    const limited = await handler.fetch(new Request('http://127.0.0.1/api/auth/login'))
    expect(limited.status).toBe(429)
  })

  it('returns 404 for password login when OIDC is enabled and not opted in', async () => {
    const { handler } = oidcHandler()

    const auth = await handler.fetch(new Request('http://127.0.0.1/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: PASSWORD }),
    }))
expect(auth.status).toBe(404)
  })

  it('keeps password login when OIDC is enabled and explicitly opted in', async () => {
    const { handler } = oidcHandler({ allowPasswordLogin: true })

    const auth = await handler.fetch(new Request('http://127.0.0.1/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: PASSWORD }),
    }))
    expect(auth.status).toBe(200)
    expect(auth.headers.get('set-cookie')).toContain('craft_session=')
  })

  it('forces Secure cookies for an https OIDC public URL without proxy headers', async () => {
    const { handler } = oidcHandler({ publicUrl: 'https://rox.example.com' })

    const res = await handler.fetch(new Request('http://127.0.0.1/api/auth/login'))
    expect(res.status).toBe(302)
    expect(res.headers.get('set-cookie')).toContain('Secure')
  })

  it('keeps the password flow unchanged when OIDC is not configured', async () => {
    const handler = createHandler()

    const config = await handler.fetch(new Request('http://127.0.0.1/api/auth/config'))
    expect(await config.json()).toEqual({ authMode: 'password' })

    const login = await handler.fetch(new Request('http://127.0.0.1/api/auth/login'))
    expect(login.status).toBe(404)

    const auth = await handler.fetch(new Request('http://127.0.0.1/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: PASSWORD }),
    }))
    expect(auth.status).toBe(200)
    expect(auth.headers.get('set-cookie')).toContain('craft_session=')
  })
})

describe('WebUI security headers on every route', () => {
  const INLINE = 'console.log("boot");\n'
  const SECURED_HANDLERS: Array<{ dispose: () => void }> = []

  afterEach(() => {
    while (SECURED_HANDLERS.length > 0) SECURED_HANDLERS.pop()?.dispose()
    while (TEMP_DIRS.length > 0) {
      const dir = TEMP_DIRS.pop()
      if (dir) rmSync(dir, { recursive: true, force: true })
    }
  })

  function createHardenedHandler() {
    const dir = mkdtempSync(join(tmpdir(), 'craft-webui-headers-'))
    TEMP_DIRS.push(dir)
    writeFileSync(join(dir, 'login.html'), `<!doctype html><html><head><style>body{}</style></head><body><script>${INLINE}</script></body></html>`)
    writeFileSync(join(dir, 'index.html'), `<!doctype html><html><body><script>${INLINE}</script></body></html>`)
    mkdirSync(join(dir, 'assets'))
    writeFileSync(join(dir, 'assets', 'app.js'), 'export const x = 1')
    const handler = createWebuiHandler({
      webuiDir: dir,
      secret: SECRET,
      password: PASSWORD,
      wsProtocol: 'ws',
      wsPort: 9100,
      getHealthCheck: () => ({ status: 'ok' }),
      logger,
    })
    SECURED_HANDLERS.push(handler)
    return handler
  }

  function assertSecured(res: Response, expectHash: boolean): void {
    expect(res.headers.get('x-frame-options')).toBe('DENY')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('referrer-policy')).toBe('no-referrer')
    const csp = res.headers.get('content-security-policy')
    expect(csp).toContain("frame-ancestors 'none'")
    expect(csp).toContain("object-src 'none'")
    expect(csp).toContain("connect-src 'self' ws: wss:")
    expect(csp).toContain("img-src 'self' data: blob:")
    const hash = `'sha256-${createHash('sha256').update(INLINE, 'utf8').digest('base64')}'`
    if (expectHash) expect(csp).toContain(hash)
  }

  it('secures login, static assets, auth API, config API, SPA and errors', async () => {
    const handler = createHardenedHandler()

    const login = await handler.fetch(new Request('http://127.0.0.1/login'))
    expect(login.status).toBe(200)
    assertSecured(login, true)

    const asset = await handler.fetch(new Request('http://127.0.0.1/login-assets/../assets/app.js'))
    expect(asset.headers.get('content-security-policy')).toBeTruthy()

    const unauthConfig = await handler.fetch(new Request('http://127.0.0.1/api/config'))
    expect(unauthConfig.status).toBe(401)
    assertSecured(unauthConfig, false)

    const auth = await handler.fetch(new Request('http://127.0.0.1/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: PASSWORD }),
    }))
    expect(auth.status).toBe(200)
    assertSecured(auth, false)

    const cookie = auth.headers.get('set-cookie')!.split(';')[0]!
    const config = await handler.fetch(new Request('http://127.0.0.1/api/config', { headers: { cookie } }))
    expect(config.status).toBe(200)
    assertSecured(config, false)

    const spa = await handler.fetch(new Request('http://127.0.0.1/some/route', { headers: { cookie } }))
    expect(spa.status).toBe(200)
    assertSecured(spa, true)

    const health = await handler.fetch(new Request('http://127.0.0.1/health'))
    expect(health.status).toBe(200)
    assertSecured(health, false)
  })

  it('secures a 404 when the SPA shell is missing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'craft-webui-404-'))
    TEMP_DIRS.push(dir)
    writeFileSync(join(dir, 'login.html'), '<!doctype html><html><body>login</body></html>')
    const handler = createWebuiHandler({
      webuiDir: dir,
      secret: SECRET,
      password: PASSWORD,
      wsProtocol: 'ws',
      wsPort: 9100,
      getHealthCheck: () => ({ status: 'ok' }),
      logger,
    })
    SECURED_HANDLERS.push(handler)

    const auth = await handler.fetch(new Request('http://127.0.0.1/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: PASSWORD }),
    }))
    const cookie = auth.headers.get('set-cookie')!.split(';')[0]!
    const res = await handler.fetch(new Request('http://127.0.0.1/missing', { headers: { cookie } }))
    expect(res.status).toBe(404)
    assertSecured(res, false)
  })

  it('secures the unauthenticated redirect to /login', async () => {
    const handler = createHardenedHandler()
    const res = await handler.fetch(new Request('http://127.0.0.1/', { headers: { Accept: 'text/html' } }))
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('/login')
    assertSecured(res, false)
  })
})
