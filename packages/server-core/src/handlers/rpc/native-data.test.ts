import { afterEach, expect, test } from 'bun:test'
import { once } from 'node:events'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import WebSocket from 'ws'
import { NativeAuthority, type NativeIssuedCredential } from '../../authority/native-authority.ts'
import { NativeJournal } from '../../authority/native-journal.ts'
import { CollaborationSyncService } from '../../collaboration/sync-service.ts'
import { WsRpcServer } from '../../transport/server.ts'
import { PROTOCOL_VERSION, RPC_CHANNELS, type MessageEnvelope } from '@rox/shared/protocol'
import { deserializeEnvelope } from '../../transport/codec.ts'
import { registerNativeDataHandlers } from './native-data.ts'
import { registerNotesHandlers } from './notes.ts'
import type { HandlerDeps } from '../handler-deps.ts'

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

test('native data RPC commits a server-bound note identity, returns durable receipt, and pulls its snapshot', async () => {
  const f = await fixture()
  const client = await connect(f.url, f.issued.credential)
  const mutation = {
    workspaceId: f.workspaceId,
    kind: 'notes',
    nativeId: 'note-a',
    operationId: 'op-create-note-a',
    expectedRevision: null,
    schemaVersion: 1,
    changes: [{ path: 'notes/note-a.md', content: '# Native note\n' }],
  }
  const committed = await invoke(client, RPC_CHANNELS.nativeData.MUTATE, mutation)
  expect(committed.error).toBeUndefined()
  expect(committed.result).toMatchObject({
    issuer: f.issued.principal.issuer,
    workspaceId: f.workspaceId,
    kind: 'notes',
    nativeId: 'note-a',
    operationId: 'op-create-note-a',
    subject: f.issued.principal.subject,
    sequence: 1,
    revision: 1,
    deleted: false,
  })
  expect(JSON.stringify(committed.result)).not.toContain(f.root)
  const retry = await invoke(client, RPC_CHANNELS.nativeData.MUTATE, mutation)
  expect(retry.result).toEqual(committed.result)
  const reused = await invoke(client, RPC_CHANNELS.nativeData.MUTATE, {
    ...mutation,
    changes: [{ path: 'notes/note-a.md', content: '# Different payload' }],
  })
  expect(reused.error).toBeDefined()
  const pulled = await invoke(client, RPC_CHANNELS.nativeData.PULL_CHANGES, { workspaceId: f.workspaceId, afterSequence: 0, limit: 10 })
  expect(pulled.result).toMatchObject({
    nextSequence: 1,
    hasMore: false,
    changes: [{ operationId: 'op-create-note-a', sequence: 1, revision: 1 }],
    entities: [{ workspaceId: f.workspaceId, kind: 'notes', nativeId: 'note-a', revision: 1, files: [{ path: 'notes/note-a.md', content: '# Native note\n' }] }],
  })
  expect(JSON.stringify(pulled.result)).not.toContain(f.root)
  const read = await invoke(client, RPC_CHANNELS.nativeData.READ_ENTITY, { workspaceId: f.workspaceId, kind: 'notes', nativeId: 'note-a' })
  expect(read.result).toMatchObject({ revision: 1, files: [{ path: 'notes/note-a.md', content: '# Native note\n' }] })
  expect(JSON.stringify(read.result)).not.toContain(f.root)
})
test('native mutation conflicts instead of adopting or overwriting untracked note bytes', async () => {
  const f = await fixture()
  mkdirSync(join(f.root, 'notes'))
  const foreignPath = join(f.root, 'notes', 'note-a.md')
  writeFileSync(foreignPath, 'preexisting foreign note bytes')
  const client = await connect(f.url, f.issued.credential)
  const result = await invoke(client, RPC_CHANNELS.nativeData.MUTATE, {
    workspaceId: f.workspaceId,
    kind: 'notes',
    nativeId: 'note-a',
    operationId: 'op-no-overwrite',
    expectedRevision: null,
    schemaVersion: 1,
    changes: [{ path: 'notes/note-a.md', content: '# Replace attempt' }],
  })
  expect(result.error).toBeDefined()
  expect(readFileSync(foreignPath, 'utf8')).toBe('preexisting foreign note bytes')
})

test('native Notes RPC uses journal revisions and preserves Markdown drafts on stale save conflicts', async () => {
  const f = await fixture(true)
  const client = await connect(f.url, f.issued.credential)
  const created = await invoke(client, RPC_CHANNELS.notes.CREATE, f.workspaceId, 'Native note', undefined, {
    operationId: 'note-create-1',
    expectedRevision: null,
    schemaVersion: 1,
  })
  expect(created.error).toBeUndefined()
  expect(created.result).toMatchObject({ nativeRevision: 1, content: expect.stringContaining('title: Native note') })
  if (!created.result || typeof created.result !== 'object' || !('id' in created.result) || typeof created.result.id !== 'string') {
    throw new Error('native note create did not return a NotesDocument identity')
  }
  const noteId = created.result.id

  const saved = await invoke(client, RPC_CHANNELS.notes.SAVE, f.workspaceId, noteId, '# Current draft', '', {
    operationId: 'note-save-2',
    expectedRevision: 1,
    schemaVersion: 1,
  })
  expect(saved.error).toBeUndefined()
  expect(saved.result).toMatchObject({ id: noteId, nativeRevision: 2, content: '# Current draft' })

  const staleSave = await invoke(client, RPC_CHANNELS.notes.SAVE, f.workspaceId, noteId, '# Stale draft', '', {
    operationId: 'note-save-stale',
    expectedRevision: 1,
    schemaVersion: 1,
  })
  expect(staleSave.error).toBeDefined()
  const reread = await invoke(client, RPC_CHANNELS.notes.READ, f.workspaceId, noteId)
  expect(reread.result).toMatchObject({ id: noteId, nativeRevision: 2, content: '# Current draft' })
})


