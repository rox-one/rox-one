/**
 * f.9 node/device RPC liveness gate.
 *
 * Drives the real WS RPC handler surface — a real `WsRpcServer` whose handlers
 * are registered by `registerCoreRpcHandlers` from the production
 * `createServerHandlerDeps` composition — over an authenticated `WsRpcClient`.
 * Before the host composed a `NodeRegistry`, every `nodes:*` channel answered
 * `CHANNEL_NOT_FOUND` here; there is no direct handler call anywhere.
 */
import { afterEach, describe, expect, it } from 'bun:test'
import { RPC_CHANNELS } from '@rox/shared/protocol'
import { WsRpcServer, WsRpcClient } from '@rox/server-core/transport'
import { registerCoreRpcHandlers } from '@rox/server-core/handlers/rpc'
import type { SessionManager } from '@rox/server-core/sessions'
import type { PlatformServices } from '@rox/server-core/runtime'
import type { OAuthFlowStore } from '@rox/shared/auth'
import { createServerHandlerDeps } from '../handler-deps'

const TEST_TOKEN = 'nodes-live-test-token-0123456789'
const TEST_TIMEOUT = 20_000

const cleanups: Array<() => void | Promise<void>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

// Test doubles: the node surface only stores these; no session/native runtime
// is exercised. Casts are boundary doubles, never runtime input validation.
const sessionManager = {
  getLearningRpcService: () => null,
} as unknown as SessionManager

const platform = {
  appRootPath: '',
  resourcesPath: '',
  isPackaged: false,
  appVersion: 'nodes-live-test',
  isDebugMode: false,
  logger: { info() {}, error() {}, warn() {}, debug() {} },
  imageProcessor: { getMetadata: async () => null, process: async () => Buffer.alloc(0) },
} as unknown as PlatformServices

const oauthFlowStore = {
  store() {},
  getByState() { return null },
  remove() {},
  cleanup() {},
  dispose() {},
  size: 0,
} as unknown as OAuthFlowStore

async function startServer(): Promise<{ url: string; server: WsRpcServer }> {
  const server = new WsRpcServer({
    host: '127.0.0.1',
    port: 0,
    requireAuth: true,
    serverId: 'nodes-live-test',
    validateToken: async (token: string) => token === TEST_TOKEN,
  })
  registerCoreRpcHandlers(server, createServerHandlerDeps({ sessionManager, platform, oauthFlowStore }))
  await server.listen()
  cleanups.push(() => server.close())
  return { url: `ws://127.0.0.1:${server.port}`, server }
}

function connect(url: string, token?: string): Promise<WsRpcClient> {
  const client = new WsRpcClient(url, {
    ...(token ? { token } : {}),
    autoReconnect: false,
    connectTimeout: 5_000,
    requestTimeout: 5_000,
  })
  const ready = new Promise<void>((resolve, reject) => {
    const off = client.onConnectionStateChanged(state => {
      if (state.status === 'connected') { off(); resolve() }
      else if (state.status === 'failed') { off(); reject(new Error('handshake failed')) }
    })
  })
  client.connect()
  return ready.then(
    () => client,
    error => { client.destroy(); throw error },
  )
}

describe('f.9 nodes:* production composition', () => {
  it('refuses an unauthenticated client at the handshake', async () => {
    const { url } = await startServer()
    await expect(connect(url)).rejects.toThrow('handshake failed')
  }, TEST_TIMEOUT)

  it('serves nodes:list / nodes:register over the authenticated WS surface', async () => {
    const { url } = await startServer()
    const client = await connect(url, TEST_TOKEN)
    cleanups.push(() => client.destroy())

    // CHANNEL_NOT_FOUND here means the host never composed a NodeRegistry.
    expect(await client.invoke(RPC_CHANNELS.nodes.LIST)).toEqual([])

    const registered = await client.invoke(RPC_CHANNELS.nodes.REGISTER, {
      nodeId: 'test-node',
      declaredCaps: ['system.run'],
      declaredCommands: ['system.run'],
    })
    expect(registered).toMatchObject({ nodeId: 'test-node', online: true, authorizedCommands: [] })

    expect(await client.invoke(RPC_CHANNELS.nodes.LIST)).toMatchObject([
      { nodeId: 'test-node', online: true, declaredCommands: ['system.run'] },
    ])
  }, TEST_TIMEOUT)
})