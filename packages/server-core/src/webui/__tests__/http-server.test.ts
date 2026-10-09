import { afterEach, describe, expect, it } from 'bun:test'
import { generateKeyPairSync, sign } from 'node:crypto'
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
  stop: () => void
}

function createFakeIssuer(): FakeIssuer {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'test-key', use: 'sig', alg: 'RS256' }
  let nonceToSign = ''

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
        return Response.json({ keys: [jwk] })
      }
      if (url.pathname === '/token') {
        const now = Math.floor(Date.now() / 1000)
        const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: 'test-key' })).toString('base64url')
        const payload = Buffer.from(JSON.stringify({
          iss: base,
          aud: CLIENT_ID,
          sub: 'rox-user-1',
          email: 'user@rox.one',
          name: 'Rox User',
          preferred_username: 'roxuser',
          nonce: nonceToSign,
          iat: now,
          exp: now + 300,
        })).toString('base64url')
        const signature = sign('RSA-SHA256', Buffer.from(`${header}.${payload}`), privateKey).toString('base64url')
        return Response.json({ id_token: `${header}.${payload}.${signature}` })
      }
      return new Response('not found', { status: 404 })
    },
  })

  return {
    issuer: `http://127.0.0.1:${server.port}`,
    setNonce: (nonce: string) => { nonceToSign = nonce },
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

  function createHandler(oidc?: OidcConfig) {
    const handler = createWebuiHandler({
      webuiDir: createTestWebuiDir(),
      secret: SECRET,
      password: PASSWORD,
      wsProtocol: 'ws',
      wsPort: 9100,
      getHealthCheck: () => ({ status: 'ok' }),
      logger,
      ...(oidc ? { oidc } : {}),
    })
    HANDLERS.push(handler)
    return handler
  }

  function oidcHandler() {
    const issuer = createFakeIssuer()
    ISSUERS.push(issuer)
    const handler = createHandler({
      issuer: issuer.issuer,
      clientId: CLIENT_ID,
      publicUrl: 'http://127.0.0.1:3100',
    })
    return { handler, issuer }
  }

  async function startLogin(handler: { fetch: (req: Request) => Promise<Response> }) {
    const res = await handler.fetch(new Request('http://127.0.0.1/api/auth/login'))
    expect(res.status).toBe(302)
    const location = new URL(res.headers.get('location')!)
    return {
      url: location,
      state: location.searchParams.get('state')!,
      nonce: location.searchParams.get('nonce')!,
    }
  }

  it('redirects to the IdP with PKCE, state and nonce', async () => {
    const { handler, issuer } = oidcHandler()
    const { url, state, nonce } = await startLogin(handler)

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
  })

  it('sets a session cookie on a valid callback and authorizes protected endpoints', async () => {
    const { handler, issuer } = oidcHandler()
    const { state, nonce } = await startLogin(handler)
    issuer.setNonce(nonce)

    const callback = await handler.fetch(
      new Request(`http://127.0.0.1/api/auth/callback?code=auth-code&state=${state}`),
    )
    expect(callback.status).toBe(302)
    expect(callback.headers.get('location')).toBe('/')
    const cookie = callback.headers.get('set-cookie')
    expect(cookie).toContain('craft_session=')

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
    await startLogin(handler)
    issuer.setNonce('irrelevant')

    const callback = await handler.fetch(
      new Request('http://127.0.0.1/api/auth/callback?code=auth-code&state=tampered-state'),
    )
    expect(callback.status).toBe(400)
    expect(callback.headers.get('set-cookie')).toBeNull()
    const body = await callback.text()
    expect(body).toContain('Не удалось войти')
  })

  it('rejects an id_token with the wrong nonce', async () => {
    const { handler, issuer } = oidcHandler()
    const { state } = await startLogin(handler)
    issuer.setNonce('wrong-nonce')

    const callback = await handler.fetch(
      new Request(`http://127.0.0.1/api/auth/callback?code=auth-code&state=${state}`),
    )
    expect(callback.status).toBe(400)
    expect(callback.headers.get('set-cookie')).toBeNull()
    expect(await callback.text()).toContain('Не удалось войти')
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