test('native data RPC denies mismatched workspace before reading and honors grant revocation', async () => {
  const f = await fixture()
  const client = await connect(f.url, f.issued.credential)
  const mismatch = await invoke(client, RPC_CHANNELS.nativeData.READ_ENTITY, { workspaceId: 'workspace-other', kind: 'notes', nativeId: 'unseen' })
  expect(mismatch.error).toBeDefined()
  const created = await invoke(client, RPC_CHANNELS.nativeData.MUTATE, {
    workspaceId: f.workspaceId,
    kind: 'notes', nativeId: 'note-a', operationId: 'op-create-note-a', expectedRevision: null, schemaVersion: 1,
    changes: [{ path: 'notes/note-a.md', content: 'before revoke' }],
  })
  expect(created.error).toBeUndefined()
  f.authority.revokeWorkspaceGrant(f.admin.credential, f.issued.principal.subject, f.workspaceId)
  const denied = await invoke(client, RPC_CHANNELS.nativeData.MUTATE, {
    workspaceId: f.workspaceId,
    kind: 'notes', nativeId: 'note-a', operationId: 'op-after-revoke', expectedRevision: 1, schemaVersion: 1,
    changes: [{ path: 'notes/note-a.md', content: 'after revoke' }],
  })
  expect(denied.error).toBeDefined()
  expect(f.authority.authorize(f.issued.principal, f.workspaceId, 'read')).toBe(false)
})
test('native data context returns the authenticated principal and read fence only for a registered readable workspace', async () => {
  const f = await fixture()
  const client = await connect(f.url, f.issued.credential)
  const context = await invoke(client, RPC_CHANNELS.nativeData.GET_CONTEXT, { workspaceId: f.workspaceId })
  expect(context.error).toBeUndefined()
  expect(context.result).toEqual({
    issuer: f.issued.principal.issuer,
    subject: f.issued.principal.subject,
    workspaceId: f.workspaceId,
    permissionFence: f.authority.permissionFence(f.authority.authenticate(f.issued.credential)!, f.workspaceId, 'read'),
  })
  expect(JSON.stringify(context.result)).not.toContain(f.root)
  const mismatch = await invoke(client, RPC_CHANNELS.nativeData.GET_CONTEXT, { workspaceId: 'workspace-other' })
  expect(mismatch.error).toBeDefined()
  f.authority.revokeWorkspaceGrant(f.admin.credential, f.issued.principal.subject, f.workspaceId)
  const revoked = await invoke(client, RPC_CHANNELS.nativeData.GET_CONTEXT, { workspaceId: f.workspaceId })
  expect(revoked.error).toBeDefined()
})

test('native Notes move commits one atomic path change while preserving entity identity and revision', async () => {
  const f = await fixture(true)
  const client = await connect(f.url, f.issued.credential)
  const created = await invoke(client, RPC_CHANNELS.notes.CREATE, f.workspaceId, 'Movable note', undefined, {
    operationId: 'note-create-move',
    expectedRevision: null,
    schemaVersion: 1,
  })
  expect(created.error).toBeUndefined()
  if (!created.result || typeof created.result !== 'object' || !('id' in created.result) || typeof created.result.id !== 'string') {
    throw new Error('native note create did not return a NotesDocument identity')
  }
  const originalId = created.result.id
  const moved = await invoke(client, RPC_CHANNELS.notes.MOVE, f.workspaceId, originalId, 'folder-a', {
    operationId: 'note-move-atomic',
    expectedRevision: 1,
    schemaVersion: 1,
  })
  expect(moved.error).toBeUndefined()
  expect(moved.result).toMatchObject({ note: { id: 'folder-a/Movable note', nativeRevision: 2, content: expect.stringContaining('title: Movable note') } })
  const page = await invoke(client, RPC_CHANNELS.nativeData.PULL_CHANGES, { workspaceId: f.workspaceId, afterSequence: 0, limit: 10 })
  expect(page.result).toMatchObject({
    changes: [
      { operationId: 'note-create-move', nativeId: originalId, revision: 1 },
      { operationId: 'note-move-atomic', nativeId: originalId, revision: 2 },
    ],
    entities: [{ nativeId: originalId, revision: 2, files: [{ path: 'notes/folder-a/Movable note.md', content: expect.stringContaining('title: Movable note') }] }],
  })
  const reread = await invoke(client, RPC_CHANNELS.notes.READ, f.workspaceId, 'folder-a/Movable note')
  expect(reread.result).toMatchObject({ id: 'folder-a/Movable note', nativeRevision: 2 })
})
