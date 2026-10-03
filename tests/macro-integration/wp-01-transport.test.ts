import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { SQL } from 'bun'
import { randomBytes, randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import WebSocket from 'ws'
import { decodeJwt } from 'jose'
import { WsRpcServer } from '../../packages/server-core/src/transport/server'
import { WsRpcClient } from '../../packages/server-core/src/transport/client'
import { deserializeEnvelope } from '../../packages/server-core/src/transport/codec'
import type { RequestContext, WorkspaceAuthorityAuthentication } from '../../packages/server-core/src/transport/types'
import { PROTOCOL_VERSION, CodedError, type MessageEnvelope } from '@craft-agent/shared/protocol'
import { createLocalIssuer } from '../../apps/workspace-service/src/auth/local-issuer'
import { createVerifiedActorResolver } from '../../apps/workspace-service/src/auth/verified-actor'
import { PostgresIdentityAuth, loadProtectedWorkspaceDatabaseUrl } from '../../apps/workspace-service/src/auth/postgres-identity'
import { applyWorkspaceMigrations, migrationFromSource } from '../../apps/workspace-service/src/database/migrations'
import { IdentityRepository } from '../../apps/workspace-service/src/modules/identity/repository'
import { IdentityCommands } from '../../apps/workspace-service/src/modules/identity/commands'
import type { AuthenticatedActor } from '../../packages/shared/src/workspace-domain/identity/contracts'

const schema = 'wp01_transport_' + randomBytes(6).toString('hex')
const issuer = 'urn:rox:transport-test:' + randomUUID()
const audience = 'rox-transport-test'
const password = 'synthetic-transport-test-' + randomUUID()
let database: SQL
let keyState: string
let auth: PostgresIdentityAuth
let repository: IdentityRepository
let commands: IdentityCommands
let localIssuer: Awaited<ReturnType<typeof createLocalIssuer>>
let resolver: ReturnType<typeof createVerifiedActorResolver<AuthenticatedActor>>
let owner: { login: string; subject: string; principalId: string }
let member: typeof owner
let outsider: typeof owner
const servers: WsRpcServer[] = []
const sockets: WebSocket[] = []
const clients: WsRpcClient[] = []

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected record')
  return Object.fromEntries(Object.entries(value))
}
function string(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Expected string')
  return value
}
function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error('Expected array')
  return value
}
function actor(ctx: RequestContext): AuthenticatedActor {
  if (!ctx.actor) throw new CodedError('AUTH_FAILED', 'Authentication required')
  return ctx.actor
}
function scope(ctx: RequestContext): string {
  if (!ctx.workspaceId) throw new CodedError('FORBIDDEN', 'Request denied')
  return ctx.workspaceId
}
const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

beforeAll(async () => {
  database = new SQL(await loadProtectedWorkspaceDatabaseUrl(process.env.ROX_WORKSPACE_TEST_CONFIG ?? join(homedir(), '.agents', 'state', 'rox-compound-workspace', 'postgres-environment.json')))
  await database.unsafe(`CREATE SCHEMA "${schema}"`)
  await applyWorkspaceMigrations(database, await Promise.all(['01-domain-contract.sql', '01-local-auth-bootstrap.sql'].map(async name =>
    migrationFromSource(name, await readFile(join(import.meta.dir, '../../apps/workspace-service/migrations', name), 'utf8')))), schema)
  auth = new PostgresIdentityAuth(database, issuer, schema)
  const account = async (label: string) => {
    const login = label + '-' + randomUUID() + '@example.org'
    return { login, ...await auth.provisionAccount(login, password) }
  }
  owner = await account('owner'); member = await account('member'); outsider = await account('outsider')
  keyState = await mkdtemp(join(tmpdir(), 'rox-wp01-transport-key-'))
  localIssuer = await createLocalIssuer({ mode: 'local-bootstrap', issuer, audience,
    stateDirectory: keyState, checkoutDirectory: process.cwd() }, auth)
  resolver = createVerifiedActorResolver<AuthenticatedActor>({ issuer, audience, algorithms: ['EdDSA'],
    keySource: { jwks: localIssuer.jwks() } }, auth, auth, input => ({
    principalId: input.principalId, sessionId: input.sessionId, deviceId: input.deviceId,
    expiresAt: input.expiresAt, authenticatedWorkspaceIds: input.authenticatedWorkspaceIds,
  }))
  repository = new IdentityRepository(database, schema)
  commands = new IdentityCommands(repository)
}, 30000)

