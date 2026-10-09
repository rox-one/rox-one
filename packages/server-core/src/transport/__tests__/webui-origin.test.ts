import { afterEach, describe, expect, it } from 'bun:test'
import WebSocket from 'ws'
import { isWebUiUpgradeOriginAllowed, WsRpcServer } from '../server'

const cleanups: Array<() => void> = []
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup() })

async function startServer(options: { allowedWebUiOrigins?: string[] } = {}) {
  const server = new WsRpcServer({
    host: '127.0.0.1',
    port: 0,
    requireAuth: true,
    validateSessionCookie: async () => true,
    webUiAppearanceWorkspaceId: () => 'workspace-1',
    allowedWebUiOrigins: options.allowedWebUiOrigins,
  })
  cleanups.push(() => server.close())
  await server.listen()
  return { server, url: `ws://127.0.0.1:${server.port}` }
}

/** Resolve 'open' or 'rejected' from the WebSocket handshake outcome. */
function attempt(url: string, options: WebSocket.ClientOptions): Promise<'open' | 'rejected'> {
  const socket = new WebSocket(url, options)
  cleanups.push(() => socket.terminate())
  const { promise, resolve } = Promise.withResolvers<'open' | 'rejected'>()
  let settled = false
  const settle = (outcome: 'open' | 'rejected') => {
    if (settled) return
    settled = true
    resolve(outcome)
  }
  socket.on('open', () => settle('open'))
  socket.on('error', () => settle('rejected'))
  return promise
}

describe('isWebUiUpgradeOriginAllowed', () => {
  it('admits a missing origin (non-browser clients cannot be cross-site)', () => {
    expect(isWebUiUpgradeOriginAllowed(undefined, '127.0.0.1:9100', [])).toBe(true)
    expect(isWebUiUpgradeOriginAllowed('', '127.0.0.1:9100', [])).toBe(true)
  })

  it('admits true same-origin requests, including default-port forms', () => {
    expect(isWebUiUpgradeOriginAllowed('http://127.0.0.1:9100', '127.0.0.1:9100', [])).toBe(true)
    expect(isWebUiUpgradeOriginAllowed('https://dash.example.com', 'dash.example.com', [])).toBe(true)
    expect(isWebUiUpgradeOriginAllowed('https://dash.example.com:443', 'dash.example.com', [])).toBe(true)
  })

  it('admits loopback origins when the request host is also loopback', () => {
    expect(isWebUiUpgradeOriginAllowed('http://127.0.0.1:9999', '127.0.0.1:9100', [])).toBe(true)
    expect(isWebUiUpgradeOriginAllowed('http://localhost:5173', 'localhost:9100', [])).toBe(true)
    expect(isWebUiUpgradeOriginAllowed('http://[::1]:1234', '[::1]:9100', [])).toBe(true)
    expect(isWebUiUpgradeOriginAllowed('http://127.0.0.1:9999', 'dash.example.com', [])).toBe(false)
  })

  it('admits explicitly configured origins and rejects everything else', () => {
    expect(isWebUiUpgradeOriginAllowed('https://dash.example.com', 'internal:9100', ['https://dash.example.com'])).toBe(true)
    expect(isWebUiUpgradeOriginAllowed('https://evil.example', '127.0.0.1:9100', ['https://dash.example.com'])).toBe(false)
  })

  it('rejects malformed, non-http and credentialed origins', () => {
    expect(isWebUiUpgradeOriginAllowed('null', '127.0.0.1:9100', [])).toBe(false)
    expect(isWebUiUpgradeOriginAllowed('file:///etc/passwd', '127.0.0.1:9100', [])).toBe(false)
    expect(isWebUiUpgradeOriginAllowed('https://user:pw@127.0.0.1', '127.0.0.1:9100', [])).toBe(false)
  })
})

describe('WebUI WebSocket upgrade origin gate', () => {
  // The ws client's `origin` option is not applied under Bun; set the header directly.
  it('rejects a cookie-bearing upgrade from a mismatched origin before auth', async () => {
    const { url } = await startServer()
    const outcome = await attempt(url, {
      headers: { Cookie: 'craft_session=stolen', Origin: 'https://evil.example' },
    })
    expect(outcome).toBe('rejected')
  })

  it('admits a cookie-bearing upgrade from the server origin', async () => {
    const { server, url } = await startServer()
    const outcome = await attempt(url, {
      headers: { Cookie: 'craft_session=valid', Origin: `http://127.0.0.1:${server.port}` },
    })
    expect(outcome).toBe('open')
  })

  it('leaves non-webui upgrades untouched (no session cookie)', async () => {
    const { url } = await startServer()
    const outcome = await attempt(url, { headers: { Origin: 'https://evil.example' } })
    expect(outcome).toBe('open')
  })

  it('honours a configured allow-list for split-origin deployments', async () => {
    const { url } = await startServer({ allowedWebUiOrigins: ['https://dash.example.com'] })
    expect(await attempt(url, {
      headers: { Cookie: 'craft_session=valid', Origin: 'https://dash.example.com' },
    })).toBe('open')
    expect(await attempt(url, {
      headers: { Cookie: 'craft_session=valid', Origin: 'https://evil.example' },
    })).toBe('rejected')
  })
})