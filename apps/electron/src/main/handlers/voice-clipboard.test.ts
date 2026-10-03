import { expect, test } from 'bun:test'
import { WsRpcServer } from '@rox/server-core/transport/server'
import { WsRpcClient } from '@rox/server-core/transport/client'
import { RPC_CHANNELS } from '@rox/shared/protocol'
import { registerVoiceClipboardGuiHandlers } from './voice-clipboard'
import type { HandlerDeps } from './handler-deps'

test('actual local-only clipboard RPC requires a current managed owner; remote and forged modes cannot write', async () => {
  let destroyed = false, workspace = 'workspace-a'
  const writes: string[] = [], clients: WsRpcClient[] = []
  const server = new WsRpcServer({ port: 0, requireAuth: true, validateToken: async token => token === 'synthetic-token',
    resolveLocalClientBinding: candidate => candidate.localClientProof === 'server-issued-fixture-proof' ? { workspaceId: workspace, webContentsId: 42 } : null })
  registerVoiceClipboardGuiHandlers(server, { windowManager: {
    getWindowByWebContentsId: (id: number) => id === 42 ? { isDestroyed: () => destroyed, webContents: { id: 42, isDestroyed: () => destroyed } } : null,
    getWorkspaceForWindow: () => workspace,
  } } as unknown as HandlerDeps, text => writes.push(text))
  await server.listen()
  const connect = (proof?: string) => {
    const client = new WsRpcClient(`ws://127.0.0.1:${server.port}`, { token: 'synthetic-token', workspaceId: 'workspace-a', mode: 'local', webContentsId: 42,
      localClientProof: proof, autoReconnect: false, requestTimeout: 1000, connectTimeout: 1000 })
    clients.push(client); client.connect(); return client
  }
  try {
    const remote = connect(), forged = connect('forged'), local = connect('server-issued-fixture-proof')
    await expect(remote.invoke(RPC_CHANNELS.voice.COPY_TEXT, { text: 'remote cannot mutate OS clipboard' })).rejects.toThrow()
    await expect(forged.invoke(RPC_CHANNELS.voice.COPY_TEXT, { text: 'forged cannot mutate OS clipboard' })).rejects.toThrow()
    expect(writes).toEqual([])
    expect(await local.invoke(RPC_CHANNELS.voice.COPY_TEXT, { text: 'Synthetic explicit transcript' })).toEqual({ ok: true })
    expect(writes).toEqual(['Synthetic explicit transcript'])
    await expect(local.invoke(RPC_CHANNELS.voice.COPY_TEXT, { text: 'x'.repeat(1_000_001) })).rejects.toThrow()
    destroyed = true
    await expect(local.invoke(RPC_CHANNELS.voice.COPY_TEXT, { text: 'destroyed owner cannot write' })).rejects.toThrow()
    destroyed = false; workspace = 'workspace-b'
    await expect(local.invoke(RPC_CHANNELS.voice.COPY_TEXT, { text: 'workspace moved cannot write' })).rejects.toThrow()
    expect(writes).toEqual(['Synthetic explicit transcript'])
  } finally { for (const client of clients) client.destroy(); server.close() }
}, 10_000)
