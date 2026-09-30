import { afterEach, expect, test } from 'bun:test'
import { SqliteReplicaOutbox } from '@craft-agent/shared/account-replica'
import { EventEmitter, once } from 'node:events'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import WebSocket from 'ws'
import { NativeAuthority, type NativeIssuedCredential } from '../../../../../packages/server-core/src/authority/native-authority.ts'
import { NativeJournal } from '../../../../../packages/server-core/src/authority/native-journal.ts'
import { CollaborationSyncService } from '../../../../../packages/server-core/src/collaboration/sync-service.ts'
import { WsRpcServer } from '../../../../../packages/server-core/src/transport/server.ts'
import { PROTOCOL_VERSION, RPC_CHANNELS, type MessageEnvelope } from '@craft-agent/shared/protocol'
import { deserializeEnvelope } from '../../../../../packages/server-core/src/transport/codec.ts'
import { registerNativeDataHandlers } from '../../../../../packages/server-core/src/handlers/rpc/native-data.ts'
import { registerNotesHandlers } from '../../../../../packages/server-core/src/handlers/rpc/notes.ts'
import type { HandlerDeps } from '../../../../../packages/server-core/src/handlers/handler-deps.ts'
import { WsRpcClient } from '../../../../../packages/server-core/src/transport/client.ts'
import { buildClientApi } from '../../transport/build-api.ts'
import { CHANNEL_MAP } from '../../transport/channel-map.ts'
import { registerNativeReplicaIpc, NATIVE_REPLICA_IPC } from '../native-replica.ts'
import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import type { NativeDataContext, NativeDataReceipt } from '@craft-agent/shared/protocol/dto'
import type { NativeReplicaQueuedMutation } from '@craft-agent/shared/protocol/native-replica'
import { createNativeReplicaBridge } from '../../preload/native-replica.ts'
import { createNativeNotesSyncController } from '../../renderer/lib/native-notes-sync.ts'

const cleanups: Array<() => void> = []
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup() })
interface TestConnection {
  socket: WebSocket
  messages: MessageEnvelope[]
}

async function fixture(withNotes = false) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'native-data-rpc-')))
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
  const stateDir = join(dir, 'state')
  const authority = new NativeAuthority({ stateDir })
  cleanups.push(() => authority.close())
  const tty = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY')
  let admin: NativeIssuedCredential
  try {
    Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: true })
    admin = authority.bootstrapLocalAdministrator('test operator')
  } finally {
    if (tty) Object.defineProperty(process.stdin, 'isTTY', tty)
    else Reflect.deleteProperty(process.stdin, 'isTTY')
  }
  const root = join(dir, 'workspace')
  mkdirSync(root)
  const workspace = authority.registerWorkspace(admin.credential, 'workspace-a', root)
  const issued = authority.redeemEnrollment(authority.issueEnrollment(admin.credential, 'test device', Date.now() + 60_000), 'test device')
  if (!issued) throw new Error('expected enrolled principal')
  authority.grantWorkspace(admin.credential, issued.principal.subject, workspace.id, ['read', 'write', 'delete'])
  const journal = new NativeJournal({
    stateDir,
    authorize: (principal, workspaceId, action, nativeRoot) => authority.authorize(principal, workspaceId, action, nativeRoot),
    permissionFence: (principal, workspaceId, action) => authority.permissionFence(principal, workspaceId, action),
    authorizePreparedRecovery: (principal, workspaceId, action, fence, nativeRoot) => authority.authorizePreparedRecovery(principal, workspaceId, action, fence, nativeRoot),
  })
  cleanups.push(() => journal.close())
  const sync = new CollaborationSyncService(authority, journal)
  const server = new WsRpcServer({
    host: '127.0.0.1', port: 0, requireAuth: true, nativeAuthority: authority,
    validateToken: async () => true,
  })
  const deps = { nativeData: { authority, journal, sync } } as HandlerDeps
  registerNativeDataHandlers(server, deps)
  if (withNotes) registerNotesHandlers(server, deps)
  cleanups.push(() => server.close())
  await server.listen()
  return { authority, admin, issued, server, root, dir, url: `ws://127.0.0.1:${server.port}`, workspaceId: workspace.id }
}

async function connect(url: string, credential: string): Promise<TestConnection> {
  const socket = new WebSocket(url)
  cleanups.push(() => socket.terminate())
  const messages: MessageEnvelope[] = []
  socket.on('message', data => messages.push(deserializeEnvelope(data.toString())))
  await once(socket, 'open')
  socket.send(JSON.stringify({ id: 'handshake', type: 'handshake', protocolVersion: PROTOCOL_VERSION, workspaceId: 'workspace-a', token: credential }))
  await waitMessage(socket, messages, message => message.id === 'handshake')
  return { socket, messages }
}

function waitMessage(socket: WebSocket, messages: MessageEnvelope[], matches: (message: MessageEnvelope) => boolean) {
  const existing = messages.find(matches)
  if (existing) return Promise.resolve(existing)
  const { promise, resolve } = Promise.withResolvers<MessageEnvelope>()
  const listener = (data: WebSocket.RawData) => {
    const message = deserializeEnvelope(data.toString())
    if (!matches(message)) return
    socket.off('message', listener)
    resolve(message)
  }
  socket.on('message', listener)
  return promise
}

async function invoke(connection: TestConnection, channel: string, ...args: unknown[]) {
  const id = crypto.randomUUID()
  connection.socket.send(JSON.stringify({ id, type: 'request', channel, args }))
  return waitMessage(connection.socket, connection.messages, message => message.id === id)
}

