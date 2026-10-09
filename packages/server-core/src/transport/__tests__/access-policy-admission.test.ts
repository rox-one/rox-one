/**
 * WS-admission tests for the fail-closed access-policy plugin gate
 * (port-matrix row a1.6, fail-closed half).
 *
 * A role that NAMES an access-policy plugin used to be silently admitted
 * WITHOUT it. These tests pin the closed behaviour: an unregistered name, a
 * registered deny, and a throwing authorizer all refuse with the SAME typed
 * OPERATOR_ACCESS_DENIED; a registered allow admits; a role without the field
 * is unchanged.
 */
import { afterEach, expect, test } from 'bun:test'
import { once } from 'node:events'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import WebSocket from 'ws'
import { PROTOCOL_VERSION, type MessageEnvelope } from '@rox/shared/protocol'
import { NativeAuthority, type NativeIssuedCredential } from '../../authority/native-authority'
import {
  registerAccessPolicyPlugin,
  resetAccessPolicyPlugins,
} from '../../authority/access-policy-registry'
import { WsRpcServer } from '../server'
import { deserializeEnvelope } from '../codec'

interface TestConnection {
  ws: WebSocket
  ack: MessageEnvelope
  messages: MessageEnvelope[]
}

const cleanups: Array<() => void> = []
afterEach(() => {
  resetAccessPolicyPlugins()
  for (const cleanup of cleanups.splice(0).reverse()) cleanup()
})

async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'access-policy-rpc-'))
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

// The role's scopes are wide enough for both methods; only the named plugin
// decides admission. The workspace grant is unchanged in every case.
const POLICY_ROLE = { scopes: ['operator.read', 'operator.write'] }

test('a role naming an UNREGISTERED plugin is refused fail-closed', async () => {
  const f = await fixture()
  f.authority.defineOperatorRole(f.admin.credential, 'policy-role', { ...POLICY_ROLE, accessPolicyPlugin: 'ghost-plugin' })
  f.authority.assignOperatorRole(f.admin.credential, f.second.principal.subject, 'policy-role')
  const connection = await connect(f.url, f.second.credential)
  // Even the reachable channel set is empty: nothing may be advertised.
  expect(connection.ack.registeredChannels).toEqual([])
  const denied = await request(connection, 'native:read')
  expect(denied.error?.code).toBe('OPERATOR_ACCESS_DENIED')
  expect(denied.error?.message).toBe('Operator role cannot invoke this method')
  expect(denied.result).toBeUndefined()
})

test('a registered plugin that denies refuses the request', async () => {
  const f = await fixture()
  registerAccessPolicyPlugin('deny-all', { authorize: () => false })
  f.authority.defineOperatorRole(f.admin.credential, 'policy-role', { ...POLICY_ROLE, accessPolicyPlugin: 'deny-all' })
  f.authority.assignOperatorRole(f.admin.credential, f.second.principal.subject, 'policy-role')
  const connection = await connect(f.url, f.second.credential)
  const denied = await request(connection, 'native:write')
  expect(denied.error?.code).toBe('OPERATOR_ACCESS_DENIED')
  expect(denied.result).toBeUndefined()
  expect(readFileSync(join(f.root, 'note.md'), 'utf8')).toBe('original')
})

test('a registered plugin that approves admits the request', async () => {
  const f = await fixture()
  const seen: string[] = []
  registerAccessPolicyPlugin('allow-all', {
    authorize: (request) => { seen.push(request.channel); return true },
  })
  f.authority.defineOperatorRole(f.admin.credential, 'policy-role', { ...POLICY_ROLE, accessPolicyPlugin: 'allow-all' })
  f.authority.assignOperatorRole(f.admin.credential, f.second.principal.subject, 'policy-role')
  const connection = await connect(f.url, f.second.credential)
  expect((await request(connection, 'native:read')).result).toBe('original')
  expect((await request(connection, 'native:write')).result).toBe('committed')
  expect(seen).toContain('native:read')
  expect(readFileSync(join(f.root, 'note.md'), 'utf8')).toBe('changed')
})

test('an async authorizer is awaited', async () => {
  const f = await fixture()
  registerAccessPolicyPlugin('async-allow', { authorize: async () => true })
  f.authority.defineOperatorRole(f.admin.credential, 'policy-role', { ...POLICY_ROLE, accessPolicyPlugin: 'async-allow' })
  f.authority.assignOperatorRole(f.admin.credential, f.second.principal.subject, 'policy-role')
  const connection = await connect(f.url, f.second.credential)
  expect((await request(connection, 'native:read')).result).toBe('original')
})

test('a throwing authorizer fails closed', async () => {
  const f = await fixture()
  registerAccessPolicyPlugin('throwing', { authorize: () => { throw new Error('boom') } })
  f.authority.defineOperatorRole(f.admin.credential, 'policy-role', { ...POLICY_ROLE, accessPolicyPlugin: 'throwing' })
  f.authority.assignOperatorRole(f.admin.credential, f.second.principal.subject, 'policy-role')
  const connection = await connect(f.url, f.second.credential)
  const denied = await request(connection, 'native:read')
  expect(denied.error?.code).toBe('OPERATOR_ACCESS_DENIED')
  expect(denied.result).toBeUndefined()
})

test('a role WITHOUT the field is unchanged', async () => {
  const f = await fixture()
  registerAccessPolicyPlugin('deny-all', { authorize: () => false })
  f.authority.defineOperatorRole(f.admin.credential, 'plain-role', POLICY_ROLE)
  f.authority.assignOperatorRole(f.admin.credential, f.second.principal.subject, 'plain-role')
  const connection = await connect(f.url, f.second.credential)
  expect(connection.ack.registeredChannels).toContain('native:write')
  expect((await request(connection, 'native:read')).result).toBe('original')
  expect((await request(connection, 'native:write')).result).toBe('committed')
  expect(readFileSync(join(f.root, 'note.md'), 'utf8')).toBe('changed')
})

test('the plugin gate is uniform: a scope denial and a plugin denial are indistinguishable', async () => {
  const f = await fixture()
  registerAccessPolicyPlugin('deny-all', { authorize: () => false })
  f.authority.defineOperatorRole(f.admin.credential, 'policy-role', { ...POLICY_ROLE, accessPolicyPlugin: 'deny-all' })
  f.authority.defineOperatorRole(f.admin.credential, 'scope-blocked', { scopes: [] })
  f.authority.assignOperatorRole(f.admin.credential, f.first.principal.subject, 'policy-role')
  f.authority.assignOperatorRole(f.admin.credential, f.second.principal.subject, 'scope-blocked')
  const pluginDenied = await request(await connect(f.url, f.first.credential), 'native:read')
  const scopeDenied = await request(await connect(f.url, f.second.credential), 'native:read')
  expect(pluginDenied.error?.code).toBe('OPERATOR_ACCESS_DENIED')
  expect(pluginDenied.error).toEqual(scopeDenied.error)
  expect(pluginDenied.channel).toBe(scopeDenied.channel)
})