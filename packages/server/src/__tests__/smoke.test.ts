/**
 * Real standalone server lifecycle gate. CI sets ROX_SERVER_SMOKE_ENTRY and
 * ROX_SERVER_SMOKE_WEBUI_DIR to the built server and WebUI. Local source tests
 * use minimal HTML fixtures. Every child owns a fresh config root and token.
 */
import { afterEach, describe, expect, it } from 'bun:test'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { Subprocess } from 'bun'
import WebSocket from 'ws'
import { PROTOCOL_VERSION } from '@craft-agent/shared/protocol'

const REPO_ROOT = process.env.ROX_SERVER_SMOKE_REPO_ROOT
  ? resolve(process.env.ROX_SERVER_SMOKE_REPO_ROOT)
  : resolve(import.meta.dir, '../../../..')
const SERVER_ENTRY = process.env.ROX_SERVER_SMOKE_ENTRY
  ? resolve(REPO_ROOT, process.env.ROX_SERVER_SMOKE_ENTRY)
  : join(import.meta.dir, '..', 'index.ts')
const STARTUP_TIMEOUT = 45_000
const TEST_TIMEOUT = 90_000
const PROFILES: string[] = []
const SERVERS: SpawnedServer[] = []

interface SpawnedServer {
  url: string
  httpUrl: string
  proc: Subprocess
  logs: () => string
  tokenWasLogged: () => boolean
  stop: (mode?: 'graceful' | 'cleanup') => Promise<void>
}

async function within<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms) }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

function createServerStop(proc: Subprocess, drains: Promise<unknown>, logs: () => string): SpawnedServer['stop'] {
  let stoppedGracefully = false
  return async (mode = 'graceful') => {
    if (proc.exitCode !== null) {
      await drains
      if (mode === 'cleanup') return
      if (stoppedGracefully) {
        expect(proc.exitCode).toBe(0)
        return
      }
      throw new Error(`Server exited before requested SIGTERM (${proc.exitCode})\n${logs()}`)
    }
    proc.kill('SIGTERM')
    try {
      const code = await within(proc.exited, 10_000, 'Server did not stop on SIGTERM')
      await drains
      if (code !== 0) throw new Error(`Server exited ${code} after SIGTERM\n${logs()}`)
      expect(code).toBe(0)
      stoppedGracefully = true
    } catch (error) {
      if (proc.exitCode === null) proc.kill('SIGKILL')
      await proc.exited
      await drains
      throw error
    }
  }
}

function createProfile(): { root: string; webuiDir: string } {
  const root = mkdtempSync(join(tmpdir(), 'rox-server-lifecycle-'))
  PROFILES.push(root)
  copyFileSync(join(REPO_ROOT, 'apps/electron/resources/config-defaults.json'), join(root, 'config-defaults.json'))
  const webuiDir = process.env.ROX_SERVER_SMOKE_WEBUI_DIR
    ? resolve(REPO_ROOT, process.env.ROX_SERVER_SMOKE_WEBUI_DIR)
    : join(root, 'webui')
  if (!process.env.ROX_SERVER_SMOKE_WEBUI_DIR) {
    mkdirSync(webuiDir)
    writeFileSync(join(webuiDir, 'index.html'), '<!doctype html><html><body>app</body></html>')
    writeFileSync(join(webuiDir, 'login.html'), '<!doctype html><html><body>login</body></html>')
  }
  for (const path of [SERVER_ENTRY, join(webuiDir, 'index.html'), join(webuiDir, 'login.html')]) {
    if (!existsSync(path)) throw new Error(`Missing smoke artifact: ${path}`)
  }
  return { root, webuiDir }
}