/** The shell adapter is in memory; custody, encrypted outbox, authority, RPC and note bytes are real. */
function replicaIpcFixture(configDir: string) {
  const handlers = new Map<string, (event: IpcMainInvokeEvent, input: any) => any>()
  const storedKeys = new Map<string, any>()
  const windows = new Map<number, string>([[41, 'workspace-a'], [42, 'workspace-a']])
  const ipc = {
    handle: (channel: string, handler: any) => handlers.set(channel, handler),
    removeHandler: (channel: string) => handlers.delete(channel),
  } as unknown as IpcMain
  const dispose = registerNativeReplicaIpc(ipc, {
    configDir,
    credentials: {
      get: async (id) => storedKeys.get(JSON.stringify(id)) ?? null,
      set: async (id, value) => { storedKeys.set(JSON.stringify(id), value) },
    },
    getWorkspaceForWindow: (id) => windows.get(id) ?? null,
  })
  cleanups.push(dispose)
  const sender = Object.assign(new EventEmitter(), { id: 41, isDestroyed: () => false })
  const otherSender = Object.assign(new EventEmitter(), { id: 42, isDestroyed: () => false })
  const call = (channel: string, input: unknown, owner = sender) => handlers.get(channel)!({ sender: owner } as unknown as IpcMainInvokeEvent, input)
  return { call, sender, otherSender, windows, storedKeys }
}

test('authenticated Notes producer and two independent transport consumers retain a durable offline operation through renderer loss and receipt loss', async () => {
  const f = await fixture(true)
  const primary = new WsRpcClient(f.url, { workspaceId: f.workspaceId, token: f.issued.credential, autoReconnect: false })
  cleanups.push(() => primary.destroy())
  // Existing Electron/web renderer proxy is one consumer; an independently enrolled WsRpcClient is the other.
  const rendererApi = buildClientApi(primary, CHANNEL_MAP)
  const secondIssued = f.authority.redeemEnrollment(f.authority.issueEnrollment(f.admin.credential, 'independent consumer', Date.now() + 60_000), 'independent consumer')!
  f.authority.grantWorkspace(f.admin.credential, secondIssued.principal.subject, f.workspaceId, ['read'])
  const secondary = new WsRpcClient(f.url, { workspaceId: f.workspaceId, token: secondIssued.credential, autoReconnect: false })
  cleanups.push(() => secondary.destroy())

  const created = await rendererApi.createNote(f.workspaceId, 'Durable fixture', undefined, { operationId: 'durable-create', expectedRevision: null, schemaVersion: 1 })
  const snapshot = await rendererApi.nativeData.readEntity({ workspaceId: f.workspaceId, kind: 'notes', nativeId: created.id })
  expect(snapshot).toMatchObject({ nativeId: created.id, revision: 1, files: [{ path: `notes/${created.id}.md` }] })
  const secondSnapshot = await secondary.invoke(RPC_CHANNELS.nativeData.READ_ENTITY, { workspaceId: f.workspaceId, kind: 'notes', nativeId: created.id })
  expect(secondSnapshot).toEqual(snapshot)
  const context = await primary.invoke(RPC_CHANNELS.nativeData.GET_CONTEXT, { workspaceId: f.workspaceId }) as NativeDataContext
  const ipc = replicaIpcFixture(join(f.dir, 'client'))
  const handle = await ipc.call(NATIVE_REPLICA_IPC.OPEN, { context }) as string
  await ipc.call(NATIVE_REPLICA_IPC.CACHE_SNAPSHOT, { handle, snapshot })
  const queued = await ipc.call(NATIVE_REPLICA_IPC.ENQUEUE, { handle, mutation: {
    nativeId: snapshot!.nativeId, expectedRevision: snapshot!.revision, schemaVersion: 1,
    changes: [{ path: snapshot!.files[0]!.path, content: '# Offline fixture\n' }],
  } }) as NativeReplicaQueuedMutation
  expect(readFileSync(join(f.root, snapshot!.files[0]!.path), 'utf8')).toBe(snapshot!.files[0]!.content)
  await expect(Promise.resolve().then(() => ipc.call(NATIVE_REPLICA_IPC.PENDING, { handle }, ipc.otherSender))).rejects.toThrow('not owned')

  // Actual renderer-loss callback closes custody; a fresh session decrypts the same SQLite operation.
  ipc.sender.emit('render-process-gone')
  const reopened = await ipc.call(NATIVE_REPLICA_IPC.OPEN, { context }) as string
  expect(await ipc.call(NATIVE_REPLICA_IPC.PENDING, { handle: reopened })).toEqual([queued])
  const receipt = await rendererApi.nativeData.mutate(queued) as NativeDataReceipt
  expect(receipt).toMatchObject({ nativeId: queued.nativeId, operationId: queued.operationId, revision: 2, sequence: 2, subject: context.subject })
  // Simulate server success followed by lost response/renderer crash before local acknowledgement.
  ipc.sender.emit('render-process-gone')
  const replayHandle = await ipc.call(NATIVE_REPLICA_IPC.OPEN, { context }) as string
  expect(await ipc.call(NATIVE_REPLICA_IPC.PENDING, { handle: replayHandle })).toEqual([queued])
  const replayReceipt = await rendererApi.nativeData.mutate(queued)
  expect(replayReceipt).toEqual(receipt)
  await expect(Promise.resolve().then(() => ipc.call(NATIVE_REPLICA_IPC.ACKNOWLEDGE, { handle: replayHandle, receipt: { ...receipt, operationId: 'wrong-operation' } }))).resolves.toBe(false)
  await expect(Promise.resolve().then(() => ipc.call(NATIVE_REPLICA_IPC.ACKNOWLEDGE, { handle: replayHandle, receipt: { ...receipt, subject: secondIssued.principal.subject } }))).rejects.toThrow('does not match')
  expect(await ipc.call(NATIVE_REPLICA_IPC.PENDING, { handle: replayHandle })).toEqual([queued])
  expect(await ipc.call(NATIVE_REPLICA_IPC.ACKNOWLEDGE, { handle: replayHandle, receipt: replayReceipt })).toBe(true)
  expect(await ipc.call(NATIVE_REPLICA_IPC.PENDING, { handle: replayHandle })).toEqual([])
  const finalSnapshot = await secondary.invoke(RPC_CHANNELS.nativeData.READ_ENTITY, { workspaceId: f.workspaceId, kind: 'notes', nativeId: created.id })
  expect(finalSnapshot).toMatchObject({ nativeId: created.id, revision: 2, files: [{ path: snapshot!.files[0]!.path, content: '# Offline fixture\n' }] })
  const changes = await secondary.invoke(RPC_CHANNELS.nativeData.PULL_CHANGES, { workspaceId: f.workspaceId, afterSequence: 1 })
  expect(changes.changes).toHaveLength(1)
  expect(changes.changes[0]).toEqual(receipt)
  expect(changes.entities).toEqual([finalSnapshot])

  // Changing the shell workspace invalidates sender-bound custody and keeps pending data durable.
  ipc.windows.set(ipc.sender.id, 'workspace-other')
  expect(() => ipc.call(NATIVE_REPLICA_IPC.PENDING, { handle: replayHandle })).toThrow('workspace changed')
  ipc.windows.set(ipc.sender.id, f.workspaceId)
  const finalHandle = await ipc.call(NATIVE_REPLICA_IPC.OPEN, { context }) as string
  expect(await ipc.call(NATIVE_REPLICA_IPC.PENDING, { handle: finalHandle })).toEqual([])

  await expect(secondary.invoke(RPC_CHANNELS.nativeData.MUTATE, { ...queued, operationId: 'read-only-write', expectedRevision: 2 })).rejects.toThrow()
  await expect(secondary.invoke(RPC_CHANNELS.nativeData.READ_ENTITY, { workspaceId: 'workspace-other', kind: 'notes', nativeId: created.id })).rejects.toThrow()
  f.authority.revokeWorkspaceGrant(f.admin.credential, secondIssued.principal.subject, f.workspaceId)
  await expect(secondary.invoke(RPC_CHANNELS.nativeData.READ_ENTITY, { workspaceId: f.workspaceId, kind: 'notes', nativeId: created.id })).rejects.toThrow()
  expect(readFileSync(join(f.root, snapshot!.files[0]!.path), 'utf8')).toBe('# Offline fixture\n')
})

