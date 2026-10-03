import { strict as assert } from 'node:assert'
import { mock } from 'bun:test'
import { EventEmitter } from 'node:events'
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { BrowserWindow, IpcMain, IpcMainInvokeEvent } from 'electron'
import { NativeAuthority, type NativeIssuedCredential } from '../../../../../packages/server-core/src/authority/native-authority.ts'
import { NativeJournal } from '../../../../../packages/server-core/src/authority/native-journal.ts'
import { CollaborationSyncService } from '../../../../../packages/server-core/src/collaboration/sync-service.ts'
import { WsRpcServer } from '../../../../../packages/server-core/src/transport/server.ts'
import { WsRpcClient, type WsRpcClientOptions } from '../../../../../packages/server-core/src/transport/client.ts'
import { registerNativeDataHandlers } from '../../../../../packages/server-core/src/handlers/rpc/native-data.ts'
import { registerNotesHandlers } from '../../../../../packages/server-core/src/handlers/rpc/notes.ts'
import { projectNativeNotesChanged } from '../../../../../packages/server-core/src/handlers/rpc/native-notes-events.ts'
import type { HandlerDeps } from '../../../../../packages/server-core/src/handlers/handler-deps.ts'
import { NATIVE_REPLICA_IPC, type NativeReplicaQueuedMutation } from '@craft-agent/shared/protocol/native-replica'
import { RPC_CHANNELS, type NoteChangedPayload } from '@craft-agent/shared/protocol'
import type { CredentialId, StoredCredential } from '@craft-agent/shared/credentials'
import type { ElectronAPI } from '../../shared/types'

// A real authenticated authority, journal, Notes handlers and remote WS
// client exercise the complete thin production preload. Only Electron IPC,
// managed BrowserWindow and OS credential custody are in-memory adapters.
const directory = process.env.CRAFT_CONFIG_DIR!
const stateDir = join(directory, 'remote-authority')
const root = join(directory, 'remote-workspace')
mkdirSync(root)
const authority = new NativeAuthority({ stateDir })
const tty = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY')
let admin: NativeIssuedCredential
try {
  Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: true })
  admin = authority.bootstrapLocalAdministrator('synthetic thin Notes operator')
} finally {
  if (tty) Object.defineProperty(process.stdin, 'isTTY', tty)
  else Reflect.deleteProperty(process.stdin, 'isTTY')
}
const workspaceId = 'thin-workspace-a'
authority.registerWorkspace(admin.credential, workspaceId, root)
const enroll = (label: string) => authority.redeemEnrollment(
  authority.issueEnrollment(admin.credential, label, Date.now() + 60_000), label,
)!
const actor = enroll('synthetic thin Notes actor')
const reader = enroll('synthetic read-only Notes subscriber')
const foreignActor = enroll('synthetic ungranted actor')
authority.grantWorkspace(admin.credential, actor.principal.subject, workspaceId, ['read', 'write', 'delete', 'subscribe'])
authority.grantWorkspace(admin.credential, reader.principal.subject, workspaceId, ['read', 'subscribe'])
const journal = new NativeJournal({
  stateDir,
  authorize: (principal, id, action, nativeRoot) => authority.authorize(principal, id, action, nativeRoot),
  permissionFence: (principal, id, action) => authority.permissionFence(principal, id, action),
  authorizePreparedRecovery: (principal, id, action, fence, nativeRoot) => authority.authorizePreparedRecovery(principal, id, action, fence, nativeRoot),
})
const sync = new CollaborationSyncService(authority, journal)
const server = new WsRpcServer({
  host: '127.0.0.1', port: 0, requireAuth: true, nativeAuthority: authority,
  nativeEventChannels: new Set([RPC_CHANNELS.notes.CHANGED]),
  projectNativeEvent: (channel, args, id, principal) => channel === RPC_CHANNELS.notes.CHANGED
    ? projectNativeNotesChanged(authority, args, id, principal) : args,
})
const deps = { nativeData: { authority, journal, sync } } as HandlerDeps
registerNativeDataHandlers(server, deps)
registerNotesHandlers(server, deps)

