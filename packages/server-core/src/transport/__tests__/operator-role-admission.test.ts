import { afterEach, expect, test } from 'bun:test'
import { once } from 'node:events'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import WebSocket from 'ws'
import { PROTOCOL_VERSION, type MessageEnvelope } from '@rox/shared/protocol'
import { NativeAuthority, type NativeIssuedCredential } from '../../authority/native-authority'
import { WsRpcServer } from '../server'
import { deserializeEnvelope } from '../codec'

interface TestConnection {
  ws: WebSocket
  ack: MessageEnvelope
  messages: MessageEnvelope[]
}

const cleanups: Array<() => void> = []
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup() })

async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'operator-role-rpc-'))
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
  const authority = new NativeAuthority({ stateDir: join(dir, 'authority') })
  cleanups.push(() => authority.close())
  const tty = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY')
  let admin: NativeIssuedCredential
  try {
    Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: true })
    admin = authority.bootstrapLocalAdministrator('test owner')
  } finally {
    if (tty) Object.defineProperty(process.stdin, 'isTTY', tty)
    else Reflect.deleteProperty(process.stdin, 'isTTY')
  }
  const root = join(dir, 'workspace')
  mkdirSync(root)
  writeFileSync(join(root, 'note.md'), 'original')
  authority.registerWorkspace(admin.credential, 'workspace-a', root)
  const first = authority.redeemEnrollment(authority.issueEnrollment(admin.credential, 'first', Date.now() + 60_000), 'first')!
  const second = authority.redeemEnrollment(authority.issueEnrollment(admin.credential, 'second', Date.now() + 60_000), 'second')!
  authority.grantWorkspace(admin.credential, first.principal.subject, 'workspace-a', ['read', 'write', 'subscribe'])
  authority.grantWorkspace(admin.credential, second.principal.subject, 'workspace-a', ['read', 'write', 'subscribe'])
  const server = new WsRpcServer({ port: 0, requireAuth: true, nativeAuthority: authority })
  cleanups.push(() => server.close())
  server.handle('native:read', () => readFileSync(join(root, 'note.md'), 'utf8'), { nativeAction: 'read' })
  server.handle('native:write', () => { writeFileSync(join(root, 'note.md'), 'changed'); return 'committed' }, { nativeAction: 'write' })
  server.handle('sessions:create', () => 'session-created', { nativeAction: 'write' })
  server.handle('system:versions', () => ({ node: process.version }), { nativeAction: 'read' })
  await server.listen()
  return { authority, admin, first, second, server, root, url: `ws://127.0.0.1:${server.port}` }
}

async function connect(url: string, token: string) {
  const ws = new WebSocket(url)
  cleanups.push(() => ws.terminate())
  const messages: MessageEnvelope[] = []
  ws.on('message', data => messages.push(deserializeEnvelope(data.toString())))
  await once(ws, 'open')
  ws.send(JSON.stringify({ id: 'handshake', type: 'handshake', protocolVersion: PROTOCOL_VERSION, workspaceId: 'workspace-a', token }))
  const ack = await waitMessage(ws, messages, message => message.id === 'handshake')
  return { ws, ack, messages }
}

function waitMessage(ws: WebSocket, messages: MessageEnvelope[], matches: (message: MessageEnvelope) => boolean) {
  const existing = messages.find(matches)
  if (existing) return Promise.resolve(existing)
  const { promise, resolve } = Promise.withResolvers<MessageEnvelope>()
  const listener = (data: WebSocket.RawData) => {
    const message = deserializeEnvelope(data.toString())
    if (!matches(message)) return
    ws.off('message', listener)
    resolve(message)
  }
  ws.on('message', listener)
  return promise
}

async function request(connection: TestConnection, channel: string, args: unknown[] = []) {
  const id = crypto.randomUUID()
  connection.ws.send(JSON.stringify({ id, type: 'request', channel, args }))
  return waitMessage(connection.ws, connection.messages, message => message.id === id)
}

const OWNER_ROLE = { scopes: ['operator.read', 'operator.sessions.read', 'operator.sessions.write', 'operator.write', 'operator.admin', 'operator.pairing', 'operator.approvals', 'operator.questions', 'operator.talk', 'operator.talk.secrets'] }

