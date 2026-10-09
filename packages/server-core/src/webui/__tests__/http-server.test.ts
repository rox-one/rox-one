import { afterEach, describe, expect, it } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createWebuiHandler, resolveWebuiFile, startWebuiHttpServer } from '../http-server'

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
    expect(csp).toContain("connect-src 'self'")
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