const handlers = new Map<string, (event: IpcMainInvokeEvent, input: unknown) => unknown>()
const keys = new Map<string, StoredCredential>()
const ipcCalls: string[] = []
const remoteCalls: string[] = []
const clients: WsRpcClient[] = []
let queuedCreation: NativeReplicaQueuedMutation | undefined
let firstCreationSubmitted = false
let exposedApi: ElectronAPI | undefined
let disposeIpc: (() => void) | undefined
let unsubscribeNotes: (() => void) | undefined
let replicaHandle: string | undefined
let windowDestroyed = false
const sender = Object.assign(new EventEmitter(), {
  id: 41,
  mainFrame: { url: 'http://127.0.0.1:5175/' },
  isDestroyed: () => windowDestroyed,
})
const owner = { webContents: sender, isDestroyed: () => windowDestroyed } as unknown as BrowserWindow
const manager = {
  getWindowByWebContentsId: (id: number) => id === sender.id ? owner : null,
  getWorkspaceForWindow: (id: number) => id === sender.id && !windowDestroyed ? workspaceId : null,
  getWorkspaceGenerationForWindow: (id: number) => id === sender.id && !windowDestroyed ? 1 : null,
}
const event = { sender, senderFrame: sender.mainFrame } as unknown as IpcMainInvokeEvent
const ipc = {
  handle(channel: string, handler: (event: IpcMainInvokeEvent, input: unknown) => unknown) {
    assert(!handlers.has(channel), `Duplicate native IPC registration: ${channel}`)
    handlers.set(channel, handler)
  },
  removeHandler(channel: string) { handlers.delete(channel) },
} as unknown as IpcMain

class ObservedRemoteClient extends WsRpcClient {
  constructor(url: string, options: WsRpcClientOptions) {
    assert.equal(options.mode, 'remote')
    assert.equal(options.localClientProof, undefined, 'Native thin auth must not depend on embedded-server window proof')
    assert.equal(options.token, actor.credential)
    assert.equal(options.workspaceId, workspaceId)
    super(url, options)
    clients.push(this)
  }

  override async invoke(channel: string, ...args: unknown[]) {
    remoteCalls.push(channel)
    if (channel === RPC_CHANNELS.nativeData.MUTATE && !firstCreationSubmitted) {
      assert(queuedCreation, 'A canonical native creation must persist local intent before its first server mutation')
      assert(!existsSync(join(root, queuedCreation.changes[0]!.path)), 'Creation source must not exist before authenticated server commit')
      firstCreationSubmitted = true
    }
    return super.invoke(channel, ...args)
  }
}

mock.module('@sentry/electron/preload', () => ({}))
mock.module('../../transport/client', () => ({ WsRpcClient: ObservedRemoteClient }))
mock.module('electron', () => ({
  contextBridge: {
    exposeInMainWorld(name: string, value: ElectronAPI) {
      assert.equal(name, 'electronAPI', 'Thin preload exposes no host-control capability')
      exposedApi = value
    },
  },
  ipcRenderer: {
    sendSync(channel: string) {
      if (channel === '__get-web-contents-id') return sender.id
      if (channel === '__get-workspace-id') return manager.getWorkspaceForWindow(sender.id)
      assert.fail(`Unexpected synchronous thin IPC: ${channel}`)
    },
    async invoke(channel: string, input: unknown) {
      ipcCalls.push(channel)
      const handler = handlers.get(channel)
      assert(handler, `Common desktop bootstrap must register native handler ${channel} in thin mode`)
      const result = await handler(event, input)
      if (channel === NATIVE_REPLICA_IPC.ENQUEUE_CREATE) queuedCreation = result as NativeReplicaQueuedMutation
      return result
    },
    on() {}, removeListener() {}, send() {},
  },
  shell: { async openExternal() {}, async openPath() { return '' }, showItemInFolder() {} },
  webUtils: { getPathForFile() { return '' } },
}))

async function within<T>(promise: Promise<T>): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timeout = setTimeout(() => reject(new Error('Timed out waiting for authenticated Notes event')), 3000)
    })])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

