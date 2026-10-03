import { afterEach, expect, test } from 'bun:test'
import { once } from 'node:events'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import WebSocket from 'ws'
import { NativeAuthority, type NativeIssuedCredential } from '../../../authority/native-authority.ts'
import { NativeJournal } from '../../../authority/native-journal.ts'
import { CollaborationSyncService } from '../../../collaboration/sync-service.ts'
import { WsRpcServer } from '../../../transport/server.ts'
import { PROTOCOL_VERSION, RPC_CHANNELS, type MessageEnvelope } from '@craft-agent/shared/protocol'
import { deserializeEnvelope } from '../../../transport/codec.ts'
import { registerNativeDataHandlers } from '../native-data.ts'
import { registerNotesHandlers } from '../notes.ts'
import type { HandlerDeps } from '../../handler-deps.ts'

const cleanups: Array<() => void> = []
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup() })
interface TestConnection {
  socket: WebSocket
  messages: MessageEnvelope[]
}

async function fixture(withNotes = false, legacy = false) {
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
    host: '127.0.0.1', port: 0, requireAuth: true, nativeAuthority: legacy ? undefined : authority,
    validateToken: async token => token === 'legacy-test-token',
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


test('canonical native creation plan has no file/journal writes, matches CREATE bytes and denies read-only/foreign/revoked principals', async () => {
  const f = await fixture(true)
  const writer = await connect(f.url, f.issued.credential)
  const first = await invoke(writer, RPC_CHANNELS.notes.PREPARE_CREATE, f.workspaceId, 'Canonical: title', 'nested')
  expect(first.type).toBe('response')
  const plan = first.result as { context: { issuer: string; subject: string; workspaceId: string; permissionFence: string }; writePermissionFence: string; mutation: { nativeId: string; expectedRevision: null; schemaVersion: 1; changes: Array<{ path: string; content: string }> } }
  expect(plan.context).toMatchObject({ issuer: f.issued.principal.issuer, subject: f.issued.principal.subject, workspaceId: f.workspaceId })
  expect(plan.context.permissionFence).toMatch(/^[a-f0-9]{64}$/)
  expect(plan.writePermissionFence).toMatch(/^[a-f0-9]{64}$/)
  expect(plan.mutation).toMatchObject({ expectedRevision: null, schemaVersion: 1 })
  expect(plan.mutation.changes).toHaveLength(1)
  expect(plan.mutation.changes[0]!.path).toBe(`notes/${plan.mutation.nativeId}.md`)
  expect(existsSync(join(f.root, 'notes'))).toBe(false)
  const empty = await invoke(writer, RPC_CHANNELS.nativeData.PULL_CHANGES, { workspaceId: f.workspaceId, afterSequence: 0 })
  expect((empty.result as { changes: unknown[] }).changes).toEqual([])
  const repeat = await invoke(writer, RPC_CHANNELS.notes.PREPARE_CREATE, f.workspaceId, 'Canonical: title', 'nested')
  expect(repeat.result).toEqual(plan)
  const created = await invoke(writer, RPC_CHANNELS.notes.CREATE, f.workspaceId, 'Canonical: title', 'nested', { operationId: 'canonical-existing-create', expectedRevision: null, schemaVersion: 1 })
  expect(created.type).toBe('response')
  expect(readFileSync(join(f.root, plan.mutation.changes[0]!.path), 'utf8')).toBe(plan.mutation.changes[0]!.content)
  expect(await invoke(writer, RPC_CHANNELS.notes.PREPARE_CREATE, 'workspace-other', 'Denied')).toHaveProperty('error')
  expect(await invoke(writer, RPC_CHANNELS.notes.PREPARE_CREATE, f.workspaceId, 'Denied', '../outside')).toHaveProperty('error')
  const issued = f.authority.redeemEnrollment(f.authority.issueEnrollment(f.admin.credential, 'reader', Date.now() + 60_000), 'reader')!
  f.authority.grantWorkspace(f.admin.credential, issued.principal.subject, f.workspaceId, ['read'])
  const reader = await connect(f.url, issued.credential)
  expect(await invoke(reader, RPC_CHANNELS.notes.PREPARE_CREATE, f.workspaceId, 'Denied')).toHaveProperty('error')
  f.authority.revokeWorkspaceGrant(f.admin.credential, f.issued.principal.subject, f.workspaceId)
  expect(await invoke(writer, RPC_CHANNELS.notes.PREPARE_CREATE, f.workspaceId, 'Denied')).toHaveProperty('error')
  expect(existsSync(join(f.root, 'notes', 'Denied.md'))).toBe(false)
})

test('legacy authenticated transport gets explicit non-native plan without authoring or native identity', async () => {
  const f = await fixture(true, true)
  const legacy = await connect(f.url, 'legacy-test-token')
  expect(await invoke(legacy, RPC_CHANNELS.notes.PREPARE_CREATE, f.workspaceId, 'Legacy title')).toMatchObject({ type: 'response', result: null })
  expect(existsSync(join(f.root, 'notes'))).toBe(false)
})