test('real preload source cache permits durable known-note authoring after socket loss, then reauthorizes and flushes the exact draft', async () => {
  const f = await fixture(true)
  const client = new WsRpcClient(f.url, { workspaceId: f.workspaceId, token: f.issued.credential, autoReconnect: false, requestTimeout: 500, connectTimeout: 500 })
  cleanups.push(() => client.destroy())
  const ipc = replicaIpcFixture(join(f.dir, 'offline-client'))
  const bridge = createNativeReplicaBridge({ client, invokeIpc: async (channel, input) => ipc.call(channel, input) })
  cleanups.push(bridge.dispose)
  const api = buildClientApi(client, CHANNEL_MAP)
  api.nativeReplica = bridge.nativeReplica
  api.nativeData.readEntity = bridge.readEntity
  api.nativeData.mutate = bridge.mutate
  api.getTransportConnectionState = async () => client.getConnectionState()
  const controller = createNativeNotesSyncController(api)
  cleanups.push(() => { void controller.stop().catch(() => {}) })
  const created = await api.createNote(f.workspaceId, 'Offline author', undefined, { operationId: 'offline-source-create', expectedRevision: null, schemaVersion: 1 })
  await controller.start(f.workspaceId)
  const source = await api.nativeData.readEntity({ workspaceId: f.workspaceId, kind: 'notes', nativeId: created.nativeId! })
  expect(source?.revision).toBe(1)
  const disconnected = Promise.withResolvers<void>()
  const unsubscribe = client.onConnectionStateChanged(state => { if (state.status === 'disconnected') disconnected.resolve() })
  // Terminate the actual accepted WS connection, yielding an abnormal network close (1006).
  for (const connection of (f.server as unknown as { clients: Map<string, { ws: WebSocket }> }).clients.values()) connection.ws.terminate()
  await disconnected.promise
  unsubscribe()
  expect(client.getConnectionState().lastClose?.code).toBe(1006)
  const queued = await controller.queueSave(created, '# Durable offline authoring\n')
  const queuedSecond = await controller.queueSave(created, '# Second durable offline draft\n')
  expect(queued).toMatchObject({ nativeId: created.nativeId, expectedRevision: 1, changes: [{ path: source!.files[0]!.path, content: '# Durable offline authoring\n' }] })
  expect(client.getConnectionState().status).toBe('disconnected')
  expect(queuedSecond.expectedRevision).toBe(2)
  expect(readFileSync(join(f.root, source!.files[0]!.path), 'utf8')).toBe(source!.files[0]!.content)
  const receipts = await controller.flush()
  expect(receipts).toHaveLength(2)
  expect(receipts[0]).toMatchObject({ operationId: queued.operationId, revision: 2 })
  expect(receipts[1]).toMatchObject({ operationId: queuedSecond.operationId, revision: 3 })
  const secondDisconnected = Promise.withResolvers<void>()
  const unsubscribeAgain = client.onConnectionStateChanged(state => { if (state.status === 'disconnected') secondDisconnected.resolve() })
  for (const connection of (f.server as unknown as { clients: Map<string, { ws: WebSocket }> }).clients.values()) connection.ws.terminate()
  await secondDisconnected.promise
  unsubscribeAgain()
  const afterReceipt = await controller.queueSave(created, '# Offline again using committed receipt\n')
  expect(afterReceipt.expectedRevision).toBe(3)
  expect((await controller.flush())[0]?.revision).toBe(4)
  expect((await api.nativeData.readEntity({ workspaceId: f.workspaceId, kind: 'notes', nativeId: created.nativeId! }))?.files[0]?.content).toBe('# Offline again using committed receipt\n')
  await controller.stop()
})

