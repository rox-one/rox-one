import { afterEach, expect, test } from 'bun:test'
import { once } from 'node:events'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import WebSocket from 'ws'
import { NativeAuthority, type NativeIssuedCredential } from '../../authority/native-authority.ts'
import { PROTOCOL_VERSION, CodedError, type MessageEnvelope } from '@rox/shared/protocol'
import { WsRpcServer } from '../server.ts'
import { deserializeEnvelope } from '../codec.ts'
import type { WorkspaceAuthoritySession } from '../types.ts'

const cleanups: Array<() => Promise<void> | void> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })

async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'before-response-native-'))
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
  const authority = new NativeAuthority({ stateDir: join(dir, 'authority') })
  cleanups.push(() => authority.close())
  const tty = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY')
  let admin: NativeIssuedCredential
  try { Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: true }); admin = authority.bootstrapLocalAdministrator('boundary owner') }
  finally { if (tty) Object.defineProperty(process.stdin, 'isTTY', tty); else Reflect.deleteProperty(process.stdin, 'isTTY') }
  const root = join(dir, 'workspace')
  mkdirSync(root)
  const path = join(root, 'private.md')
  writeFileSync(path, 'private guarded source bytes')
  authority.registerWorkspace(admin.credential, 'guard-workspace', root)
  const issued = authority.redeemEnrollment(authority.issueEnrollment(admin.credential, 'guard reader', Date.now() + 60_000), 'guard reader')!
  authority.grantWorkspace(admin.credential, issued.principal.subject, 'guard-workspace', ['read'])
  const server = new WsRpcServer({ host: '127.0.0.1', port: 0, requireAuth: true, nativeAuthority: authority })
  cleanups.push(() => server.close())
  const entered = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  let guardCalls = 0
  let serializations = 0
  server.handle('native:guarded-read', () => ({
    toJSON() { serializations += 1; return { content: readFileSync(path, 'utf8') } },
  }), { nativeAction: 'read', beforeResponse: async (context, args, result) => {
    expect(context.principal?.subject).toBe(issued.principal.subject)
    expect(context.actor).toBeUndefined()
    expect(context.workspaceId).toBe('guard-workspace')
    expect(args).toEqual(['request-bound-scope'])
    expect(result).toHaveProperty('toJSON')
    guardCalls += 1
    entered.resolve()
    await release.promise
  } })
  server.handle('native:fresh-read', () => readFileSync(path, 'utf8'), { nativeAction: 'read' })
  await server.listen()
  const socket = new WebSocket(`ws://127.0.0.1:${server.port}`)
  cleanups.push(() => socket.terminate())
  await once(socket, 'open')
  function message(id: string): Promise<MessageEnvelope> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { socket.off('message', listener); reject(new Error('Fixture response timeout')) }, 5000)
      const listener = (raw: WebSocket.RawData) => {
        const value = deserializeEnvelope(raw.toString())
        if (value.id !== id) return
        clearTimeout(timer); socket.off('message', listener); resolve(value)
      }
      socket.on('message', listener)
    })
  }
  const handshake = message('bound-handshake')
  socket.send(JSON.stringify({ id: 'bound-handshake', type: 'handshake', protocolVersion: PROTOCOL_VERSION,
    workspaceId: 'guard-workspace', token: issued.credential }))
  expect((await handshake).type).toBe('handshake_ack')
  function request(channel: string, ...args: unknown[]) {
    const id = crypto.randomUUID()
    const response = message(id)
    socket.send(JSON.stringify({ id, type: 'request', channel, args }))
    return response
  }
  return { authority, admin, issued, entered, release, request,
    guardCalls: () => guardCalls, serializations: () => serializations }
}

test('native response Resource guard runs with verified principal and preserves authorized result after its await', async () => {
  const f = await fixture()
  const pending = f.request('native:guarded-read', 'request-bound-scope')
  await f.entered.promise
  expect(f.guardCalls()).toBe(1)
  expect(f.serializations()).toBe(0)
  f.release.resolve()
  const response = await pending
  expect(response.error).toBeUndefined()
  expect(response.result).toEqual({ content: 'private guarded source bytes' })
  expect(f.serializations()).toBe(1)
})

test('native revoke and regrant during beforeResponse await retracts bytes before serialization and permits a fresh request', async () => {
  const f = await fixture()
  const pending = f.request('native:guarded-read', 'request-bound-scope')
  await f.entered.promise
  f.authority.revokeWorkspaceGrant(f.admin.credential, f.issued.principal.subject, 'guard-workspace')
  f.authority.grantWorkspace(f.admin.credential, f.issued.principal.subject, 'guard-workspace', ['read'])
  f.release.resolve()
  const response = await pending
  expect(response.error?.code).toBe('AUTH_FAILED')
  expect(response.result).toBeUndefined()
  expect(JSON.stringify(response)).not.toContain('private guarded source bytes')
  expect(f.guardCalls()).toBe(1)
  expect(f.serializations()).toBe(0)
  expect((await f.request('native:fresh-read')).result).toBe('private guarded source bytes')
})


