import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WsRpcServer } from '@rox/server-core/transport/server'
import { WsRpcClient } from '@rox/server-core/transport/client'
import type { RpcServer } from '@rox/server-core/transport'
import { RPC_CHANNELS } from '@rox/shared/protocol'
import { HANDLED_CHANNELS, registerClipboardHistoryGuiHandlers, setClipboardHistoryTestSeams } from '../../handlers/clipboard-history'
import { ClipboardHistoryStore } from '../../clipboard-history/store'
import { type ClipboardAdapter } from '../../clipboard-history/monitor'
import type { HandlerDeps } from '../../handlers/handler-deps'

function recordingServer(): { server: RpcServer; channels: string[] } {
  const channels: string[] = []
  const server = {
    handle(channel: string) { channels.push(channel) },
    push() {},
    async invokeClient() {},
    hasClientCapability() { return false },
    findClientsWithCapability() { return [] },
  } as unknown as RpcServer
  return { server, channels }
}

test('HANDLED_CHANNELS is exactly the registered invoke set (push channel excluded)', () => {
  const { server, channels } = recordingServer()
  registerClipboardHistoryGuiHandlers(server, {} as HandlerDeps)
  expect(channels).toEqual([...HANDLED_CHANNELS])
  expect(channels).not.toContain(RPC_CHANNELS.clipboard.CHANGED)
  expect(new Set(HANDLED_CHANNELS).size).toBe(HANDLED_CHANNELS.length)
})

test('clipboard:copy writes only for a current local owner; remote, forged and ownerless calls are rejected', async () => {
  const clients: WsRpcClient[] = []
  const server = new WsRpcServer({
    port: 0,
    requireAuth: true,
    validateToken: async token => token === 'synthetic-token',
    resolveLocalClientBinding: candidate => candidate.localClientProof === 'server-issued-proof'
      ? { workspaceId: 'workspace-a', webContentsId: 42 }
      : null,
  })
  registerClipboardHistoryGuiHandlers(server, {
    windowManager: {
      getWindowByWebContentsId: () => null,
      getWorkspaceForWindow: () => 'workspace-a',
    },
  } as unknown as HandlerDeps)
  await server.listen()
  const connect = (proof?: string) => {
    const client = new WsRpcClient(`ws://127.0.0.1:${server.port}`, {
      token: 'synthetic-token',
      workspaceId: 'workspace-a',
      mode: 'local',
      webContentsId: 42,
      localClientProof: proof,
      autoReconnect: false,
      requestTimeout: 1000,
      connectTimeout: 1000,
    })
    clients.push(client)
    client.connect()
    return client
  }
  try {
    const remote = connect()
    const forged = connect('forged')
    const local = connect('server-issued-proof')
    await expect(remote.invoke(RPC_CHANNELS.clipboard.COPY, 1)).rejects.toThrow()
    await expect(forged.invoke(RPC_CHANNELS.clipboard.COPY, 1)).rejects.toThrow()
    await expect(local.invoke(RPC_CHANNELS.clipboard.COPY, 1)).rejects.toThrow()
  } finally {
    for (const client of clients) client.destroy()
    server.close()
  }
}, 10_000)

/** Records everything the copy path writes so tests can assert the exact payload. */
class RecordingAdapter implements ClipboardAdapter {
  texts: string[] = []
  bytesWritten: { mimeType: string; bytes: Buffer }[] = []
  textWrite: (() => void | Promise<void>) | null = null
  readText = async (): Promise<string> => ''
  readTypes = async (): Promise<string[]> => []
  hasRawFormat = async (): Promise<boolean> => false
  readTypeBytes = async (): Promise<Buffer | null> => null
  async writeText(text: string): Promise<void> { this.texts.push(text); await this.textWrite?.() }
  async writeTypeBytes(mimeType: string, bytes: Buffer): Promise<void> { this.bytesWritten.push({ mimeType, bytes }) }
  decodeImage = async (): Promise<null> => null
}

/** Minimal `globalShortcut` double: records the register/unregister chatter. */
class RecordingGlobalShortcut {
  registerCalls: string[] = []
  unregisterCalls: string[] = []
  callbacks = new Map<string, () => void>()
  register(accelerator: string, callback: () => void): boolean {
    this.registerCalls.push(accelerator)
    this.callbacks.set(accelerator, callback)
    return true
  }
  unregister(accelerator: string): void {
    this.unregisterCalls.push(accelerator)
    this.callbacks.delete(accelerator)
  }
  isRegistered(accelerator: string): boolean { return this.callbacks.has(accelerator) }
}

interface Harness {
  server: WsRpcServer
  client: WsRpcClient
  adapter: RecordingAdapter
  store: ClipboardHistoryStore
  shortcut: RecordingGlobalShortcut
  dir: string
  close: () => void
}