test('moved and renamed Notes retain immutable identity for durable saves, while a stale cached path conflicts without recreating bytes', async () => {
  const f = await fixture(true)
  const client = new WsRpcClient(f.url, { workspaceId: f.workspaceId, token: f.issued.credential, autoReconnect: false })
  cleanups.push(() => client.destroy())
  const ipc = replicaIpcFixture(join(f.dir, 'move-client'))
  const bridge = createNativeReplicaBridge({ client, invokeIpc: async (channel, input) => ipc.call(channel, input) })
  cleanups.push(bridge.dispose)
  const api = buildClientApi(client, CHANNEL_MAP)
  api.nativeReplica = bridge.nativeReplica
  api.nativeData.readEntity = bridge.readEntity
  api.nativeData.mutate = bridge.mutate
  api.readNote = bridge.readNote
  api.getTransportConnectionState = async () => client.getConnectionState()
  const controller = createNativeNotesSyncController(api)
  const created = await api.createNote(f.workspaceId, 'Stable identity', undefined, { operationId: 'identity-create', expectedRevision: null, schemaVersion: 1 })
  await controller.start(f.workspaceId)
  const before = await api.readNote(f.workspaceId, created.id)
  expect(before.nativeId).toBe(created.id)
  const moved = await api.moveNote(f.workspaceId, before.id, 'folder-a', { operationId: 'identity-move', expectedRevision: 1, schemaVersion: 1 })
  expect(moved.note).toMatchObject({ id: 'folder-a/Stable identity', nativeId: before.nativeId, nativeRevision: 2 })
  const renamed = await api.renameNote(f.workspaceId, moved.note.id, 'Renamed identity', { operationId: 'identity-rename', expectedRevision: 2, schemaVersion: 1 })
  expect(renamed.note).toMatchObject({ id: 'folder-a/Renamed identity', nativeId: before.nativeId, nativeRevision: 3 })
  const listed = await api.listNotes(f.workspaceId)
  expect(listed.map(note => note.id)).toEqual(['folder-a/Renamed identity'])
  await expect(api.readNote(f.workspaceId, before.id)).rejects.toThrow()
  const read = await api.readNote(f.workspaceId, renamed.note.id)
  expect(read.nativeId).toBe(before.nativeId)
  const queued = await controller.queueSave(read, '# Saved after move and rename\n')
  expect(queued).toMatchObject({ nativeId: before.nativeId, expectedRevision: 3, changes: [{ path: 'notes/folder-a/Renamed identity.md' }] })
  expect((await controller.flush())[0]?.revision).toBe(4)
  expect(await api.readNote(f.workspaceId, renamed.note.id)).toMatchObject({ nativeId: before.nativeId, nativeRevision: 4, content: '# Saved after move and rename\n' })
  await controller.stop()

  const context = await client.invoke(RPC_CHANNELS.nativeData.GET_CONTEXT, { workspaceId: f.workspaceId }) as NativeDataContext
  const handle = await ipc.call(NATIVE_REPLICA_IPC.OPEN, { context }) as string
  // A previously authoritative cached revision remains a draft basis, never a second authority.
  await ipc.call(NATIVE_REPLICA_IPC.CACHE_SNAPSHOT, { handle, snapshot: { workspaceId: f.workspaceId, kind: 'notes', nativeId: before.nativeId, revision: 1, deleted: false, contentHash: 'a'.repeat(64), files: [{ path: 'notes/Stable identity.md', content: before.content }] } })
  const stale = await ipc.call(NATIVE_REPLICA_IPC.ENQUEUE, { handle, mutation: { nativeId: before.nativeId, expectedRevision: 1, schemaVersion: 1, changes: [{ path: 'notes/Stable identity.md', content: '# Stale path draft' }] } }) as NativeReplicaQueuedMutation
  await expect(api.nativeData.mutate(stale)).rejects.toThrow()
  expect(await ipc.call(NATIVE_REPLICA_IPC.PENDING, { handle })).toEqual([stale])
  expect(await api.readNote(f.workspaceId, renamed.note.id)).toMatchObject({ nativeRevision: 4, content: '# Saved after move and rename\n' })
  expect(() => readFileSync(join(f.root, 'notes/Stable identity.md'), 'utf8')).toThrow()
})