afterEach(async () => {
  for (const client of clients.splice(0)) client.destroy()
  for (const socket of sockets.splice(0)) socket.terminate()
  await delay(10)
  for (const server of servers.splice(0)) server.close()
})

afterAll(async () => {
  if (database) { await database.unsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await database.close() }
  if (keyState) await rm(keyState, { recursive: true, force: true })
})

async function fixture() {
  const workspaceId = randomUUID()
  await repository.provisionWorkspace(owner.principalId, workspaceId, 'Synthetic transport workspace')
  await database.unsafe(`INSERT INTO "${schema}".workspace_member (workspace_id,principal_id,role) VALUES ($1,$2,'member')`, [workspaceId, member.principalId])
  const ownerToken = (await localIssuer.authenticate(owner.login, password)).token
  const memberToken = (await localIssuer.authenticate(member.login, password)).token
  return { workspaceId, ownerToken, memberToken }
}

async function shared(authentication: WorkspaceAuthorityAuthentication = resolver): Promise<WsRpcServer> {
  const server = new WsRpcServer({ host: '127.0.0.1', port: 0, workspaceAuthority: authentication })
  servers.push(server)
  server.handle('test:identity', ctx => ({ principalId: actor(ctx).principalId, workspaceId: scope(ctx), webContentsId: ctx.webContentsId }), { access: 'authenticatedWorkspace' })
  server.handle('domain.project.createShared', (ctx, body: unknown) => commands.createSharedProject(actor(ctx), scope(ctx), body), { access: 'authenticatedWorkspace' })
  server.handle('domain.project.list', (ctx, body: unknown) => commands.listProjects(actor(ctx), scope(ctx), body), { access: 'authenticatedWorkspace' })
  server.handle('domain.project.events', (ctx, body: unknown) => commands.replayEvents(actor(ctx), scope(ctx), body), { access: 'authenticatedWorkspace' })
  server.handle('unsafe:legacy', () => ({ privateTitle: 'MUST_NOT_ADVERTISE' }))
  server.handle('native:proof', () => ({ privateTitle: 'LOCAL_ONLY' }), { access: 'localElectron' })
  await server.listen()
  return server
}

async function pair(server: WsRpcServer, token: string, workspaceId: string): Promise<WsRpcClient> {
  const client = new WsRpcClient(`ws://127.0.0.1:${server.port}`, { token, workspaceId, mode: 'remote', autoReconnect: false, connectTimeout: 2000, requestTimeout: 3000 })
  clients.push(client)
  const connected = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => { off(); reject(new Error('WS test handshake timed out')) }, 2500)
    const off = client.onConnectionStateChanged(state => {
      if (state.status === 'connected') { clearTimeout(timeout); off(); resolve() }
      else if (state.status === 'failed' || state.status === 'disconnected') { clearTimeout(timeout); off(); reject(new Error('WS test handshake denied')) }
    })
  })
  client.connect()
  await connected
  return client
}

async function raw(server: WsRpcServer, fields: Record<string, unknown>, cookie?: string) {
  const socket = new WebSocket(`ws://127.0.0.1:${server.port}`, cookie ? { headers: { Cookie: cookie } } : undefined)
  sockets.push(socket)
  const messages: MessageEnvelope[] = []
  socket.on('message', data => messages.push(deserializeEnvelope(data.toString())))
  const ack = await new Promise<MessageEnvelope>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Raw handshake timed out')), 2500)
    socket.once('open', () => socket.send(JSON.stringify({ id: randomUUID(), type: 'handshake', protocolVersion: PROTOCOL_VERSION, ...fields })))
    const receive = (data: WebSocket.RawData) => {
      const message = deserializeEnvelope(data.toString())
      if (message.type === 'handshake_ack') { clearTimeout(timer); socket.off('message', receive); resolve(message) }
      else if (message.type === 'error') { clearTimeout(timer); socket.off('message', receive); reject(new Error('Raw handshake denied: ' + message.error?.code)) }
    }
    socket.on('message', receive)
    socket.once('close', () => { clearTimeout(timer); reject(new Error('Raw handshake closed')) })
    socket.once('error', error => { clearTimeout(timer); reject(error) })
  })
  return { socket, ack, messages }
}