try {
  const { registerNativeReplicaForWindows } = await import('../../main/native-replica-bootstrap')
  disposeIpc = registerNativeReplicaForWindows(ipc, {
    configDir: join(directory, 'desktop-custody'),
    credentials: {
      get: async (id: CredentialId) => keys.get(JSON.stringify(id)) ?? null,
      set: async (id: CredentialId, value: StoredCredential) => { keys.set(JSON.stringify(id), value) },
    },
    getWindowManager: () => manager,
  })
  assert.deepEqual([...handlers.keys()].sort(), Object.values(NATIVE_REPLICA_IPC).sort())
  await server.listen()
  process.env.CRAFT_SERVER_URL = `ws://127.0.0.1:${server.port}`
  process.env.CRAFT_SERVER_TOKEN = actor.credential
  process.env.CRAFT_WORKSPACE_ID = workspaceId
  await import('../bootstrap')
  assert(exposedApi, 'The complete production preload must expose its own Electron API')
  const api = exposedApi
  assert.equal(await api.getWindowWorkspace(), workspaceId)
  replicaHandle = await api.nativeReplica.open(workspaceId)
  assert.equal((await api.getTransportConnectionState()).mode, 'remote')
  assert.equal(keys.size, 1, 'OS key custody must be created in local main, not remote authority')
  assert.deepEqual(await api.nativeReplica.pending(replicaHandle), [])

  // A native read-only subscription must leave the empty canonical workspace
  // unchanged, including its directory mtime. It still observes the first
  // note created through the separately authorized writer's real preload.
  const readOnly = new WsRpcClient(process.env.CRAFT_SERVER_URL, {
    workspaceId, token: reader.credential, mode: 'remote', autoReconnect: false,
    requestTimeout: 1000, connectTimeout: 1000,
  })
  clients.push(readOnly)
  assert.equal(authority.authorize(reader.principal, workspaceId, 'write'), false)
  const sourceSnapshot = (path: string): unknown => {
    const metadata = lstatSync(path)
    return {
      dev: metadata.dev, ino: metadata.ino, mode: metadata.mode, mtimeMs: metadata.mtimeMs,
      ...(metadata.isDirectory()
        ? { children: readdirSync(path).sort().map(name => [name, sourceSnapshot(join(path, name))]) }
        : { bytes: readFileSync(path).toString('base64') }),
    }
  }
  assert.deepEqual(readdirSync(root), [])
  const beforeReadOnlyWatch = sourceSnapshot(root)
  await readOnly.invoke(RPC_CHANNELS.notes.WATCH, workspaceId)
  assert.deepEqual(sourceSnapshot(root), beforeReadOnlyWatch, 'WATCH may not create or modify native source files or directory metadata')
  await readOnly.invoke(RPC_CHANNELS.notes.UNWATCH, workspaceId)
  assert.deepEqual(sourceSnapshot(root), beforeReadOnlyWatch, 'UNWATCH may not create or modify native source files or directory metadata')
  const readOnlyCreation = Promise.withResolvers<NoteChangedPayload>()
  const unsubscribeReadOnly = readOnly.on(RPC_CHANNELS.notes.CHANGED, payload => {
    if (payload.workspaceId === workspaceId && payload.reason === 'external') readOnlyCreation.resolve(payload)
  })
  await readOnly.invoke(RPC_CHANNELS.notes.WATCH, workspaceId)

  const watchedEvents: NoteChangedPayload[] = []
  const creationChanged = Promise.withResolvers<NoteChangedPayload>()
  const changed = Promise.withResolvers<NoteChangedPayload>()
  unsubscribeNotes = api.onNotesChanged(payload => {
    assert.notEqual(typeof payload, 'string', 'Native Notes events carry the bounded canonical payload')
    if (typeof payload === 'string') throw new Error('Unexpected legacy Notes event')
    watchedEvents.push(payload)
    if (payload.workspaceId === workspaceId && payload.reason === 'external') creationChanged.resolve(payload)
    if (payload.workspaceId === workspaceId && payload.reason === 'save') changed.resolve(payload)
  })
  await api.watchNotes(workspaceId)

  const note = await api.createNote(workspaceId, 'Canonical thin creation', 'nested', {
    operationId: 'renderer-cannot-assign-custody', expectedRevision: null, schemaVersion: 1,
  })
  assert(queuedCreation)
  assert.notEqual(queuedCreation.operationId, 'renderer-cannot-assign-custody')
  assert.equal(note.nativeId, queuedCreation.nativeId)
  assert.equal(note.nativeRevision, 1)
  assert.equal(readFileSync(join(root, queuedCreation.changes[0]!.path), 'utf8'), note.content)
  assert.equal((await within(creationChanged.promise)).noteId, note.id,
    'The real canonical creation must trigger its native source watcher after WATCH returns')
  assert.equal((await within(readOnlyCreation.promise)).noteId, note.id,
    'An existing read-only subscriber must observe the first authorized canonical note creation')
  await readOnly.invoke(RPC_CHANNELS.notes.UNWATCH, workspaceId)
  unsubscribeReadOnly()
  writeFileSync('/tmp/rox-native-notes-readonly-watch-fixed-proof.json', JSON.stringify({
    transport: 'actual authenticated native WS, remote mode without local proof',
    grants: ['read', 'subscribe'], writeAuthorized: false, before: [], afterWatch: [], afterUnwatch: [],
    treeAndBytesUnchanged: true, directoryMtimeUnchanged: true, firstAuthorizedCreationEvent: true,
  }, null, 2))
  assert.deepEqual(await api.nativeReplica.pending(replicaHandle), [])
  assert.deepEqual((await api.listNotes(workspaceId)).map(item => item.id), [note.id])
  assert.equal((await api.readNote(workspaceId, note.id)).content, note.content)
  const snapshot = await api.nativeData.readEntity({ workspaceId, kind: 'notes', nativeId: note.nativeId! })
  assert(snapshot)
  assert.equal(snapshot.revision, 1)
  assert.deepEqual(await api.nativeReplica.readSnapshot(replicaHandle, note.nativeId!), snapshot)
  assert(ipcCalls.includes(NATIVE_REPLICA_IPC.CACHE_SNAPSHOT), 'Canonical reads must populate real local encrypted snapshots')
  assert(ipcCalls.includes(NATIVE_REPLICA_IPC.ACKNOWLEDGE), 'Creation receipt must acknowledge the exact persisted operation')

  const saved = await api.saveNote(workspaceId, note.id, '# Updated over authenticated thin transport\n', undefined, {
    operationId: 'thin-authenticated-save', expectedRevision: 1, schemaVersion: 1,
  })
  assert.equal(saved.nativeRevision, 2)
  assert.equal((await within(changed.promise)).noteId, note.id)
  assert.equal((await api.readNote(workspaceId, note.id)).content, '# Updated over authenticated thin transport\n')
  assert.equal((await api.nativeReplica.readSnapshot(replicaHandle, note.nativeId!))?.revision, 2)
  const denied = new WsRpcClient(process.env.CRAFT_SERVER_URL, {
    workspaceId, token: foreignActor.credential, mode: 'remote', autoReconnect: false,
    requestTimeout: 1000, connectTimeout: 1000,
  })
  clients.push(denied)
  await assert.rejects(denied.invoke(RPC_CHANNELS.nativeData.GET_CONTEXT, { workspaceId }))
  await assert.rejects(denied.invoke(RPC_CHANNELS.notes.WATCH, workspaceId))
  await assert.rejects(api.watchNotes('foreign-workspace'))
  // Foreign WATCH must not leave a watcher. Restore the legitimate subscription.
  await api.watchNotes(workspaceId)
  await assert.rejects(api.nativeData.readEntity({ workspaceId: 'foreign-workspace', kind: 'notes', nativeId: note.nativeId! }))

  // A formerly subscribed identity receives no event after grant revocation,
  // while the still-authorized owner's live canonical watcher does receive it.
  const revokedEvents: NoteChangedPayload[] = []
  const unsubscribeRevoked = denied.on(RPC_CHANNELS.notes.CHANGED, payload => revokedEvents.push(payload))
  authority.grantWorkspace(admin.credential, foreignActor.principal.subject, workspaceId, ['read', 'subscribe'])
  await denied.invoke(RPC_CHANNELS.notes.WATCH, workspaceId)
  authority.revokeWorkspaceGrant(admin.credential, foreignActor.principal.subject, workspaceId)
  const afterSave = watchedEvents.length
  const receipt = await api.nativeData.mutate({ workspaceId, kind: 'notes', nativeId: note.nativeId!,
    operationId: 'thin-canonical-change-after-revocation', expectedRevision: 2, schemaVersion: 1,
    changes: [{ path: snapshot.files[0]!.path, content: '# Canonical source changed after foreign revocation\n' }] })
  assert.equal(receipt.revision, 3)
  await new Promise(resolve => setTimeout(resolve, 350))
  assert(watchedEvents.slice(afterSave).some(payload => payload.reason === 'external' && payload.noteId === note.id),
    'Authorized owner must still receive the real canonical source mutation')
  assert.deepEqual(revokedEvents, [], 'Revoked native subscription must receive no canonical invalidation')
  assert.equal(projectNativeNotesChanged(authority, [{ workspaceId, reason: 'external', noteId: note.id }], workspaceId,
    authority.authenticate(foreignActor.credential)!), null)
  unsubscribeRevoked()

  assert.deepEqual(projectNativeNotesChanged(authority, [{ workspaceId, reason: 'save', noteId: note.id,
    hostPath: '/private/server/notes', actor: { token: 'synthetic-private-metadata' } }], workspaceId,
  authority.authenticate(actor.credential)!), [{ workspaceId, reason: 'save', noteId: note.id }])
  assert.equal(projectNativeNotesChanged(authority, [{ workspaceId: 'foreign-workspace', reason: 'save' }], workspaceId,
    authority.authenticate(actor.credential)!), null)
  assert.equal(projectNativeNotesChanged(authority, [{ workspaceId, noteId: '/private/server/notes' }], workspaceId,
    authority.authenticate(actor.credential)!), null)
  assert.equal(projectNativeNotesChanged(authority, [{ workspaceId, noteId: 'C:/private/server/notes' }], workspaceId,
    authority.authenticate(actor.credential)!), null)

  // Concurrent requests cannot resurrect a stale watch after UNWATCH. A
  // fresh WATCH then supersedes an older overlapping request exactly once.
  const cancellation = await Promise.allSettled([api.watchNotes(workspaceId), api.unwatchNotes(workspaceId)])
  assert.equal(cancellation[0]!.status, 'rejected')
  assert.equal(cancellation[1]!.status, 'fulfilled')
  const beforeUnwatchedMutation = watchedEvents.length
  await api.nativeData.mutate({ workspaceId, kind: 'notes', nativeId: note.nativeId!,
    operationId: 'thin-canonical-change-after-unwatch', expectedRevision: 3, schemaVersion: 1,
    changes: [{ path: snapshot.files[0]!.path, content: '# Canonical source changed with watch stopped\n' }] })
  await new Promise(resolve => setTimeout(resolve, 250))
  assert.equal(watchedEvents.length, beforeUnwatchedMutation, 'UNWATCH must suppress a pending native source watcher')
  const overlapping = await Promise.allSettled([api.watchNotes(workspaceId), api.watchNotes(workspaceId)])
  assert.equal(overlapping[0]!.status, 'rejected')
  assert.equal(overlapping[1]!.status, 'fulfilled')

  // An old OS watcher must not emit from a renamed directory after a new
  // directory takes the same canonical path inside the registered workspace.
  await new Promise(resolve => setTimeout(resolve, 200))
  const beforeReplacement = watchedEvents.length
  const oldNotesRoot = join(root, 'replaced-old-notes')
  renameSync(join(root, 'notes'), oldNotesRoot)
  mkdirSync(join(root, 'notes'))
  writeFileSync(join(oldNotesRoot, note.relativePath), '# Mutated obsolete source inode\n')
  await new Promise(resolve => setTimeout(resolve, 350))
  assert.equal(watchedEvents.length, beforeReplacement, 'A replaced canonical Notes inode must suppress old source events')
  await api.unwatchNotes(workspaceId)
  await api.watchNotes(workspaceId)
  const beforeRootReplacement = watchedEvents.length
  const oldWorkspaceRoot = join(directory, 'replaced-old-workspace')
  renameSync(root, oldWorkspaceRoot)
  mkdirSync(root)
  writeFileSync(join(oldWorkspaceRoot, 'notes', 'obsolete-source.md'), '# Old registered workspace inode\n')
  await new Promise(resolve => setTimeout(resolve, 350))
  assert.equal(authority.authorize(actor.principal, workspaceId, 'read'), false)
  assert.equal(watchedEvents.length, beforeRootReplacement, 'Replacing the registered workspace root must suppress old source events')
  await assert.rejects(api.watchNotes(workspaceId))
  unsubscribeNotes()
  unsubscribeNotes = undefined

  await api.nativeReplica.close(replicaHandle)
  replicaHandle = undefined
  assert.equal(sender.listenerCount('destroyed'), 0)
  assert.equal(sender.listenerCount('render-process-gone'), 0)
  assert(!remoteCalls.includes('window:getWorkspace'), 'Thin window ownership never reaches the remote service')
  assert(remoteCalls.includes(RPC_CHANNELS.nativeData.GET_CONTEXT))
  assert(remoteCalls.includes(RPC_CHANNELS.notes.PREPARE_CREATE))
  assert(remoteCalls.includes(RPC_CHANNELS.nativeData.MUTATE))
  windowDestroyed = true
  assert.equal(await api.getWindowWorkspace(), null)
  console.log('thin native Notes: common IPC registration, authenticated remote creation, read/watch/cache/close and denied foreign identity passed')
} finally {
  unsubscribeNotes?.()
  if (replicaHandle && exposedApi) await exposedApi.nativeReplica.close(replicaHandle).catch(() => {})
  for (const client of clients) client.destroy()
  disposeIpc?.()
  server.close()
  journal.close()
  authority.close()
}