test('renderer-fabricated receipts cannot acknowledge an unsubmitted draft or alter an observed trusted response', async () => {
  const f = await fixture(true)
  const client = new WsRpcClient(f.url, { workspaceId: f.workspaceId, token: f.issued.credential, autoReconnect: false })
  cleanups.push(() => client.destroy())
  const ipc = replicaIpcFixture(join(f.dir, 'forgery-client'))
  const bridge = createNativeReplicaBridge({ client, invokeIpc: async (channel, input) => ipc.call(channel, input) })
  cleanups.push(bridge.dispose)
  const api = buildClientApi(client, CHANNEL_MAP)
  const created = await api.createNote(f.workspaceId, 'Forged receipt fixture', undefined, { operationId: 'forgery-create', expectedRevision: null, schemaVersion: 1 })
  const handle = await bridge.nativeReplica.open(f.workspaceId)
  const source = await bridge.readEntity({ workspaceId: f.workspaceId, kind: 'notes', nativeId: created.nativeId! })
  const context = await client.invoke(RPC_CHANNELS.nativeData.GET_CONTEXT, { workspaceId: f.workspaceId }) as NativeDataContext
  const queued = await bridge.nativeReplica.enqueue(handle, { nativeId: created.nativeId!, expectedRevision: source!.revision, schemaVersion: 1, changes: [{ path: source!.files[0]!.path, content: '# Unsubmitted durable draft\n' }] })
  const digest = async (value: string) => Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))).toString('hex')
  const forged: NativeDataReceipt = { issuer: context.issuer, subject: context.subject, workspaceId: f.workspaceId, kind: 'notes', nativeId: queued.nativeId, operationId: queued.operationId, sequence: 2, revision: 2, deleted: false, contentHash: await digest(JSON.stringify([[queued.changes[0]!.path, await digest(queued.changes[0]!.content!)]])) }
  await expect(bridge.nativeReplica.acknowledge(handle, forged)).rejects.toThrow('observed server mutation receipt')
  expect(await bridge.nativeReplica.pending(handle)).toEqual([queued])
  expect(readFileSync(join(f.root, source!.files[0]!.path), 'utf8')).toBe(source!.files[0]!.content)
  const observed = await bridge.mutate(queued)
  const valid = { ...observed }
  observed.contentHash = 'a'.repeat(64)
  await expect(bridge.nativeReplica.acknowledge(handle, observed)).rejects.toThrow('observed server mutation receipt')
  expect(await bridge.nativeReplica.pending(handle)).toEqual([queued])
  expect(await bridge.nativeReplica.acknowledge(handle, valid)).toBe(true)
  expect(await bridge.nativeReplica.pending(handle)).toEqual([])
  expect(await bridge.nativeReplica.acknowledge(handle, valid)).toBe(true)
  expect(await ipc.call(NATIVE_REPLICA_IPC.ACKNOWLEDGE, { handle, receipt: { ...valid, nativeId: 'wrong-note-after-ack' } })).toBe(false)
  await bridge.nativeReplica.close(handle)
  expect(ipc.sender.listenerCount('render-process-gone')).toBe(0)
  expect(ipc.sender.listenerCount('destroyed')).toBe(0)
})

test('closing custody during a committed but delayed RPC response fences receipt registration until stable server replay', async () => {
  const f = await fixture(true)
  const client = new WsRpcClient(f.url, { workspaceId: f.workspaceId, token: f.issued.credential, autoReconnect: false })
  cleanups.push(() => client.destroy())
  const committed = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  const delayedClient = {
    invoke: async (channel: string, ...args: unknown[]) => {
      const result = await client.invoke(channel, ...args)
      if (channel === RPC_CHANNELS.nativeData.MUTATE) { committed.resolve(); await release.promise }
      return result
    },
    getConnectionState: () => client.getConnectionState(),
    onConnectionStateChanged: (listener: Parameters<WsRpcClient['onConnectionStateChanged']>[0]) => client.onConnectionStateChanged(listener),
  }
  const ipc = replicaIpcFixture(join(f.dir, 'receipt-fence-client'))
  const bridge = createNativeReplicaBridge({ client: delayedClient, invokeIpc: async (channel, input) => ipc.call(channel, input) })
  cleanups.push(bridge.dispose)
  const api = buildClientApi(client, CHANNEL_MAP)
  const created = await api.createNote(f.workspaceId, 'Delayed response fixture', undefined, { operationId: 'delayed-create', expectedRevision: null, schemaVersion: 1 })
  const handle = await bridge.nativeReplica.open(f.workspaceId)
  const source = await bridge.readEntity({ workspaceId: f.workspaceId, kind: 'notes', nativeId: created.nativeId! })
  const queued = await bridge.nativeReplica.enqueue(handle, { nativeId: created.nativeId!, expectedRevision: source!.revision, schemaVersion: 1, changes: [{ path: source!.files[0]!.path, content: '# Delayed receipt draft' }] })
  const mutation = bridge.mutate(queued)
  await committed.promise
  await bridge.nativeReplica.close(handle)
  const reopened = await bridge.nativeReplica.open(f.workspaceId)
  release.resolve()
  const delayedReceipt = await mutation
  await expect(bridge.nativeReplica.acknowledge(reopened, delayedReceipt)).rejects.toThrow('observed server mutation receipt')
  expect(await bridge.nativeReplica.pending(reopened)).toEqual([queued])
  const replay = await bridge.mutate(queued)
  expect(replay).toEqual(delayedReceipt)
  expect(await bridge.nativeReplica.acknowledge(reopened, replay)).toBe(true)
  expect(await bridge.nativeReplica.pending(reopened)).toEqual([])
  await bridge.nativeReplica.close(reopened)
})