/** A running local RPC server whose clipboard store/adapter are injected test doubles. */
async function startHarness(): Promise<Harness> {
  const dir = mkdtempSync(join(tmpdir(), 'clip-handlers-'))
  const store = new ClipboardHistoryStore({ dir })
  const adapter = new RecordingAdapter()
  const shortcut = new RecordingGlobalShortcut()
  setClipboardHistoryTestSeams({ store, adapter, globalShortcut: shortcut })
  const server = new WsRpcServer({
    port: 0,
    requireAuth: true,
    validateToken: async token => token === 'synthetic-token',
    resolveLocalClientBinding: candidate => candidate.localClientProof === 'server-issued-proof'
      ? { workspaceId: 'workspace-a', webContentsId: 42 }
      : null,
  })
  registerClipboardHistoryGuiHandlers(server, {
    windowManager: {
      getWindowByWebContentsId: () => ({ isDestroyed: () => false, webContents: { isDestroyed: () => false, id: 42 } }),
      getWorkspaceForWindow: () => 'workspace-a',
    },
  } as unknown as HandlerDeps)
  await server.listen()
  const client = new WsRpcClient(`ws://127.0.0.1:${server.port}`, {
    token: 'synthetic-token',
    workspaceId: 'workspace-a',
    mode: 'local',
    webContentsId: 42,
    localClientProof: 'server-issued-proof',
    autoReconnect: false,
    requestTimeout: 1000,
    connectTimeout: 1000,
  })
  client.connect()
  return {
    server,
    client,
    adapter,
    store,
    shortcut,
    dir,
    close: () => {
      client.destroy()
      server.close()
      store.close()
      rmSync(dir, { recursive: true, force: true })
      setClipboardHistoryTestSeams({ store: null, adapter: null, globalShortcut: null })
    },
  }
}

test('clipboard:copy writes stored GIF bytes back byte-exact under image/gif', async () => {
  const harness = await startHarness()
  try {
    const gif = Buffer.from('gif-content-bytes')
    const { id } = harness.store.insertOrResurface({ kind: 'image', imageBytes: gif, imageFormat: 'gif' })
    const result = await harness.client.invoke(RPC_CHANNELS.clipboard.COPY, id)
    expect(result).toEqual({ ok: true })
    expect(harness.adapter.bytesWritten).toEqual([{ mimeType: 'image/gif', bytes: gif }])
  } finally {
    harness.close()
  }
}, 10_000)

test('clipboard:copy writes stored PNG bytes back byte-exact under image/png', async () => {
  const harness = await startHarness()
  try {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x02, 0x03])
    const { id } = harness.store.insertOrResurface({ kind: 'image', imageBytes: png, imageFormat: 'png', imageWidth: 1, imageHeight: 1 })
    const result = await harness.client.invoke(RPC_CHANNELS.clipboard.COPY, id)
    expect(result).toEqual({ ok: true })
    expect(harness.adapter.bytesWritten).toEqual([{ mimeType: 'image/png', bytes: png }])
  } finally {
    harness.close()
  }
}, 10_000)

test('clipboard:copy rejects an image entry whose stored content is unavailable', async () => {
  const harness = await startHarness()
  try {
    const image = harness.store.insertOrResurface({ kind: 'image', imageBytes: Buffer.from('png-content'), imageFormat: 'png' })
    // Simulate a missing/readable-failed file: the row survives but its bytes are gone.
    rmSync(join(harness.dir, 'images'), { recursive: true, force: true })
    await expect(harness.client.invoke(RPC_CHANNELS.clipboard.COPY, image.id)).rejects.toThrow('Clipboard entry content is unavailable')
    expect(harness.adapter.bytesWritten).toHaveLength(0)
  } finally {
    harness.close()
  }
}, 10_000)

test('clipboard:copy awaits the async clipboard write before reporting success', async () => {
  const harness = await startHarness()
  try {
    const writeStarted = Promise.withResolvers<void>()
    const releaseWrite = Promise.withResolvers<void>()
    let writeCompleted = false
    harness.adapter.textWrite = async () => { writeStarted.resolve(); await releaseWrite.promise; writeCompleted = true }
    const { id } = harness.store.insertOrResurface({ kind: 'text', text: 'await-me' })

    let settled = false
    const pending = harness.client.invoke(RPC_CHANNELS.clipboard.COPY, id).then(value => { settled = true; return value })
    // The handler calls the adapter synchronously, then awaits it: once the adapter
    // body runs, the RPC must still be blocked on the write.
    await writeStarted.promise
    expect(writeCompleted).toBe(false)
    expect(settled).toBe(false)

    releaseWrite.resolve()
    await expect(pending).resolves.toEqual({ ok: true })
    expect(writeCompleted).toBe(true)
    expect(harness.adapter.texts).toEqual(['await-me'])
  } finally {
    harness.close()
  }
}, 10_000)

test('clipboard:settingsSet registers the global shortcut and releases it when disabled', async () => {
  const harness = await startHarness()
  try {
    const saved = await harness.client.invoke(RPC_CHANNELS.clipboard.SETTINGS_SET, {
      globalShortcutEnabled: true,
      globalShortcut: 'CommandOrControl+Shift+V',
    })
    expect(saved).toMatchObject({ globalShortcutEnabled: true, globalShortcut: 'CommandOrControl+Shift+V' })
    expect(harness.shortcut.registerCalls).toEqual(['CommandOrControl+Shift+V'])
    expect(harness.shortcut.isRegistered('CommandOrControl+Shift+V')).toBe(true)

    await harness.client.invoke(RPC_CHANNELS.clipboard.SETTINGS_SET, { globalShortcutEnabled: false })
    expect(harness.shortcut.unregisterCalls).toEqual(['CommandOrControl+Shift+V'])
    expect(harness.shortcut.isRegistered('CommandOrControl+Shift+V')).toBe(false)
  } finally {
    harness.close()
  }
}, 10_000)