async function spawnTestServer(profile: ReturnType<typeof createProfile>, token: string): Promise<SpawnedServer> {
  // The WebUI config uses the configured RPC port. Reserve a loopback port
  // before launching, then assert that the child actually binds that port.
  const reservation = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response() })
  const port = reservation.port
  reservation.stop(true)
  const proc = Bun.spawn([process.execPath, SERVER_ENTRY], {
    cwd: REPO_ROOT,
    env: {
      PATH: process.env.PATH,
      TMPDIR: process.env.TMPDIR,
      LANG: process.env.LANG,
      ROX_CONFIG_DIR: profile.root,
      CRAFT_CONFIG_DIR: profile.root,
      ROX_SERVER_TOKEN: token,
      CRAFT_SERVER_TOKEN: token,
      CRAFT_RPC_PORT: String(port),
      CRAFT_RPC_HOST: '127.0.0.1',
      CRAFT_HEALTH_PORT: '0',
      CRAFT_WEBUI_DIR: profile.webuiDir,
      CRAFT_BROWSER_BACKEND: 'none',
      CRAFT_BUNDLED_ASSETS_ROOT: join(REPO_ROOT, 'apps/electron'),
    },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  let output = ''
  let resolveReady: (url: string) => void = () => {}
  const ready = new Promise<string>(resolve => { resolveReady = resolve })
  async function drain(stream: ReadableStream<Uint8Array>): Promise<void> {
    const reader = stream.getReader()
    const decoder = new TextDecoder()
    while (true) {
      const { done, value } = await reader.read()
      if (done) return
      output = (output + decoder.decode(value, { stream: true })).slice(-32_768)
      const match = output.match(/CRAFT_SERVER_URL=(ws:\/\/127\.0\.0\.1:\d+)/)
      if (match?.[1]) resolveReady(match[1])
    }
  }
  const drains = Promise.all([drain(proc.stdout), drain(proc.stderr)])
  const server: SpawnedServer = {
    url: `ws://127.0.0.1:${port}`,
    httpUrl: `http://127.0.0.1:${port}`,
    proc,
    logs: () => output.replaceAll(token, '[test token redacted]'),
    tokenWasLogged: () => output.includes(token),
    stop: createServerStop(proc, drains, () => output.replaceAll(token, '[test token redacted]')),
  }
  SERVERS.push(server)
  if (token.length < 16) {
    // Invalid configuration must exit by itself, never satisfy readiness.
    expect(await within(proc.exited, STARTUP_TIMEOUT, 'Short-token server did not exit')).not.toBe(0)
    await drains
    return server
  }
  try {
    const url = await within(Promise.race([
      ready,
      proc.exited.then(code => { throw new Error(`Server exited before readiness (${code})`) }),
    ]), STARTUP_TIMEOUT, 'Server startup timed out')
    expect(url).toBe(server.url)
    return server
  } catch (error) {
    await server.stop('cleanup')
    throw new Error(`${error instanceof Error ? error.message : error}\n${server.logs()}`)
  }
}

function connectWs(url: string, token: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url)
    const timer = setTimeout(() => { ws.terminate(); reject(new Error('WebSocket handshake timed out')) }, 5_000)
    ws.on('open', () => ws.send(JSON.stringify({
      id: crypto.randomUUID(), type: 'handshake', protocolVersion: PROTOCOL_VERSION, token,
    })))
    ws.on('message', data => {
      const message = JSON.parse(data.toString())
      if (message.type === 'handshake_ack') { clearTimeout(timer); resolve(ws) }
      else if (message.type === 'error') { clearTimeout(timer); ws.close(); reject(new Error('Handshake rejected')) }
    })
    ws.on('error', error => { clearTimeout(timer); reject(error) })
    ws.on('close', code => { clearTimeout(timer); reject(new Error(`WebSocket closed: ${code}`)) })
  })
}

function request(server: SpawnedServer, path: string, options: RequestInit = {}): Promise<Response> {
  return fetch(server.httpUrl + path, { ...options, redirect: 'manual', signal: AbortSignal.timeout(5_000) })
}

afterEach(async () => {
  try {
    const results = await Promise.allSettled(SERVERS.splice(0).map(server => server.stop('cleanup')))
    const failures = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected')
    if (failures.length) throw new AggregateError(failures.map(result => result.reason), 'Server cleanup failed')
  } finally {
    for (const root of PROFILES.splice(0)) rmSync(root, { recursive: true, force: true })
  }
})