// Creation uses the same actual authority/WS/journal/SQLite adapters as durable editing.
test('preload native creation persists before the first server write and retains exact revision-one receipt and ACK', async () => {
  const f = await fixture(true)
  const client = new WsRpcClient(f.url, { workspaceId: f.workspaceId, token: f.issued.credential, autoReconnect: false })
  cleanups.push(() => client.destroy())
  const configDir = join(f.dir, 'creation-client')
  const ipc = replicaIpcFixture(configDir)
  let queued: NativeReplicaQueuedMutation | undefined
  let receipt: NativeDataReceipt | undefined
  const observedClient = {
    invoke: async (channel: string, ...args: unknown[]) => {
      if (channel === RPC_CHANNELS.nativeData.MUTATE) {
        expect(queued).toBeDefined()
        expect(await client.invoke(RPC_CHANNELS.nativeData.READ_ENTITY, { workspaceId: f.workspaceId, kind: 'notes', nativeId: queued!.nativeId })).toBeNull()
        expect(existsSync(join(f.root, queued!.changes[0]!.path))).toBe(false)
      }
      const result = await client.invoke(channel, ...args)
      if (channel === RPC_CHANNELS.nativeData.MUTATE) receipt = result
      return result
    },
    getConnectionState: () => client.getConnectionState(),
    onConnectionStateChanged: (listener: Parameters<WsRpcClient['onConnectionStateChanged']>[0]) => client.onConnectionStateChanged(listener),
  }
  const bridge = createNativeReplicaBridge({ client: observedClient, invokeIpc: async (channel, input) => {
    const result = await ipc.call(channel, input)
    if (channel === NATIVE_REPLICA_IPC.ENQUEUE_CREATE) queued = result
    return result
  } })
  cleanups.push(bridge.dispose)
  const note = await bridge.createNote(f.workspaceId, 'Canonical: creation', 'nested', { operationId: 'renderer-cannot-assign-custody-id', expectedRevision: null, schemaVersion: 1 })
  expect(note).toMatchObject({ nativeRevision: 1, nativeId: queued!.nativeId })
  expect(queued!.operationId).not.toBe('renderer-cannot-assign-custody-id')
  expect(queued!.expectedRevision).toBeNull()
  expect(receipt).toMatchObject({ operationId: queued!.operationId, sequence: 1, revision: 1, deleted: false })
  expect(readFileSync(join(f.root, queued!.changes[0]!.path), 'utf8')).toBe(note.content)
  const handle = await bridge.nativeReplica.open(f.workspaceId)
  expect(await bridge.nativeReplica.pending(handle)).toEqual([])
  const material = JSON.parse([...ipc.storedKeys.values()][0].value)
  const dbPath = [...new Bun.Glob('**/*.sqlite').scanSync({ cwd: join(configDir, 'account-replica'), absolute: true })][0]!
  const outbox = new SqliteReplicaOutbox({ databasePath: dbPath, key: Buffer.from(material.outboxKey, 'base64') })
  try {
    expect(outbox.acknowledgement(material.accountHash, f.workspaceId, queued!.operationId)).toMatchObject({ serverSequence: 1, revision: 1 })
    expect(outbox.readReceipt(material.accountHash, f.workspaceId, queued!.operationId)).toEqual(receipt!)
  } finally { outbox.close() }
  await bridge.nativeReplica.close(handle)
})

for (const loss of ['before-submit', 'after-commit'] as const) test(`durable native creation recovers ${loss} through renderer loss and stable authenticated replay`, async () => {
  const f = await fixture(true)
  const client = new WsRpcClient(f.url, { workspaceId: f.workspaceId, token: f.issued.credential, autoReconnect: false })
  cleanups.push(() => client.destroy())
  const ipc = replicaIpcFixture(join(f.dir, `creation-${loss}`))
  let queued: NativeReplicaQueuedMutation | undefined
  let lostReceipt: NativeDataReceipt | undefined
  let fail = true
  const interrupted = {
    invoke: async (channel: string, ...args: unknown[]) => {
      if (channel === RPC_CHANNELS.nativeData.MUTATE && fail) {
        fail = false
        if (loss === 'after-commit') lostReceipt = await client.invoke(channel, ...args)
        ipc.sender.emit('render-process-gone')
        throw new Error('simulated renderer loss')
      }
      return client.invoke(channel, ...args)
    },
    getConnectionState: () => client.getConnectionState(),
    onConnectionStateChanged: (listener: Parameters<WsRpcClient['onConnectionStateChanged']>[0]) => client.onConnectionStateChanged(listener),
  }
  const bridge = createNativeReplicaBridge({ client: interrupted, invokeIpc: async (channel, input) => {
    const result = await ipc.call(channel, input)
    if (channel === NATIVE_REPLICA_IPC.ENQUEUE_CREATE) queued = result
    return result
  } })
  cleanups.push(bridge.dispose)
  await expect(bridge.createNote(f.workspaceId, 'Recover creation')).rejects.toThrow('renderer loss')
  expect(queued).toBeDefined()
  const fresh = createNativeReplicaBridge({ client, invokeIpc: async (channel, input) => ipc.call(channel, input) })
  cleanups.push(fresh.dispose)
  const handle = await fresh.nativeReplica.open(f.workspaceId)
  expect(await fresh.nativeReplica.pending(handle)).toEqual([queued!])
  const digest = async (value: string) => Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))).toString('hex')
  const fake = { issuer: f.issued.principal.issuer, subject: f.issued.principal.subject, workspaceId: f.workspaceId, kind: 'notes', nativeId: queued!.nativeId, operationId: queued!.operationId, revision: 1, sequence: 1, contentHash: await digest(JSON.stringify([[queued!.changes[0]!.path, await digest(queued!.changes[0]!.content!)]])), deleted: false } satisfies NativeDataReceipt
  await expect(fresh.nativeReplica.acknowledge(handle, fake)).rejects.toThrow('observed server mutation receipt')
  await expect(Promise.resolve().then(() => ipc.call(NATIVE_REPLICA_IPC.PENDING, { handle }, ipc.otherSender))).rejects.toThrow('not owned')
  const replayController = createNativeNotesSyncController({ nativeReplica: fresh.nativeReplica,
    nativeData: { readEntity: fresh.readEntity, mutate: fresh.mutate }, getTransportConnectionState: async () => client.getConnectionState() })
  await replayController.start(f.workspaceId)
  const replays = await replayController.flush()
  expect(replays).toHaveLength(1)
  const replay = replays[0]!
  if (lostReceipt) expect(replay).toEqual(lostReceipt)
  expect(replay).toMatchObject({ sequence: 1, revision: 1, operationId: queued!.operationId })
  expect(await fresh.nativeReplica.pending(handle)).toEqual([])
  await replayController.stop()
  expect((await client.invoke(RPC_CHANNELS.nativeData.PULL_CHANGES, { workspaceId: f.workspaceId, afterSequence: 0 })).changes).toEqual([replay])
  expect(readFileSync(join(f.root, queued!.changes[0]!.path), 'utf8')).toBe(queued!.changes[0]!.content!)
  await fresh.nativeReplica.close(handle)
})

