import { afterEach, describe, expect, test } from 'bun:test'
import { EventEmitter } from 'node:events'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import type { StoredCredential } from '@rox/shared/credentials'
import { NATIVE_REPLICA_IPC } from '../native-replica'
import { registerNativeReplicaForWindows, type NativeReplicaBootstrapDependencies } from '../native-replica-bootstrap'

const cleanups: (() => void)[] = []
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup() })
function fixture(delayKeys = false) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'thin-native-replica-')))
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
  const handlers = new Map<string, (event: IpcMainInvokeEvent, input: any) => any>()
  const keys = new Map<string, StoredCredential>()
  const keyRead = Promise.withResolvers<void>()
  let workspace = 'workspace-A'
  let generation = 1
  let deadWindow = false
  let deadSender = false
  let keyReads = 0
  const frame = { url: 'app://synthetic-thin-window' }
  const sender = Object.assign(new EventEmitter(), { id: 41, mainFrame: frame, isDestroyed: () => deadSender })
  const owner = { webContents: sender, isDestroyed: () => deadWindow }
  const ipc = { handle: (channel: string, handler: any) => handlers.set(channel, handler), removeHandler: (channel: string) => handlers.delete(channel) } as unknown as IpcMain
  const manager = { getWindowByWebContentsId: (id: number) => id === sender.id ? owner : null,
    getWorkspaceForWindow: () => workspace, getWorkspaceGenerationForWindow: () => generation } as unknown as ReturnType<NativeReplicaBootstrapDependencies['getWindowManager']>
  const dispose = registerNativeReplicaForWindows(ipc, { configDir: dir, getWindowManager: () => manager,
    credentials: {
      async get(id) { keyReads++; if (delayKeys) await keyRead.promise; return keys.get(JSON.stringify(id)) ?? null },
      async set(id, value) { keys.set(JSON.stringify(id), value) },
    } })
  cleanups.push(dispose)
  const event = { sender, senderFrame: frame } as unknown as IpcMainInvokeEvent
  const context = { workspaceId: 'workspace-A', issuer: 'synthetic-authority', subject: 'synthetic-actor', permissionFence: 'synthetic-read-fence' }
  const invoke = (channel: string, input: unknown, source = event) => Promise.resolve().then(() => handlers.get(channel)!(source, input))
  return { handlers, sender, owner, event, context, invoke, dispose,
    open: () => invoke(NATIVE_REPLICA_IPC.OPEN, { context }),
    switchWorkspace(value: string) { workspace = value; generation++ }, reload() { generation++ },
    resolveKeys: () => keyRead.resolve(), keyReads: () => keyReads,
    destroy() { deadWindow = true; deadSender = true; sender.emit('destroyed') },
  }
}

describe('common Electron Notes custody registration', () => {
  test('registers every replica IPC in a thin desktop and opens/closes live actor custody', async () => {
    const f = fixture()
    expect([...f.handlers.keys()].sort()).toEqual(Object.values(NATIVE_REPLICA_IPC).sort())
    const handle = await f.open()
    expect(typeof handle).toBe('string')
    expect(await f.invoke(NATIVE_REPLICA_IPC.PENDING, { handle })).toEqual([])
    await f.invoke(NATIVE_REPLICA_IPC.CLOSE, { handle })
    await expect(f.invoke(NATIVE_REPLICA_IPC.PENDING, { handle })).rejects.toThrow('not owned')
    f.dispose(); expect(f.handlers.size).toBe(0)
  })
  test('rejects iframe, replaced sender and foreign workspace before reading vault keys', async () => {
    const f = fixture()
    await expect(f.invoke(NATIVE_REPLICA_IPC.OPEN, { context: f.context }, { ...f.event, senderFrame: null } as unknown as IpcMainInvokeEvent)).rejects.toThrow('authenticated managed workspace')
    const replacement = Object.assign(new EventEmitter(), { id: 41, mainFrame: f.sender.mainFrame, isDestroyed: () => false })
    await expect(f.invoke(NATIVE_REPLICA_IPC.OPEN, { context: f.context }, { ...f.event, sender: replacement } as unknown as IpcMainInvokeEvent)).rejects.toThrow('authenticated managed workspace')
    await expect(f.invoke(NATIVE_REPLICA_IPC.OPEN, { context: { ...f.context, workspaceId: 'workspace-B' } })).rejects.toThrow('authenticated managed workspace')
    expect(f.keyReads()).toBe(0)
  })
  test('A→B→A during secure key storage cannot resurrect an obsolete session', async () => {
    const f = fixture(true)
    const opening = f.open()
    await new Promise(resolve => setTimeout(resolve, 0))
    f.switchWorkspace('workspace-B'); f.switchWorkspace('workspace-A'); f.resolveKeys()
    await expect(opening).rejects.toThrow('binding changed while opening')
    expect(f.sender.listenerCount('destroyed')).toBe(0)
  })
  test('a renderer reload or A→B→A closes an existing custody lease', async () => {
    const f = fixture()
    const beforeReload = await f.open(); f.reload()
    await expect(f.invoke(NATIVE_REPLICA_IPC.PENDING, { handle: beforeReload })).rejects.toThrow('session was closed')
    const beforeSwitch = await f.open(); f.switchWorkspace('workspace-B'); f.switchWorkspace('workspace-A')
    await expect(f.invoke(NATIVE_REPLICA_IPC.PENDING, { handle: beforeSwitch })).rejects.toThrow('session was closed')
    expect(f.sender.listenerCount('destroyed')).toBe(0)
  })
  test('a foreign frame cannot use an existing lease, while the native main frame keeps it', async () => {
    const f = fixture(); const handle = await f.open()
    await expect(f.invoke(NATIVE_REPLICA_IPC.PENDING, { handle }, { ...f.event, senderFrame: null } as unknown as IpcMainInvokeEvent)).rejects.toThrow('managed app-host window')
    expect(await f.invoke(NATIVE_REPLICA_IPC.PENDING, { handle })).toEqual([])
  })
  test('destroyed windows close custody and cannot open another replica', async () => {
    const f = fixture(); const handle = await f.open(); f.destroy()
    await expect(f.invoke(NATIVE_REPLICA_IPC.PENDING, { handle })).rejects.toThrow('managed app-host window')
    await expect(f.open()).rejects.toThrow('authenticated managed workspace')
    expect(f.sender.listenerCount('render-process-gone')).toBe(0)
  })
})
