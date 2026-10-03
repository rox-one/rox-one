import { afterEach, expect, test } from 'bun:test'
import { EventEmitter } from 'node:events'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { NATIVE_REPLICA_IPC, registerNativeReplicaIpc } from '../native-replica'

const cleanup: Array<() => void> = []
afterEach(() => { for (const dispose of cleanup.splice(0).reverse()) dispose() })

function openingFixture() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'native-ipc-open-')))
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }))
  const handlers = new Map<string, (event: IpcMainInvokeEvent, input: unknown) => any>()
  const keyLookup = Promise.withResolvers<null>()
  let workspace: string | null = 'workspace-a'
  let destroyed = false
  let credentialsSaved = 0
  const sender = Object.assign(new EventEmitter(), { id: 1, isDestroyed: () => destroyed })
  const ipc = { handle: (channel: string, handler: any) => handlers.set(channel, handler), removeHandler: (channel: string) => handlers.delete(channel) } as unknown as IpcMain
  const dispose = registerNativeReplicaIpc(ipc, {
    configDir: dir,
    credentials: { get: () => keyLookup.promise, set: async () => { credentialsSaved++ } },
    getWorkspaceForWindow: () => workspace,
  })
  cleanup.push(dispose)
  const context = { workspaceId: 'workspace-a', issuer: 'fixture-issuer', subject: 'fixture-subject', permissionFence: 'fixture-fence' }
  return {
    open: () => handlers.get(NATIVE_REPLICA_IPC.OPEN)!({ sender } as unknown as IpcMainInvokeEvent, { context }),
    resolve: () => keyLookup.resolve(null),
    switchWorkspace: () => { workspace = 'workspace-b' },
    destroyWindow: () => { destroyed = true; workspace = null },
    listenerCount: () => sender.listenerCount('render-process-gone'),
    credentialsSaved: () => credentialsSaved,
    dispose,
  }
}

test('secure-storage delay followed by workspace switch cannot create an obsolete custody session', async () => {
  const fixture = openingFixture()
  const opening = fixture.open()
  fixture.switchWorkspace()
  fixture.resolve()
  await expect(opening).rejects.toThrow('authenticated managed workspace')
  expect(fixture.listenerCount()).toBe(0)
  expect(fixture.credentialsSaved()).toBe(1)
})

test('IPC shutdown during a secure-storage delay cannot resurrect a custody session', async () => {
  const fixture = openingFixture()
  const opening = fixture.open()
  fixture.dispose()
  fixture.resolve()
  await expect(opening).rejects.toThrow('disposed while opening')
  expect(fixture.listenerCount()).toBe(0)
})

test('secure-storage delay followed by window destruction cannot create a leaked custody session', async () => {
  const fixture = openingFixture()
  const opening = fixture.open()
  fixture.destroyWindow()
  fixture.resolve()
  await expect(opening).rejects.toThrow('window was destroyed')
  expect(fixture.listenerCount()).toBe(0)
})