test('creation plan loses authority after grant change and after managed workspace switch without enqueue or file writes', async () => {
  for (const change of ['grant', 'window', 'write-epoch', 'principal'] as const) {
    const f = await fixture(true)
    const client = new WsRpcClient(f.url, { workspaceId: f.workspaceId, token: f.issued.credential, autoReconnect: false })
    cleanups.push(() => client.destroy())
    const ipc = replicaIpcFixture(join(f.dir, 'creation-fenced'))
    const alternative = f.authority.redeemEnrollment(f.authority.issueEnrollment(f.admin.credential, 'other author', Date.now() + 60_000), 'other author')!
    f.authority.grantWorkspace(f.admin.credential, alternative.principal.subject, f.workspaceId, ['read', 'write'])
    const otherClient = new WsRpcClient(f.url, { workspaceId: f.workspaceId, token: alternative.credential, autoReconnect: false })
    cleanups.push(() => otherClient.destroy())
    let activeClient = client
    let planned = false
    const handleClient = {
      invoke: async (channel: string, ...args: unknown[]) => {
        const result = await activeClient.invoke(channel, ...args)
        if (channel === RPC_CHANNELS.notes.PREPARE_CREATE && !planned) {
          planned = true
          if (change === 'grant') f.authority.revokeWorkspaceGrant(f.admin.credential, f.issued.principal.subject, f.workspaceId)
          else if (change === 'window') ipc.windows.set(ipc.sender.id, 'workspace-other')
          else if (change === 'write-epoch') f.authority.grantWorkspace(f.admin.credential, f.issued.principal.subject, f.workspaceId, ['write'])
          else activeClient = otherClient
        }
        return result
      },
      getConnectionState: () => client.getConnectionState(),
      onConnectionStateChanged: (listener: Parameters<WsRpcClient['onConnectionStateChanged']>[0]) => client.onConnectionStateChanged(listener),
    }
    let enqueues = 0
    const bridge = createNativeReplicaBridge({ client: handleClient, invokeIpc: async (channel, input) => {
      if (channel === NATIVE_REPLICA_IPC.ENQUEUE_CREATE) enqueues++
      return ipc.call(channel, input)
    } })
    cleanups.push(bridge.dispose)
    await expect(bridge.createNote(f.workspaceId, 'Denied creation')).rejects.toThrow()
    expect(enqueues).toBe(0)
    expect(existsSync(join(f.root, 'notes', 'Denied creation.md'))).toBe(false)
  }
})

test('concurrent same-path native creation rejects the losing mutation, retaining its outbox without overwrite', async () => {
  const f = await fixture(true)
  const client = new WsRpcClient(f.url, { workspaceId: f.workspaceId, token: f.issued.credential, autoReconnect: false })
  cleanups.push(() => client.destroy())
  const ipc = replicaIpcFixture(join(f.dir, 'creation-collision'))
  let queued: NativeReplicaQueuedMutation | undefined
  const racingClient = {
    invoke: async (channel: string, ...args: unknown[]) => {
      if (channel === RPC_CHANNELS.nativeData.MUTATE) {
        await client.invoke(RPC_CHANNELS.notes.CREATE, f.workspaceId, 'Racing creation', undefined, { operationId: 'other-client-create', expectedRevision: null, schemaVersion: 1 })
      }
      return client.invoke(channel, ...args)
    },
    getConnectionState: () => client.getConnectionState(),
    onConnectionStateChanged: (listener: Parameters<WsRpcClient['onConnectionStateChanged']>[0]) => client.onConnectionStateChanged(listener),
  }
  const bridge = createNativeReplicaBridge({ client: racingClient, invokeIpc: async (channel, input) => {
    const result = await ipc.call(channel, input)
    if (channel === NATIVE_REPLICA_IPC.ENQUEUE_CREATE) queued = result
    return result
  } })
  cleanups.push(bridge.dispose)
  await expect(bridge.createNote(f.workspaceId, 'Racing creation')).rejects.toThrow()
  const handle = await bridge.nativeReplica.open(f.workspaceId)
  expect(await bridge.nativeReplica.pending(handle)).toEqual([queued!])
  const changes = await client.invoke(RPC_CHANNELS.nativeData.PULL_CHANGES, { workspaceId: f.workspaceId, afterSequence: 0 })
  expect(changes.changes).toHaveLength(1)
  expect(changes.changes[0].operationId).toBe('other-client-create')
  expect(changes.entities[0].revision).toBe(1)
  expect(readFileSync(join(f.root, queued!.changes[0]!.path), 'utf8')).toBe(queued!.changes[0]!.content!)
  await bridge.nativeReplica.close(handle)
})

test('disposing preload while an actual creation plan response is in flight cannot enqueue or commit', async () => {
  const f = await fixture(true)
  const client = new WsRpcClient(f.url, { workspaceId: f.workspaceId, token: f.issued.credential, autoReconnect: false })
  cleanups.push(() => client.destroy())
  const planned = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  const delayed = {
    invoke: async (channel: string, ...args: unknown[]) => {
      const result = await client.invoke(channel, ...args)
      if (channel === RPC_CHANNELS.notes.PREPARE_CREATE) { planned.resolve(); await release.promise }
      return result
    },
    getConnectionState: () => client.getConnectionState(),
    onConnectionStateChanged: (listener: Parameters<WsRpcClient['onConnectionStateChanged']>[0]) => client.onConnectionStateChanged(listener),
  }
  const ipc = replicaIpcFixture(join(f.dir, 'disposed-creation'))
  let enqueues = 0
  const bridge = createNativeReplicaBridge({ client: delayed, invokeIpc: async (channel, input) => {
    if (channel === NATIVE_REPLICA_IPC.ENQUEUE_CREATE) enqueues++
    return ipc.call(channel, input)
  } })
  cleanups.push(bridge.dispose)
  const creation = bridge.createNote(f.workspaceId, 'Disposed creation')
  await planned.promise
  bridge.dispose()
  release.resolve()
  await expect(creation).rejects.toThrow('context changed while planning')
  expect(enqueues).toBe(0)
  expect(existsSync(join(f.root, 'notes', 'Disposed creation.md'))).toBe(false)
})

