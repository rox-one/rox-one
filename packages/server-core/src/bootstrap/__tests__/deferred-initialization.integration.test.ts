import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WsRpcClient } from '../../transport/client'
import { closeStateStore } from '../../state/state-store.ts'
// Type-only: erased at runtime, so headless-start's module-level LOCK_FILE is
// initialized only after ROX_CONFIG_DIR is set below.
import type { ServerInstance } from '../headless-start.ts'

function randomToken(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(24)), (b) => b.toString(16).padStart(2, '0')).join('')
}

async function until(check: () => boolean): Promise<void> {
  const deadline = Date.now() + 5_000
  while (!check() && Date.now() < deadline) await Bun.sleep(2)
  expect(check()).toBe(true)
}

const configDir = realpathSync(mkdtempSync(join(tmpdir(), 'rox-deferred-init-')))
const nativeStateDir = realpathSync(mkdtempSync(join(tmpdir(), 'rox-deferred-init-native-')))
const previousConfigDir = process.env.ROX_CONFIG_DIR
const previousHome = process.env.HOME
const token = randomToken()

let releaseInitialize!: () => void
const initializeGate = new Promise<void>((resolve) => { releaseInitialize = resolve })
const counts = { initializeStarted: 0, initializeFinished: 0, modelRefreshStarted: 0, sessionsHandled: 0, homeDirHandled: 0 }
let bootstrapReturnedBeforeInitialize = false
let instance: ServerInstance<Record<string, never>> | null = null
let client: WsRpcClient | null = null

describe('bootstrapServer with deferred session manager initialization (integration)', () => {
  beforeAll(async () => {
    process.env.ROX_CONFIG_DIR = configDir
    process.env.HOME = configDir
    const { bootstrapServer } = await import('../headless-start.ts')
    instance = await bootstrapServer<Record<string, never>, Record<string, never>>({
      serverToken: token,
      rpcPort: 0,
      nativeStateDir,
      // Keeps the background toolchain install out of this test.
      platformEnvironmentReady: new Promise<void>(() => {}),
      deferSessionManagerInitialization: true,
      createSessionManager: () => ({}),
      createHandlerDeps: () => ({}),
      registerAllRpcHandlers: (server) => {
        server.handle('server:homeDir', () => { counts.homeDirHandled++; return '/home/test' })
        server.handle('sessions:get', () => { counts.sessionsHandled++; return [{ id: 'session-a' }] })
      },
      initializeSessionManager: async () => {
        counts.initializeStarted++
        await initializeGate
        counts.initializeFinished++
      },
      setSessionEventSink: () => {},
      initModelRefreshService: () => ({ startAll: () => { counts.modelRefreshStarted++ }, stopAll: () => {} }),
    })
    bootstrapReturnedBeforeInitialize = counts.initializeFinished === 0
    client = new WsRpcClient(`ws://127.0.0.1:${instance.port}`, { token, autoReconnect: false, connectTimeout: 2_000 })
    client.connect()
    await until(() => client!.getConnectionState().status === 'connected')
  }, 30_000)

  afterAll(async () => {
    client?.destroy()
    releaseInitialize()
    if (instance) await instance.stop()
    if (previousConfigDir === undefined) delete process.env.ROX_CONFIG_DIR
    else process.env.ROX_CONFIG_DIR = previousConfigDir
    if (previousHome === undefined) delete process.env.HOME
    else process.env.HOME = previousHome
    closeStateStore(configDir)
    rmSync(configDir, { recursive: true, force: true })
    rmSync(nativeStateDir, { recursive: true, force: true })
  }, 30_000)

  it('returns a listening server (port to publish) while initialize is still pending', async () => {
    expect(bootstrapReturnedBeforeInitialize).toBe(true)
    await until(() => counts.initializeStarted === 1)
    expect(counts.initializeFinished).toBe(0)
    expect(instance!.port).toBeGreaterThan(0)
    expect(counts.modelRefreshStarted).toBe(0)
  })

  it('answers an ungated RPC immediately and holds a gated one until initialize resolves', async () => {
    expect(await client!.invoke('server:homeDir')).toBe('/home/test')
    let sessionsSettled = false
    const sessions = client!.invoke('sessions:get').then((value) => { sessionsSettled = true; return value })
    expect(await client!.invoke('server:homeDir')).toBe('/home/test')
    expect(sessionsSettled).toBe(false)
    expect(counts.sessionsHandled).toBe(0)
    expect(counts.homeDirHandled).toBe(2)

    releaseInitialize()
    expect(await sessions).toEqual([{ id: 'session-a' }])
    expect(counts.sessionsHandled).toBe(1)
    await instance!.initialized
    expect(counts.initializeFinished).toBe(1)
    await until(() => counts.modelRefreshStarted === 1)
  })
})
