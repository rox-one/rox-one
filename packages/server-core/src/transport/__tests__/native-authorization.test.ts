import { afterEach, expect, test } from 'bun:test'
import { once } from 'node:events'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import WebSocket from 'ws'
import { PROTOCOL_VERSION, type MessageEnvelope } from '@rox/shared/protocol'
import { NativeAuthority, type NativeIssuedCredential } from '../../authority/native-authority'
import { WsRpcServer } from '../server'
import { WsRpcClient } from '../client'
import { deserializeEnvelope } from '../codec'
import { CliRpcClient } from '../../../../../apps/cli/src/client'

interface TestConnection {
  ws: WebSocket
  ack: MessageEnvelope
  messages: MessageEnvelope[]
}

const cleanups: Array<() => void> = []
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup() })

async function fixture(registerWorkspace = true) {
  const dir = mkdtempSync(join(tmpdir(), 'native-rpc-'))
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
  if (registerWorkspace) authority.registerWorkspace(admin.credential, 'workspace-a', root)
  const first = authority.redeemEnrollment(authority.issueEnrollment(admin.credential, 'first', Date.now() + 60_000), 'first')!
  const second = authority.redeemEnrollment(authority.issueEnrollment(admin.credential, 'second', Date.now() + 60_000), 'second')!
  if (registerWorkspace) {
    authority.grantWorkspace(admin.credential, first.principal.subject, 'workspace-a', ['read', 'write', 'subscribe'])
    authority.grantWorkspace(admin.credential, second.principal.subject, 'workspace-a', ['read', 'subscribe'])
  }
  const server = new WsRpcServer({
    port: 0, requireAuth: true, nativeAuthority: authority,
    validateToken: async () => true, validateSessionCookie: async () => true,
    nativeEventChannels: new Set(['native:receipt']),
  })
  cleanups.push(() => server.close())
  server.handle('native:read', () => readFileSync(join(root, 'note.md'), 'utf8'), { nativeAction: 'read' })
  server.handle('native:write', () => { writeFileSync(join(root, 'note.md'), 'changed'); return 'committed' }, { nativeAction: 'write' })
  server.handle('legacy:write', () => { writeFileSync(join(root, 'note.md'), 'leaked'); return 'leaked' })
  await server.listen()
  return { authority, admin, first, second, server, root, url: `ws://127.0.0.1:${server.port}` }
}