// The ceiling decides admission per channel, not the workspace grant: both
// members keep their read+write grants in every case below.
test('a restricted role is refused outside its ceiling while an owner role succeeds', async () => {
  const f = await fixture()
  f.authority.defineOperatorRole(f.admin.credential, 'owner', OWNER_ROLE)
  f.authority.defineOperatorRole(f.admin.credential, 'viewer', { scopes: ['operator.read', 'operator.sessions.read'] })
  f.authority.assignOperatorRole(f.admin.credential, f.first.principal.subject, 'owner')
  f.authority.assignOperatorRole(f.admin.credential, f.second.principal.subject, 'viewer')

  const owner = await connect(f.url, f.first.credential)
  const viewer = await connect(f.url, f.second.credential)
  expect(owner.ack.registeredChannels).toContain('native:write')
  expect(viewer.ack.registeredChannels).toContain('native:read')
  expect(viewer.ack.registeredChannels).not.toContain('native:write')

  expect((await request(owner, 'native:read')).result).toBe('original')
  expect((await request(owner, 'native:write')).result).toBe('committed')
  expect((await request(viewer, 'native:read')).result).toBe('changed')
  const denied = await request(viewer, 'native:write')
  expect(denied.error?.code).toBe('OPERATOR_ACCESS_DENIED')
  expect(denied.result).toBeUndefined()
  expect(readFileSync(join(f.root, 'note.md'), 'utf8')).toBe('changed')
})

test('a session-scoped role may mutate sessions but not general methods', async () => {
  const f = await fixture()
  f.authority.defineOperatorRole(f.admin.credential, 'session-agent', { scopes: ['operator.sessions.read', 'operator.sessions.write'] })
  f.authority.assignOperatorRole(f.admin.credential, f.second.principal.subject, 'session-agent')
  const connection = await connect(f.url, f.second.credential)
  expect((await request(connection, 'sessions:create')).result).toBe('session-created')
  expect((await request(connection, 'native:write')).error?.code).toBe('OPERATOR_ACCESS_DENIED')
  expect(readFileSync(join(f.root, 'note.md'), 'utf8')).toBe('original')
})

test('removing an assigned role denies the live connection (missing role fails closed)', async () => {
  const f = await fixture()
  f.authority.defineOperatorRole(f.admin.credential, 'temp', { scopes: ['operator.read'] })
  f.authority.assignOperatorRole(f.admin.credential, f.second.principal.subject, 'temp')
  const connection = await connect(f.url, f.second.credential)
  expect((await request(connection, 'native:read')).result).toBe('original')
  f.authority.removeOperatorRole(f.admin.credential, 'temp')
  const denied = await request(connection, 'native:read')
  expect(denied.error?.code).toBe('OPERATOR_ACCESS_DENIED')
  expect(denied.result).toBeUndefined()
})

test('an empty ceiling denies every method', async () => {
  const f = await fixture()
  f.authority.defineOperatorRole(f.admin.credential, 'blocked', { scopes: [] })
  f.authority.assignOperatorRole(f.admin.credential, f.second.principal.subject, 'blocked')
  const connection = await connect(f.url, f.second.credential)
  expect((await request(connection, 'native:read')).error?.code).toBe('OPERATOR_ACCESS_DENIED')
  expect((await request(connection, 'native:write')).error?.code).toBe('OPERATOR_ACCESS_DENIED')
  expect(readFileSync(join(f.root, 'note.md'), 'utf8')).toBe('original')
})

test('unassigned members are denied once roles are configured', async () => {
  const f = await fixture()
  f.authority.defineOperatorRole(f.admin.credential, 'viewer', { scopes: ['operator.read'] })
  f.authority.assignOperatorRole(f.admin.credential, f.first.principal.subject, 'viewer')
  const connection = await connect(f.url, f.second.credential)
  expect((await request(connection, 'native:read')).error?.code).toBe('OPERATOR_ACCESS_DENIED')
})

test('a default role applies when the member has no assignment', async () => {
  const f = await fixture()
  f.authority.defineOperatorRole(f.admin.credential, 'reader', { scopes: ['operator.read'] })
  f.authority.setDefaultOperatorRole(f.admin.credential, 'reader')
  const connection = await connect(f.url, f.second.credential)
  expect((await request(connection, 'native:read')).result).toBe('original')
  expect((await request(connection, 'native:write')).error?.code).toBe('OPERATOR_ACCESS_DENIED')
})

test('a LOCAL_ONLY channel is never remotely reachable by any role', async () => {
  const f = await fixture()
  f.authority.defineOperatorRole(f.admin.credential, 'owner', OWNER_ROLE)
  f.authority.assignOperatorRole(f.admin.credential, f.first.principal.subject, 'owner')
  const connection = await connect(f.url, f.first.credential)
  expect(connection.ack.registeredChannels).not.toContain('system:versions')
  const denied = await request(connection, 'system:versions')
  expect(denied.error?.code).toBe('LOCAL_ONLY_DENIED')
  expect(denied.result).toBeUndefined()
})

// Regression: with no named roles configured the existing grant-based
// authority is unchanged, so a granted writer keeps writing.
test('existing operator capabilities are unchanged without configured roles', async () => {
  const f = await fixture()
  const connection = await connect(f.url, f.second.credential)
  expect((await request(connection, 'native:read')).result).toBe('original')
  expect((await request(connection, 'native:write')).result).toBe('committed')
  expect(readFileSync(join(f.root, 'note.md'), 'utf8')).toBe('changed')
})