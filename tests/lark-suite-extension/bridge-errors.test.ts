import { afterEach, describe, expect, test } from 'bun:test'
import { WsRpcServer } from '../../packages/server-core/src/transport/server'
import { WsRpcClient } from '../../packages/server-core/src/transport/client'
import { CodedError, RPC_CHANNELS } from '../../packages/shared/src/protocol'
import { buildClientApi } from '../../apps/electron/src/transport/build-api'

const AUTH_TOKEN = 'bridge-error-authenticated-test-token'
const LOCAL_CLIENT_PROOF = 'bridge-error-server-owned-proof'
const WORKSPACE_ID = 'bridge-workspace'
const WEB_CONTENTS_ID = 73
const CONNECTION_TIMEOUT_MS = 2_000
const cleanups: Array<() => Promise<void> | void> = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

async function connection(configure: (server: WsRpcServer) => void) {
  const server = new WsRpcServer({
    requireAuth: true,
    validateToken: async token => token === AUTH_TOKEN,
    resolveLocalClientBinding: candidate => candidate.localClientProof === LOCAL_CLIENT_PROOF
      ? { workspaceId: WORKSPACE_ID, webContentsId: WEB_CONTENTS_ID } : null,
  })
  configure(server)
  await server.listen()
  cleanups.push(() => server.close())
  const client = new WsRpcClient(`ws://127.0.0.1:${server.port}`, {
    token: AUTH_TOKEN, autoReconnect: false, localClientProof: LOCAL_CLIENT_PROOF,
    workspaceId: WORKSPACE_ID, webContentsId: WEB_CONTENTS_ID,
  })
  cleanups.push(() => client.destroy())
  const connected = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Authenticated bridge connection timed out')), CONNECTION_TIMEOUT_MS)
    const unsubscribe = client.onConnectionStateChanged(state => {
      if (state.status === 'connected') { clearTimeout(timer); unsubscribe(); resolve() }
      else if (state.status === 'failed') { clearTimeout(timer); unsubscribe(); reject(new Error('Authenticated bridge connection failed')) }
    })
  })
  client.connect()
  await connected
  return client
}

describe('coded RPC failure through the Electron API boundary', () => {
  test('returns the exact server code as plain rejection data rather than custom Error properties', async () => {
    const client = await connection(server => {
      server.handle(RPC_CHANNELS.window.GET_WORKSPACE, () => { throw new CodedError('HASH_CONFLICT', 'note revision conflict') })
    })
    const api = buildClientApi(client, { getWindowWorkspace: { type: 'invoke', channel: RPC_CHANNELS.window.GET_WORKSPACE } })
    const outcomes = await Promise.allSettled([api.getWindowWorkspace()])
    expect(outcomes.length).toBe(1)
    const outcome = outcomes[0]
    if (!outcome || outcome.status !== 'rejected') throw new Error('Expected a rejected conflict')
    expect(outcome.reason).toEqual({ code: 'HASH_CONFLICT', message: 'note revision conflict' })
    expect(outcome.reason instanceof Error).toBe(false)
    expect(structuredClone(outcome.reason)).toEqual(outcome.reason)
  })

  test('preserves success transforms and handles missing-channel failures with the same boundary', async () => {
    const client = await connection(server => {
      server.handle(RPC_CHANNELS.window.GET_WORKSPACE, () => 'workspace-a')
    })
    const api = buildClientApi(client, {
      getWindowWorkspace: { type: 'invoke', channel: RPC_CHANNELS.window.GET_WORKSPACE, transform: result => `${result}:transformed` },
      getWindowMode: { type: 'invoke', channel: 'bridge:missing-channel' },
    })
    expect(await api.getWindowWorkspace()).toBe('workspace-a:transformed')
    const outcomes = await Promise.allSettled([api.getWindowMode()])
    const outcome = outcomes[0]
    if (!outcome || outcome.status !== 'rejected') throw new Error('Expected a rejected missing channel')
    expect(outcome.reason.code).toBe('CHANNEL_NOT_FOUND')
    expect(typeof outcome.reason.message).toBe('string')
    expect(outcome.reason instanceof Error).toBe(false)
  })
})