describe('headless server lifecycle smoke', () => {
  it('serves health/login, enforces HTTP and WebSocket auth, and restarts the same isolated profile', async () => {
    const profile = createProfile()
    const token = crypto.randomUUID() + crypto.randomUUID()
    const server = await spawnTestServer(profile, token)
    const health = await request(server, '/health')
    expect(health.status).toBe(200)
    expect(await health.json()).toMatchObject({ status: 'ok' })
    const login = await request(server, '/login')
    expect(login.status).toBe(200)
    expect(login.headers.get('content-type')).toContain('text/html')
    expect(await login.text()).toBe(readFileSync(join(profile.webuiDir, 'login.html'), 'utf8'))
    expect((await request(server, '/api/config')).status).toBe(401)
    const redirect = await request(server, '/')
    expect(redirect.status).toBe(302)
    expect(redirect.headers.get('location')).toBe('/login')
    const authenticate = (password: string) => request(server, '/api/auth', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }),
    })
    expect((await authenticate('incorrect-test-password')).status).toBe(401)
    const auth = await authenticate(token)
    expect(auth.status).toBe(200)
    const setCookie = auth.headers.get('set-cookie')
    expect(setCookie).toContain('craft_session=')
    expect(setCookie).toContain('HttpOnly')
    const cookie = setCookie!.split(';')[0]!
    const config = await request(server, '/api/config', { headers: { cookie } })
    expect(config.status).toBe(200)
    expect(await config.json()).toEqual({ wsUrl: server.url })
    const html = await request(server, '/', { headers: { cookie } })
    expect(html.status).toBe(200)
    expect(await html.text()).toBe(readFileSync(join(profile.webuiDir, 'index.html'), 'utf8'))
    const ws = await connectWs(server.url, token)
    expect(ws.readyState).toBe(WebSocket.OPEN)
    await expect(connectWs(server.url, 'wrong-token-that-is-long-enough')).rejects.toThrow()
    // Keep an authenticated socket open to exercise shutdown with a live client.
    await server.stop()
    expect(ws.readyState).toBe(WebSocket.CLOSED)
    await expect(request(server, '/health')).rejects.toThrow()
    expect(existsSync(join(profile.root, 'config.json'))).toBe(true)
    const savedConfig = readFileSync(join(profile.root, 'config.json'), 'utf8')
    const restarted = await spawnTestServer(profile, token)
    expect((await request(restarted, '/health')).status).toBe(200)
    expect((await request(restarted, '/api/config', { headers: { cookie } })).status).toBe(200)
    // Startup may add migration receipts; it must retain the existing config.
    expect(JSON.parse(readFileSync(join(profile.root, 'config.json'), 'utf8'))).toMatchObject(JSON.parse(savedConfig))
    expect(server.tokenWasLogged()).toBe(false)
    expect(restarted.tokenWasLogged()).toBe(false)
    await restarted.stop()
  }, TEST_TIMEOUT)

  it('rejects short token at startup', async () => {
    await spawnTestServer(createProfile(), 'short')
  }, TEST_TIMEOUT)

  for (const exitCode of [0, 17]) {
    it(`rejects a child already exited with ${exitCode} as graceful shutdown`, async () => {
      const profile = createProfile()
      const proc = Bun.spawn([process.execPath, '-e', `process.exit(${exitCode})`], {
        env: { ROX_CONFIG_DIR: profile.root, CRAFT_CONFIG_DIR: profile.root },
        stdout: 'pipe', stderr: 'pipe',
      })
      const drains = Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()])
      const stop = createServerStop(proc, drains, () => 'already-exited child fixture')
      expect(await within(proc.exited, 10_000, 'Exit fixture timed out')).toBe(exitCode)
      await expect(stop()).rejects.toThrow(`before requested SIGTERM (${exitCode})`)
      await expect(stop('cleanup')).resolves.toBeUndefined()
    }, TEST_TIMEOUT)
  }
})