test('private creation custody rejects foreign owners and malformed plans while public save enqueue remains snapshot-only', async () => {
  const f = await fixture(true)
  const client = new WsRpcClient(f.url, { workspaceId: f.workspaceId, token: f.issued.credential, autoReconnect: false })
  cleanups.push(() => client.destroy())
  const ipc = replicaIpcFixture(join(f.dir, 'creation-plan-validation'))
  const bridge = createNativeReplicaBridge({ client, invokeIpc: async (channel, input) => ipc.call(channel, input) })
  cleanups.push(bridge.dispose)
  const handle = await bridge.nativeReplica.open(f.workspaceId)
  const plan = await client.invoke(RPC_CHANNELS.notes.PREPARE_CREATE, f.workspaceId, 'Validated creation')
  await expect(Promise.resolve().then(() => ipc.call(NATIVE_REPLICA_IPC.ENQUEUE_CREATE, { handle, plan }, ipc.otherSender))).rejects.toThrow('not owned')
  for (const altered of [
    { ...plan, context: { ...plan.context, subject: 'foreign-principal' } },
    { ...plan, mutation: { ...plan.mutation, expectedRevision: 1 } },
    { ...plan, mutation: { ...plan.mutation, nativeId: '../outside', changes: [{ path: 'notes/../outside.md', content: 'escape' }] } },
    { ...plan, mutation: { ...plan.mutation, changes: [{ ...plan.mutation.changes[0], content: null }] } },
    { ...plan, mutation: { ...plan.mutation, changes: [...plan.mutation.changes, { path: 'notes/second.md', content: 'extra' }] } },
  ]) await expect(Promise.resolve().then(() => ipc.call(NATIVE_REPLICA_IPC.ENQUEUE_CREATE, { handle, plan: altered }))).rejects.toThrow('canonical server plan')
  await expect(bridge.nativeReplica.enqueue(handle, plan.mutation)).rejects.toThrow('authoritative source snapshot')
  expect(await bridge.nativeReplica.pending(handle)).toEqual([])
  expect(existsSync(join(f.root, 'notes'))).toBe(false)
  await bridge.nativeReplica.close(handle)
})

for (const boundary of ['context-open', 'ipc-open', 'enqueue'] as const) test(`disposing creation during ${boundary} cannot submit and preserves only already-persisted intent`, async () => {
  const f = await fixture(true)
  const client = new WsRpcClient(f.url, { workspaceId: f.workspaceId, token: f.issued.credential, autoReconnect: false })
  cleanups.push(() => client.destroy())
  const paused = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  let held = false
  let submitted = 0
  let enqueued = 0
  const ipc = replicaIpcFixture(join(f.dir, `dispose-${boundary}`))
  const delayed = {
    invoke: async (channel: string, ...args: unknown[]) => {
      if (channel === RPC_CHANNELS.nativeData.MUTATE) submitted++
      const result = await client.invoke(channel, ...args)
      if (boundary === 'context-open' && channel === RPC_CHANNELS.nativeData.GET_CONTEXT && !held) {
        held = true; paused.resolve(); await release.promise
      }
      return result
    },
    getConnectionState: () => client.getConnectionState(),
    onConnectionStateChanged: (listener: Parameters<WsRpcClient['onConnectionStateChanged']>[0]) => client.onConnectionStateChanged(listener),
  }
  const bridge = createNativeReplicaBridge({ client: delayed, invokeIpc: async (channel, input) => {
    const result = await ipc.call(channel, input)
    if (channel === NATIVE_REPLICA_IPC.ENQUEUE_CREATE) enqueued++
    if ((boundary === 'ipc-open' && channel === NATIVE_REPLICA_IPC.OPEN) || (boundary === 'enqueue' && channel === NATIVE_REPLICA_IPC.ENQUEUE_CREATE)) {
      paused.resolve(); await release.promise
    }
    return result
  } })
  cleanups.push(bridge.dispose)
  const creation = bridge.createNote(f.workspaceId, 'Disposed boundary')
  await paused.promise
  bridge.dispose()
  release.resolve()
  await expect(creation).rejects.toThrow('context changed')
  expect(submitted).toBe(0)
  expect(enqueued).toBe(boundary === 'enqueue' ? 1 : 0)
  expect(existsSync(join(f.root, 'notes', 'Disposed boundary.md'))).toBe(false)
  // A late OPEN handle was closed rather than registered after disposal.
  expect(ipc.sender.listenerCount('render-process-gone')).toBe(0)
  const fresh = createNativeReplicaBridge({ client, invokeIpc: async (channel, input) => ipc.call(channel, input) })
  cleanups.push(fresh.dispose)
  const handle = await fresh.nativeReplica.open(f.workspaceId)
  const pending = await fresh.nativeReplica.pending(handle)
  expect(pending).toHaveLength(boundary === 'enqueue' ? 1 : 0)
  if (boundary === 'enqueue') expect(pending[0]).toMatchObject({ nativeId: 'Disposed boundary', expectedRevision: null })
  await fresh.nativeReplica.close(handle)
})