function request(socket: WebSocket, channel: string, args: unknown[] = [], extra: Record<string, unknown> = {}): Promise<MessageEnvelope> {
  const id = randomUUID()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.off('message', receive); reject(new Error('Raw RPC timed out')) }, 3000)
    const receive = (data: WebSocket.RawData) => {
      const message = deserializeEnvelope(data.toString())
      if (message.id === id && message.type === 'response') { clearTimeout(timer); socket.off('message', receive); resolve(message) }
    }
    socket.on('message', receive)
    socket.send(JSON.stringify({ id, type: 'request', channel, args, ...extra }))
  })
}

async function disconnect(socket: WebSocket) {
  await new Promise<void>(resolve => { socket.once('close', () => resolve()); socket.close() })
  await delay(10)
}

async function waitFor(check: () => boolean) {
  const deadline = Date.now() + 2000
  while (!check()) { if (Date.now() > deadline) throw new Error('Expected transport observation missing'); await delay(5) }
}

function command(workspaceId: string, name: string, visibility: 'private' | 'members' = 'private') {
  return { commandId: randomUUID(), schemaVersion: 2, workspaceId, idempotencyKey: randomUUID(), expectedRevision: '0',
    payload: { name, workspaceName: 'Synthetic transport workspace', visibility } }
}