// The authentication port is a trusted composition fixture here, not a claim
// of persisted PostgreSQL authentication. The real WS response ordering and
// Resource policy revocation are exercised independently of that prerequisite.
async function workspaceResourceFixture() {
  const workspaceId = '00000000-0000-4000-8000-000000000001'
  const expiresAt = Date.now() + 60_000
  const actor = { principalId: 'resource-reader', sessionId: 'resource-session', deviceId: 'resource-device', expiresAt,
    authenticatedWorkspaceIds: [workspaceId] }
  const session: WorkspaceAuthoritySession = { actor, identity: { issuer: 'resource-fixture', subject: 'resource-reader',
    principalId: actor.principalId, sessionId: actor.sessionId, deviceId: actor.deviceId, expiresAt } }
  let trackingRequest = false
  let arrivals = 0
  let canReadResource = true
  let guardCalls = 0
  let serializations = 0
  const thirdArrival = Promise.withResolvers<void>()
  const releaseThirdArrival = Promise.withResolvers<void>()
  cleanups.push(() => releaseThirdArrival.resolve())
  const server = new WsRpcServer({ host: '127.0.0.1', port: 0, requireAuth: true, workspaceAuthority: {
    authenticate: async () => session,
    revalidate: async bound => {
      if (trackingRequest && ++arrivals === 3) { thirdArrival.resolve(); await releaseThirdArrival.promise }
      return bound
    },
  } })
  cleanups.push(() => server.close())
  server.handle('domain.resource.guarded-read', () => ({
    toJSON() { serializations += 1; return { content: 'private Resource response bytes' } },
  }), { access: 'authenticatedWorkspace', beforeResponse: async context => {
    guardCalls += 1
    if (context.actor?.principalId !== actor.principalId || !canReadResource) throw new CodedError('FORBIDDEN', 'Resource read denied')
  } })
  await server.listen()
  const socket = new WebSocket(`ws://127.0.0.1:${server.port}`)
  cleanups.push(() => socket.terminate())
  await once(socket, 'open')
  function message(id: string): Promise<MessageEnvelope> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { socket.off('message', listener); reject(new Error('Resource fixture timeout')) }, 5000)
      const listener = (raw: WebSocket.RawData) => {
        const value = deserializeEnvelope(raw.toString())
        if (value.id !== id) return
        clearTimeout(timer); socket.off('message', listener); resolve(value)
      }
      socket.on('message', listener)
    })
  }
  const ack = message('resource-handshake')
  socket.send(JSON.stringify({ id: 'resource-handshake', type: 'handshake', protocolVersion: PROTOCOL_VERSION,
    workspaceId, token: 'fixture.header.signature' }))
  expect((await ack).type).toBe('handshake_ack')
  trackingRequest = true
  const id = crypto.randomUUID()
  const response = message(id)
  socket.send(JSON.stringify({ id, type: 'request', channel: 'domain.resource.guarded-read', args: [] }))
  return { thirdArrival, releaseThirdArrival, response, revokeResource: () => { canReadResource = false },
    guardCalls: () => guardCalls, serializations: () => serializations, arrivals: () => arrivals }
}

test('fresh WorkspaceActor revalidation precedes Resource guard and preserves an authorized response', async () => {
  const f = await workspaceResourceFixture()
  await f.thirdArrival.promise
  const guardsAtArrival = f.guardCalls()
  const serializationsAtArrival = f.serializations()
  f.releaseThirdArrival.resolve()
  const response = await f.response
  expect(guardsAtArrival).toBe(0)
  expect(serializationsAtArrival).toBe(0)
  expect(response.error).toBeUndefined()
  expect(response.result).toEqual({ content: 'private Resource response bytes' })
  expect(f.guardCalls()).toBe(1)
  expect(f.serializations()).toBe(1)
  expect(f.arrivals()).toBe(3)
})

test('Resource read revoke during third WorkspaceActor revalidation retracts private bytes before the final guard and serialization', async () => {
  const f = await workspaceResourceFixture()
  await f.thirdArrival.promise
  f.revokeResource()
  f.releaseThirdArrival.resolve()
  const response = await f.response
  expect(response.error?.code).toBe('FORBIDDEN')
  expect(response.result).toBeUndefined()
  expect(JSON.stringify(response)).not.toContain('private Resource response bytes')
  expect(f.guardCalls()).toBe(1)
  expect(f.serializations()).toBe(0)
  expect(f.arrivals()).toBe(3)
})