async function connect(url: string, token: string, extra: Record<string, unknown> = {}) {
  const ws = new WebSocket(url, { headers: { Cookie: 'legacy=valid' } })
  cleanups.push(() => ws.terminate())
  const messages: MessageEnvelope[] = []
  ws.on('message', data => messages.push(deserializeEnvelope(data.toString())))
  await once(ws, 'open')
  ws.send(JSON.stringify({ id: 'handshake', type: 'handshake', protocolVersion: PROTOCOL_VERSION, workspaceId: 'workspace-a', token, ...extra }))
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

// Removing channel/action gating must cause the denied write to modify the real file.
test('read-only enrolled client cannot invoke writes or unscoped legacy handlers', async () => {
  const f = await fixture()
  const reader = await connect(f.url, f.second.credential)
  expect(reader.ack.type).toBe('handshake_ack')
  expect((await request(reader, 'native:read')).result).toBe('original')
  expect((await request(reader, 'native:write')).error?.code).toBe('AUTH_FAILED')
  expect((await request(reader, 'legacy:write', ['workspace-a'])).error?.code).toBe('AUTH_FAILED')
  expect(readFileSync(join(f.root, 'note.md'), 'utf8')).toBe('original')
  const writer = await connect(f.url, f.first.credential)
  expect((await request(writer, 'native:write')).result).toBe('committed')
  expect((await request(reader, 'native:read')).result).toBe('changed')
})

test('legacy mode admits existing Notes-style handlers only before native workspace registration', async () => {
  const f = await fixture(false)
  const legacy = await connect(f.url, 'legacy-global')
  expect(legacy.ack.type).toBe('handshake_ack')
  expect((await request(legacy, 'native:read')).result).toBe('original')
  f.authority.registerWorkspace(f.admin.credential, 'workspace-a', f.root)
  expect((await request(legacy, 'native:read')).error?.code).toBe('AUTH_FAILED')
  expect((await request(legacy, 'native:write')).error?.code).toBe('AUTH_FAILED')
  expect(readFileSync(join(f.root, 'note.md'), 'utf8')).toBe('original')
})

// Removing native-prefix reservation would let permissive legacy validators accept these.
test('invalid native credentials and enrollment tickets cannot fall back to cookie or global bearer', async () => {
  const f = await fixture()
  const ticket = f.authority.issueEnrollment(f.admin.credential, 'unredeemed', Date.now() + 60_000)
  for (const token of ['na_invalid', 'ne_invalid', ticket, 'legacy-global']) {
    const connection = await connect(f.url, token)
    expect(connection.ack.error?.code).toBe('AUTH_FAILED')
  }
  const unscoped = await connect(f.url, 'legacy-global', { workspaceId: null })
  expect(unscoped.ack.type).toBe('handshake_ack')
  expect((await request(unscoped, 'legacy:write', ['workspace-a'])).error?.code).toBe('AUTH_FAILED')
  expect(readFileSync(join(f.root, 'note.md'), 'utf8')).toBe('original')
})

// Removing the live DB check would let an already-connected device keep writing after revoke.
test('revocation denies an active writer and subsequent subscription events', async () => {
  const f = await fixture()
  const writer = await connect(f.url, f.first.credential)
  f.server.push('native:receipt', { to: 'workspace', workspaceId: 'workspace-a' }, { revision: 1 })
  await waitMessage(writer.ws, writer.messages, message => message.type === 'event')
  f.authority.revokeWorkspaceGrant(f.admin.credential, f.first.principal.subject, 'workspace-a')
  f.server.push('native:receipt', { to: 'workspace', workspaceId: 'workspace-a' }, { revision: 2 })
  expect((await request(writer, 'native:write')).error?.code).toBe('AUTH_FAILED')
  expect(writer.messages.filter(message => message.type === 'event').map(message => message.args)).toEqual([[{ revision: 1 }]])
  expect(readFileSync(join(f.root, 'note.md'), 'utf8')).toBe('original')
})

for (const outcome of ['success', 'error'] as const) {
  test(`revocation and regrant during a request cannot disclose its ${outcome} payload`, async () => {
    const f = await fixture()
    const entered = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    f.server.handle('native:delayed-read', async () => {
      entered.resolve()
      await release.promise
      if (outcome === 'error') throw new Error('private-search-metadata')
      return 'private-search-body'
    }, { nativeAction: 'read' })
    const reader = await connect(f.url, f.first.credential)
    const pending = request(reader, 'native:delayed-read')
    await entered.promise
    f.authority.revokeWorkspaceGrant(f.admin.credential, f.first.principal.subject, 'workspace-a')
    f.authority.grantWorkspace(f.admin.credential, f.first.principal.subject, 'workspace-a', ['read'])
    release.resolve()
    const response = await pending
    expect(response.error?.code).toBe('AUTH_FAILED')
    expect(response.result).toBeUndefined()
    expect(JSON.stringify(response)).not.toContain('private-search-')
    expect((await request(reader, 'native:read')).result).toBe('original')
  })
}

test('losing read access blocks pushes even if subscribe remains granted', async () => {
  const f = await fixture()
  const writer = await connect(f.url, f.first.credential)
  f.authority.revokeWorkspaceGrant(f.admin.credential, f.first.principal.subject, 'workspace-a')
  f.authority.grantWorkspace(f.admin.credential, f.first.principal.subject, 'workspace-a', ['subscribe'])
  f.server.push('native:receipt', { to: 'workspace', workspaceId: 'workspace-a' }, { revision: 5 })
  expect((await request(writer, 'native:read')).error?.code).toBe('AUTH_FAILED')
  expect(writer.messages.filter(message => message.type === 'event')).toEqual([])
})

test('losing read access invalidates an active connection for writes', async () => {
  const f = await fixture()
  const writer = await connect(f.url, f.first.credential)
  f.authority.revokeWorkspaceGrant(f.admin.credential, f.first.principal.subject, 'workspace-a')
  f.authority.grantWorkspace(f.admin.credential, f.first.principal.subject, 'workspace-a', ['write'])
  expect((await request(writer, 'native:write')).error?.code).toBe('AUTH_FAILED')
  expect(readFileSync(join(f.root, 'note.md'), 'utf8')).toBe('original')
})

// Removing reconnect credential identity checks would disclose the first device's buffered event.
test('a different enrolled device cannot resume another device buffer', async () => {
  const f = await fixture()
  const first = await connect(f.url, f.first.credential)
  const closed = once(first.ws, 'close')
  first.ws.close()
  await closed
  f.server.push('native:receipt', { to: 'workspace', workspaceId: 'workspace-a' }, { revision: 3 })
  const second = await connect(f.url, f.second.credential, { reconnectClientId: first.ack.clientId, lastSeq: 0 })
  expect(second.ack.clientId).not.toBe(first.ack.clientId)
  await request(second, 'native:read')
  expect(second.messages.filter(message => message.type === 'event')).toEqual([])
})

// Removing permission-fence replay checks would replay a pre-revocation event after regrant.
test('regrant does not replay events retained under a previous subscription fence', async () => {
  const f = await fixture()
  const first = await connect(f.url, f.first.credential)
  const closed = once(first.ws, 'close')
  first.ws.close()
  await closed
  f.server.push('native:receipt', { to: 'workspace', workspaceId: 'workspace-a' }, { revision: 4 })
  f.authority.revokeWorkspaceGrant(f.admin.credential, f.first.principal.subject, 'workspace-a')
  f.authority.grantWorkspace(f.admin.credential, f.first.principal.subject, 'workspace-a', ['read', 'write', 'subscribe'])
  const renewed = await connect(f.url, f.first.credential, { reconnectClientId: first.ack.clientId, lastSeq: 0 })
  await request(renewed, 'native:read')
  expect(renewed.messages.filter(message => message.type === 'event')).toEqual([])
  expect(renewed.ack.stale).toBe(true)
})

// Removing the pre-socket confidentiality check would attempt to send a secret to a plaintext remote.
test('native client refuses plaintext remote before connecting', async () => {
  const client = new WsRpcClient('ws://192.0.2.1:9', { token: 'na_confidential', autoReconnect: false })
  cleanups.push(() => client.destroy())
  client.connect()
  await expect(client.invoke('native:read')).rejects.toMatchObject({ code: 'TLS_REQUIRED' })
})

test('independent CLI client refuses plaintext native credentials before connecting', async () => {
  const client = new CliRpcClient('ws://192.0.2.1:9', { token: 'na_test-secret', connectTimeout: 100 })
  cleanups.push(() => client.destroy())
  await expect(client.connect()).rejects.toMatchObject({ code: 'TLS_REQUIRED' })
})