describe('WP-01 real shared WebSocket authority boundary', () => {
  test('two verified principals use current canonical Actor and the same SQL command/query/replay ports', async () => {
    const f = await fixture(); const server = await shared()
    const a = await pair(server, f.ownerToken, f.workspaceId); const b = await pair(server, f.memberToken, f.workspaceId)
    expect(await a.invoke('test:identity')).toEqual({ principalId: owner.principalId, workspaceId: f.workspaceId, webContentsId: null })
    expect(await b.invoke('test:identity')).toEqual({ principalId: member.principalId, workspaceId: f.workspaceId, webContentsId: null })
    const input = command(f.workspaceId, 'PRIVATE_WS_' + randomUUID())
    const first: unknown = await a.invoke('domain.project.createShared', input)
    const replay: unknown = await a.invoke('domain.project.createShared', input)
    expect(replay).toEqual(first)
    await a.invoke('domain.project.createShared', command(f.workspaceId, 'Shared WS project', 'members'))
    const list: unknown = await b.invoke('domain.project.list', {})
    expect(array(object(list).items)).toHaveLength(1)
    expect(JSON.stringify(list)).not.toContain(input.payload.name)
    const events: unknown = await b.invoke('domain.project.events', {})
    expect(array(object(events).events)).toHaveLength(2)
    expect(JSON.stringify(events)).not.toContain(string(object(object(first).entity).entityId))
    expect(JSON.stringify(events)).not.toContain(input.payload.name)
    await expect(b.invoke('domain.project.createShared', command(f.workspaceId, 'denied'))).rejects.toMatchObject({ code: 'FORBIDDEN', message: 'Request failed' })
    await expect(a.invoke('domain.project.createShared', { ...input, actor: { principalId: member.principalId } })).rejects.toMatchObject({ code: 'INVALID_PAYLOAD' })
    await expect(a.invoke('domain.project.createShared', { ...input, workspaceId: randomUUID() })).rejects.toMatchObject({ code: 'WORKSPACE_MISMATCH' })
    await expect(a.invoke('unsafe:legacy')).rejects.toMatchObject({ code: 'CHANNEL_NOT_FOUND' })
    await expect(a.invoke('native:proof')).rejects.toMatchObject({ code: 'CHANNEL_NOT_FOUND' })
  })

  test('raw identity/scope claims and cookie/boolean/local alternatives cannot authenticate shared clients', async () => {
    const f = await fixture(); const server = await shared()
    expect(() => new WsRpcServer({ workspaceAuthority: resolver, validateToken: async () => true })).toThrow('alternatives')
    expect(() => new WsRpcServer({ workspaceAuthority: resolver, validateSessionCookie: async () => true })).toThrow('alternatives')
    expect(() => new WsRpcServer({ workspaceAuthority: resolver, resolveLocalClientBinding: () => ({ workspaceId: f.workspaceId, webContentsId: 1 }) })).toThrow('alternatives')
    await expect(raw(server, { workspaceId: f.workspaceId }, 'authenticated=true')).rejects.toThrow('AUTH_FAILED')
    await expect(raw(server, { workspaceId: f.workspaceId, token: 'legacy-token' })).rejects.toThrow('AUTH_FAILED')
    await expect(raw(server, { workspaceId: f.workspaceId, token: f.ownerToken.slice(0, -8) + 'AAAAAAAA' })).rejects.toThrow('AUTH_FAILED')
    for (const fields of [
      { actor: { principalId: owner.principalId } }, { principalId: owner.principalId },
      { authenticatedWorkspaceIds: [f.workspaceId] }, { webContentsId: 1, localClientProof: 'forged-proof' },
    ]) await expect(raw(server, { workspaceId: f.workspaceId, token: f.ownerToken, ...fields })).rejects.toThrow('AUTH_FAILED')
    const outsiderToken = (await localIssuer.authenticate(outsider.login, password)).token
    await expect(raw(server, { workspaceId: f.workspaceId, token: outsiderToken })).rejects.toThrow('AUTH_FAILED')
    const authenticated = await raw(server, { workspaceId: f.workspaceId, token: f.ownerToken, clientCapabilities: ['openFileDialog'] })
    const identity = await request(authenticated.socket, 'test:identity', [], { actor: { principalId: outsider.principalId }, workspaceId: randomUUID() })
    expect(identity.result).toEqual({ principalId: owner.principalId, workspaceId: f.workspaceId, webContentsId: null })
    server.updateClientWorkspace(string(authenticated.ack.clientId), randomUUID())
    expect((await request(authenticated.socket, 'test:identity')).result).toEqual(identity.result)
  })

  test('live expiry, account/session revoke and membership loss deny requests without private error data', async () => {
    const f = await fixture(); const server = await shared()
    const current = await pair(server, f.ownerToken, f.workspaceId)
    await auth.revokeSession(string(decodeJwt(f.ownerToken).sid))
    await expect(current.invoke('test:identity')).rejects.toMatchObject({ code: 'AUTH_FAILED', message: 'Request failed' })
    const second = await pair(server, f.memberToken, f.workspaceId)
    await database.unsafe(`UPDATE "${schema}".workspace_member SET deleted_at=clock_timestamp() WHERE workspace_id=$1 AND principal_id=$2`, [f.workspaceId, member.principalId])
    await expect(second.invoke('domain.project.list', {})).rejects.toMatchObject({ code: 'FORBIDDEN', message: 'Request failed' })
    const short = await createLocalIssuer({ mode: 'local-bootstrap', issuer, audience, tokenLifetimeSeconds: 2,
      stateDirectory: keyState, checkoutDirectory: process.cwd() }, auth)
    const token = await short.authenticate(owner.login, password)
    const expiring = await pair(server, token.token, f.workspaceId)
    await delay(Math.max(0, token.expiresAt - Date.now() + 20))
    await expect(expiring.invoke('test:identity')).rejects.toMatchObject({ code: 'AUTH_FAILED', message: 'Request failed' })
    const disabledLogin = 'disabled-' + randomUUID() + '@example.org'
    const disabled = await auth.provisionAccount(disabledLogin, password)
    const disabledWorkspace = randomUUID()
    await repository.provisionWorkspace(disabled.principalId, disabledWorkspace, 'Disabled account workspace')
    const disabledToken = (await localIssuer.authenticate(disabledLogin, password)).token
    const disabledClient = await pair(server, disabledToken, disabledWorkspace)
    await auth.disableAccount(disabled.subject)
    await expect(disabledClient.invoke('test:identity')).rejects.toMatchObject({ code: 'AUTH_FAILED', message: 'Request failed' })
  })

  test('revocation at pre-invoke refresh prevents handler execution and outbound refresh suppresses a real private SQL result', async () => {
    const f = await fixture()
    let revokeNext = false
    const port: WorkspaceAuthorityAuthentication = {
      authenticate: token => resolver.authenticate(token),
      async revalidate(bound) {
        if (revokeNext) { revokeNext = false; await auth.revokeSession(bound.identity.sessionId) }
        return resolver.revalidate(bound)
      },
    }
    const server = await shared(port)
    let invoked = 0
    server.handle('test:mutation', () => { invoked++; return 'must-not-run' }, { access: 'authenticatedWorkspace' })
    const client = await pair(server, f.ownerToken, f.workspaceId)
    revokeNext = true
    await expect(client.invoke('test:mutation')).rejects.toMatchObject({ code: 'AUTH_FAILED' })
    expect(invoked).toBe(0)
    const ownerToken = (await localIssuer.authenticate(owner.login, password)).token
    const privateResult = await commands.createSharedProject((await resolver.authenticate(ownerToken)).actor, f.workspaceId, command(f.workspaceId, 'PRIVATE_WS_OUTBOUND_' + randomUUID()))
    server.handle('test:outbound', async ctx => {
      const result = await commands.listProjects(actor(ctx), scope(ctx), {})
      await auth.revokeSession(actor(ctx).sessionId)
      return result
    }, { access: 'authenticatedWorkspace' })
    const rawClient = await raw(server, { token: ownerToken, workspaceId: f.workspaceId })
    const output = await request(rawClient.socket, 'test:outbound')
    expect(output.result).toBeUndefined()
    expect(output.error).toEqual({ code: 'AUTH_FAILED', message: 'Request failed' })
    expect(JSON.stringify(output)).not.toContain(privateResult.data.name)
    expect(JSON.stringify(output)).not.toContain(owner.principalId)
    server.handle('test:internal-error', () => { throw new Error('private internal detail') }, { access: 'authenticatedWorkspace' })
    const renewed = await raw(server, { token: (await localIssuer.authenticate(owner.login, password)).token, workspaceId: f.workspaceId })
    expect((await request(renewed.socket, 'test:internal-error')).error).toEqual({ code: 'HANDLER_ERROR', message: 'Request failed' })
    const grantToken = (await localIssuer.authenticate(owner.login, password)).token
    const grant = await commands.createSharedProject((await resolver.authenticate(grantToken)).actor, f.workspaceId,
      command(f.workspaceId, 'PRIVATE_WS_REVOKED_MEMBERSHIP_' + randomUUID(), 'members'))
    server.handle('test:outbound-membership', async ctx => {
      const result = await commands.listProjects(actor(ctx), scope(ctx), {})
      await database.unsafe(`UPDATE "${schema}".workspace_member SET deleted_at=clock_timestamp() WHERE workspace_id=$1 AND principal_id=$2`, [f.workspaceId, actor(ctx).principalId])
      return result
    }, { access: 'authenticatedWorkspace' })
    const joined = await raw(server, { token: f.memberToken, workspaceId: f.workspaceId })
    const removed = await request(joined.socket, 'test:outbound-membership')
    expect(removed.result).toBeUndefined()
    expect(removed.error).toEqual({ code: 'FORBIDDEN', message: 'Request failed' })
    expect(JSON.stringify(removed)).not.toContain(grant.data.name)
  })

  test('shared push/client invocation is explicitly unavailable; reconnect is stale and foreign/new sessions never inherit prior buffers', async () => {
    const f = await fixture(); const server = await shared()
    const first = await raw(server, { token: f.ownerToken, workspaceId: f.workspaceId, clientCapabilities: ['private:capability'] })
    const id = string(first.ack.clientId)
    expect(first.ack.registeredChannels).not.toContain('unsafe:legacy')
    expect(first.ack.registeredChannels).not.toContain('native:proof')
    expect(server.hasClientCapability(id, 'private:capability')).toBe(false)
    expect(() => server.push('private:event', { to: 'client', clientId: id }, 'PRIVATE_WS_BUFFER')).toThrow('unavailable')
    await expect(server.invokeClient(id, 'private:capability', 'PRIVATE_WS_BUFFER')).rejects.toMatchObject({ code: 'CAPABILITY_UNAVAILABLE' })
    await disconnect(first.socket)
    expect(() => server.push('private:event', { to: 'client', clientId: id }, 'PRIVATE_WS_DISCONNECTED')).toThrow('unavailable')
    const same = await raw(server, { token: f.ownerToken, workspaceId: f.workspaceId, reconnectClientId: id, lastSeq: 0 })
    expect(same.ack.clientId).toBe(id)
    expect(same.ack.reconnected).toBe(true)
    expect(same.ack.stale).toBe(true)
    await disconnect(same.socket)
    const foreign = await raw(server, { token: f.memberToken, workspaceId: f.workspaceId, reconnectClientId: id, lastSeq: 0 })
    expect(foreign.ack.clientId).not.toBe(id)
    expect(foreign.ack.reconnected).not.toBe(true)
    expect(foreign.ack.stale).toBe(true)
    expect((await request(foreign.socket, 'test:identity')).result).toEqual({ principalId: member.principalId, workspaceId: f.workspaceId, webContentsId: null })
    const renewed = (await localIssuer.authenticate(owner.login, password)).token
    const newSession = await raw(server, { token: renewed, workspaceId: f.workspaceId, reconnectClientId: id, lastSeq: 0 })
    expect(newSession.ack.clientId).not.toBe(id)
    expect(newSession.ack.stale).toBe(true)
    await delay(20)
    for (const connected of [first, same, foreign, newSession]) {
      expect(connected.messages.filter(message => message.type === 'event')).toEqual([])
      expect(JSON.stringify(connected.messages)).not.toContain('PRIVATE_WS_BUFFER')
      expect(JSON.stringify(connected.messages)).not.toContain('PRIVATE_WS_DISCONNECTED')
    }
    await auth.revokeSession(string(decodeJwt(f.ownerToken).sid))
    await expect(raw(server, { token: f.ownerToken, workspaceId: f.workspaceId, reconnectClientId: id, lastSeq: 0 })).rejects.toThrow('AUTH_FAILED')
  })

  test('authenticatedWorkspace access stays closed in standalone mode; Electron proof and synchronous push/replay preserve standalone behavior', async () => {
    const legacyToken = 'synthetic-standalone-token'
    const server = new WsRpcServer({ host: '127.0.0.1', port: 0, requireAuth: true, validateToken: async token => token === legacyToken,
      resolveLocalClientBinding: candidate => candidate.localClientProof === 'main-issued-proof' && candidate.webContentsId === 44
        ? { workspaceId: 'authoritative-local-workspace', webContentsId: 44 } : null })
    servers.push(server)
    server.handle('native:proof', ctx => ({ workspaceId: ctx.workspaceId, webContentsId: ctx.webContentsId, hasActor: ctx.actor !== undefined }), { access: 'localElectron' })
    server.handle('domain:shared', () => 'must-not-run', { access: 'authenticatedWorkspace' })
    await server.listen()
    const forged = await raw(server, { token: legacyToken, workspaceId: 'forged', webContentsId: 44, localClientProof: 'forged' })
    expect(forged.ack.registeredChannels).not.toContain('native:proof')
    expect((await request(forged.socket, 'native:proof')).error?.code).toBe('CHANNEL_NOT_FOUND')
    expect((await request(forged.socket, 'domain:shared')).error?.code).toBe('CHANNEL_NOT_FOUND')
    const proof = { token: legacyToken, workspaceId: 'forged', webContentsId: 44, localClientProof: 'main-issued-proof' }
    const local = await raw(server, proof)
    expect((await request(local.socket, 'native:proof')).result).toEqual({ workspaceId: 'authoritative-local-workspace', webContentsId: 44, hasActor: false })
    const id = string(local.ack.clientId)
    server.push('local:event', { to: 'client', clientId: id }, 'first')
    await waitFor(() => local.messages.some(message => message.type === 'event'))
    await disconnect(local.socket)
    server.push('local:event', { to: 'client', clientId: id }, 'PRIVATE_LOCAL_REPLAY')
    const unproved = await raw(server, { ...proof, localClientProof: 'forged', reconnectClientId: id, lastSeq: 1 })
    expect(unproved.ack.clientId).not.toBe(id)
    expect(JSON.stringify(unproved.messages)).not.toContain('PRIVATE_LOCAL_REPLAY')
    const resumed = await raw(server, { ...proof, reconnectClientId: id, lastSeq: 1 })
    expect(resumed.ack.clientId).toBe(id)
    expect(resumed.ack.reconnected).toBe(true)
    expect(resumed.ack.stale).not.toBe(true)
    await waitFor(() => resumed.messages.some(message => message.type === 'event'))
    expect(resumed.messages.filter(message => message.type === 'event').map(message => message.args)).toEqual([['PRIVATE_LOCAL_REPLAY']])
  })
})
