import { createAuthorityJournalPorts } from '../../apps/electron/src/main/project-authority-journal'
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { SQL } from 'bun'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { createWorkspaceServer, loadWorkspaceBootstrapMigrations } from '../../apps/workspace-service/src/server'
import { loadProtectedWorkspaceDatabaseUrl } from '../../apps/workspace-service/src/auth/postgres-identity'
import { WsRpcServer } from '../../packages/server-core/src/transport/server'
import { WsRpcClient } from '../../packages/server-core/src/transport/client'
import { RoutedClient } from '../../apps/electron/src/transport/routed-client'
import { ProjectAuthorityConnection } from '../../apps/electron/src/transport/project-authority-connection'
import { authenticateProjectAuthority, resolveProjectAuthorityTarget, connectStoredProjectAuthority, disconnectStoredProjectAuthority,
  getStoredProjectAuthorityConfiguration, resolveStoredProjectAuthority, storeProjectAuthorityCredential, type ProjectAuthorityStoragePorts } from '../../apps/electron/src/main/project-authority'
import { PROJECT_AUTHORITY_CREDENTIAL_NAME, createSharedProjectIntent, requireSharedProject, requireSharedProjectPage,
  requireSharedProjectResult, requireProjectAuthorityConfiguration, type ProjectAuthorityTarget } from '../../apps/electron/src/shared/project-authority'
import { CredentialManager, SecureStorageBackend } from '../../packages/shared/src/credentials'
import { createProject, loadWorkspaceProjects } from '../../packages/shared/src/projects/storage'
import { readJsonFileSync, atomicWriteFileSync } from '../../packages/shared/src/utils/files'
import type { StoredConfig } from '../../packages/shared/src/config'
import { DOMAIN_PROJECT_RPC, SHARED_PROJECT_TEXT_MAX_LENGTH } from '../../packages/shared/src/workspace-domain/identity/contracts'
import { RPC_CHANNELS } from '@rox/shared/protocol'

const schema = 'wp01_native_' + randomBytes(6).toString('hex')
const issuer = 'urn:rox:native-routing:' + randomUUID()
const audience = 'rox-native-routing-test'
const password = 'synthetic-native-' + randomUUID()
const loginA = 'a-' + randomUUID() + '@example.org'
const loginB = 'b-' + randomUUID() + '@example.org'
const localA = randomUUID()
const localB = randomUUID()
const workspaceA = randomUUID()
const workspaceB = randomUUID()
let database: SQL
let state: string
let service: Awaited<ReturnType<typeof createWorkspaceServer>>
let host: WsRpcServer
let url: string
let credentials: CredentialManager
let principalA: string
let principalB: string
let tokenA: string
let tokenB: string
let expiresAtA: number
let expiresAtB: number
const authorities: ProjectAuthorityConnection[] = []
const hostClients: WsRpcClient[] = []
let unsafeHostDomainInvocations = 0

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected record')
  return value as Record<string, unknown>
}
function text(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Expected string')
  return value
}
async function credential(localWorkspaceId: string, token: string, expiresAt: number) {
  await credentials.set({ type: 'service_oauth', workspaceId: localWorkspaceId, name: PROJECT_AUTHORITY_CREDENTIAL_NAME },
    { value: token, tokenType: 'Bearer', expiresAt })
}
async function login(login: string, authorityWorkspaceId: string, workspaceName: string): Promise<{ token: string; expiresAt: number }> {
  const result = await authenticateProjectAuthority({ serviceUrl: url.replace('ws:', 'http:'),
    workspaceId: authorityWorkspaceId, workspaceName, login, password })
  expect(result.configuration.workspaceId).toBe(authorityWorkspaceId)
  expect(result.configuration.workspaceName).toBe(workspaceName)
  return result.credential
}
async function hostClient(): Promise<WsRpcClient> {
  const client = new WsRpcClient(`ws://127.0.0.1:${host.port}`, { autoReconnect: false })
  hostClients.push(client)
  const connected = Promise.withResolvers<void>()
  client.onConnectionStateChanged(state => {
    if (state.status === 'connected') connected.resolve()
    if (state.status === 'failed') connected.reject(new Error('Local host connection failed'))
  })
  client.connect()
  await connected.promise
  return client
}
async function authority(localWorkspaceId: string, authorityWorkspaceId: string) {
  const connection = new ProjectAuthorityConnection(id => resolveProjectAuthorityTarget(id, { url, workspaceId: authorityWorkspaceId }, credentials))
  authorities.push(connection)
  await connection.setWorkspace(localWorkspaceId)
  await waitForAuthority(connection)
  const local = await hostClient()
  const routed = new RoutedClient(local, local)
  routed.setProjectAuthority(connection, localWorkspaceId)
  await waitForAuthority(connection)
  return { connection, routed }
}
async function waitForAuthority(connection: ProjectAuthorityConnection): Promise<void> {
  if (connection.getState() === 'ready' || connection.getState() === 'denied') return
  const settled = Promise.withResolvers<void>()
  const timeout = setTimeout(() => settled.reject(new Error('Authority connection did not settle')), 5000)
  const unsubscribe = connection.subscribe(() => {
    if (connection.getState() === 'ready' || connection.getState() === 'denied') settled.resolve()
  })
  try { await settled.promise } finally { clearTimeout(timeout); unsubscribe() }
}

beforeAll(async () => {
  state = await mkdtemp(join(tmpdir(), 'rox-wp01-native-'))
  database = new SQL(await loadProtectedWorkspaceDatabaseUrl(process.env.ROX_WORKSPACE_TEST_CONFIG ?? join(homedir(), '.agents', 'state', 'rox-compound-workspace', 'postgres-environment.json')))
  await database.unsafe(`CREATE SCHEMA "${schema}"`)
  service = await createWorkspaceServer({ database, schema,
    migrations: await loadWorkspaceBootstrapMigrations(join(import.meta.dir, '../../apps/workspace-service/migrations')),
    authentication: { mode: 'local-bootstrap', configuration: { mode: 'local-bootstrap', issuer, audience,
      stateDirectory: join(state, 'issuer'), checkoutDirectory: process.cwd() } },
    host: '127.0.0.1', port: 0, serverId: 'native-routing-test-' + randomUUID(),
  })
  await service.server.listen()
  url = `ws://127.0.0.1:${service.server.port}`
  const accountA = await service.identity.provisionAccount(loginA, password)
  const accountB = await service.identity.provisionAccount(loginB, password)
  principalA = accountA.principalId; principalB = accountB.principalId
  await service.repository.provisionWorkspace(principalA, workspaceA, 'Actual private authority A')
  await service.repository.provisionWorkspace(principalB, workspaceB, 'Actual authority B')
  const signedA = await login(loginA, workspaceA, 'Actual private authority A')
  const signedB = await login(loginB, workspaceB, 'Actual authority B')
  tokenA = signedA.token; tokenB = signedB.token
  expiresAtA = signedA.expiresAt; expiresAtB = signedB.expiresAt
  // Actual default v3 encryption stays in this fixture; the test runner PATH excludes OS keychain CLIs.
  credentials = new CredentialManager({ backends: [new SecureStorageBackend({ directory: join(state, 'credentials') })] })
  await credential(localA, tokenA, signedA.expiresAt); await credential(localB, tokenB, signedB.expiresAt)
  await mkdir(join(state, localA), { recursive: true }); await mkdir(join(state, localB), { recursive: true })
  createProject(join(state, localA), { name: 'Actual local folder A' })
  createProject(join(state, localB), { name: 'Actual local folder B' })
  host = new WsRpcServer({ host: '127.0.0.1', port: 0 })
  host.handle(RPC_CHANNELS.projects.GET, (_context, id: unknown) => {
    if (id !== localA && id !== localB) throw new Error('Unknown test workspace')
    return loadWorkspaceProjects(join(state, id))
  })
  host.handle(DOMAIN_PROJECT_RPC.GET, () => { unsafeHostDomainInvocations++; return { name: 'UNSAFE_HOST_FALLBACK' } })
  await host.listen()
}, 30000)

afterAll(async () => {
  for (const connection of authorities) connection.destroy()
  for (const client of hostClients) client.destroy()
  host?.close(); service?.server.close()
  if (database) { await database.unsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await database.close() }
  if (state) await rm(state, { recursive: true, force: true })
})

async function storedFixture() {
  const localId = randomUUID()
  const path = join(state, 'config-' + localId + '.json')
  const config: StoredConfig = { workspaces: [{ id: localId, name: 'Local race fixture', slug: localId,
    rootPath: join(state, localId), createdAt: Date.now() }], activeWorkspaceId: localId, activeSessionId: null }
  atomicWriteFileSync(path, JSON.stringify(config))
  const strictPorts = await createAuthorityJournalPorts(credentials, () => readJsonFileSync<StoredConfig>(path),
    value => atomicWriteFileSync(path, JSON.stringify(value), { durable: true }))
  const ports: ProjectAuthorityStoragePorts = { ...strictPorts, authenticate: authenticateProjectAuthority }
  const configuration = requireProjectAuthorityConfiguration({ url, workspaceId: workspaceA, workspaceName: 'Actual private authority A' })
  await storeProjectAuthorityCredential(localId, configuration, { token: tokenA, expiresAt: expiresAtA }, ports)
  return { localId, path, ports, configuration }
}
function loginInput(account = loginA, remoteId = workspaceA, name = 'Actual private authority A') {
  return { serviceUrl: url.replace('ws:', 'http:'), workspaceId: remoteId, workspaceName: name, login: account, password }
}
function fingerprint(value: string): string { return createHash('sha256').update(value).digest('hex') }

describe('WP-01 actual native project authority routing', () => {
  test('A creates and reloads a canonical private DTO while actual local folder storage stays host-routed', async () => {
    const { routed, connection } = await authority(localA, workspaceA)
    expect(connection.getState()).toBe('ready')
    const body = createSharedProjectIntent(localA, 'Actual private authority A', 'PRIVATE_NATIVE_' + randomUUID(), 'private')
    const created = requireSharedProjectResult(await routed.invoke(DOMAIN_PROJECT_RPC.CREATE_SHARED, localA, body), body.commandId)
    const project = created.data
    expect(requireSharedProjectResult(await routed.invoke(DOMAIN_PROJECT_RPC.CREATE_SHARED, localA, body), body.commandId)).toEqual(created)
    expect(() => requireSharedProjectResult({ ...created, verification: 'unverified' }, body.commandId)).toThrow('INVALID_PAYLOAD')
    expect(() => requireSharedProjectResult({ ...created, entityId: 'project:' + randomUUID() }, body.commandId)).toThrow('INVALID_PAYLOAD')
    expect(project.entity.workspaceId).toBe(workspaceA)
    expect(project.ownerPrincipalId).toBe(principalA)
    expect(project.visibility).toBe('private')
    expect(project).not.toHaveProperty('folderPath')
    expect(project).not.toHaveProperty('assetsPath')
    expect(project).not.toHaveProperty('workspaceRootPath')
    expect(requireSharedProject(await routed.invoke(DOMAIN_PROJECT_RPC.GET, localA, { entityId: project.entity.entityId }))).toEqual(project)
    expect(requireSharedProjectPage(await routed.invoke(DOMAIN_PROJECT_RPC.LIST, localA, {})).items).toEqual([project])
    const renewed = await authority(localA, workspaceA)
    expect(requireSharedProject(await renewed.routed.invoke(DOMAIN_PROJECT_RPC.GET, localA, { entityId: project.entity.entityId }))).toEqual(project)
    const local: unknown = await routed.invoke(RPC_CHANNELS.projects.GET, localA)
    if (!Array.isArray(local) || local.length !== 1) throw new Error('Missing real local folder project')
    const native = object(local[0]); const config = object(native.config)
    expect(config.name).toBe('Actual local folder A')
    expect((await stat(text(native.folderPath))).isDirectory()).toBe(true)
    expect((await stat(text(native.assetsPath))).isDirectory()).toBe(true)
    expect(JSON.stringify(local)).not.toContain(project.name)
    const disk = await readFile(join(state, 'credentials', 'credentials.enc'))
    expect(disk.toString()).not.toContain(tokenA)
    expect(disk.toString()).not.toContain(tokenB)
    expect(unsafeHostDomainInvocations).toBe(0)
  })

  test('B without membership gets HTTP403 and a denied native authority while local folder B remains usable', async () => {
    const created = await service.authority.createSharedProject((await service.actorResolver.authenticate(tokenA)).actor, workspaceA,
      { commandId: randomUUID(), idempotencyKey: randomUUID(), schemaVersion: 2, workspaceId: workspaceA,
        expectedRevision: '0', payload: { name: 'PRIVATE_NATIVE_DENIED_' + randomUUID(), workspaceName: 'Actual private authority A', visibility: 'private' } })
    const project = created.data
    const response = await fetch(url.replace('ws:', 'http:') + '/v1/workspaces/' + workspaceA + '/projects/' + project.entity.entityId,
      { headers: { Authorization: 'Bearer ' + tokenB } })
    expect(response.status).toBe(403)
    const denied = await response.text()
    expect(denied).toBe('{"error":{"code":"FORBIDDEN"}}')
    expect(denied).not.toContain(project.name)
    const b = await authority(localB, workspaceA)
    expect(b.connection.getState()).toBe('denied')
    expect(b.routed.isChannelAvailable(DOMAIN_PROJECT_RPC.GET)).toBe(false)
    await expect(b.routed.invoke(DOMAIN_PROJECT_RPC.GET, localB, { entityId: project.entity.entityId })).rejects.toMatchObject({ code: 'AUTH_FAILED' })
    expect(JSON.stringify(await b.routed.invoke(RPC_CHANNELS.projects.GET, localB))).toContain('Actual local folder B')
    expect(unsafeHostDomainInvocations).toBe(0)
  })

  test('main sign-in uses the actual issuer and membership query and returns coded denial for wrong credentials or scope', async () => {
    const input = { serviceUrl: url.replace('ws:', 'http:'), workspaceId: workspaceA,
      workspaceName: 'Actual private authority A', login: loginB, password }
    let accepted = false
    let failure: Record<string, unknown> | null = null
    try { await authenticateProjectAuthority(input); accepted = true }
    catch (error) { failure = object(error) }
    // A mutant accepting B prints only booleans, never the issuer token.
    expect(accepted).toBe(false)
    expect(failure?.code).toBe('FORBIDDEN')
    expect(failure?.status).toBe(403)
    await expect(authenticateProjectAuthority({ ...input, login: loginA, password: 'wrong' })).rejects.toMatchObject({ code: 'UNAUTHENTICATED', status: 401 })
    await expect(authenticateProjectAuthority({ ...input, actor: { principalId: principalA } })).rejects.toMatchObject({ code: 'INVALID_PAYLOAD', status: 400 })
    await expect(authenticateProjectAuthority({ ...input, serviceUrl: 'http://198.51.100.1' })).rejects.toMatchObject({ code: 'INVALID_PAYLOAD' })
  })

  test('an actual unresponsive loopback issuer returns a coded timeout without internal details', async () => {
    const unresponsive = createServer(() => {})
    await new Promise<void>((resolve, reject) => {
      unresponsive.once('error', reject)
      unresponsive.listen(0, '127.0.0.1', resolve)
    })
    const address = unresponsive.address()
    if (!address || typeof address === 'string') throw new Error('Missing actual HTTP timeout listener')
    let accepted = false
    let failure: Record<string, unknown> | null = null
    try { await authenticateProjectAuthority({ ...loginInput(), serviceUrl: 'http://127.0.0.1:' + address.port }); accepted = true }
    catch (error) { failure = object(error) }
    finally { await new Promise<void>((resolve, reject) => {
      unresponsive.close(error => error ? reject(error) : resolve())
      unresponsive.closeAllConnections()
    }) }
    expect(accepted).toBe(false)
    expect(failure?.code).toBe('REQUEST_TIMEOUT')
    expect(failure?.status).toBe(504)
  }, 15000)

  test('wrong-password replacement preserves the actual encrypted credential and durable public configuration', async () => {
    const fixture = await storedFixture()
    const before = await readFile(fixture.path)
    const result = await connectStoredProjectAuthority(fixture.localId, { ...loginInput(), password: 'wrong' }, () => true, fixture.ports)
    expect(result).toEqual({ ok: false, error: { code: 'UNAUTHENTICATED', status: 401 } })
    expect(await readFile(fixture.path)).toEqual(before)
    const resolved = await resolveStoredProjectAuthority(fixture.localId, fixture.ports)
    expect(fingerprint(resolved?.token ?? '')).toBe(fingerprint(tokenA))
    expect(await getStoredProjectAuthorityConfiguration(fixture.localId, fixture.ports)).toEqual(fixture.configuration)
  })

  test('disconnect during real HTTP authentication fences the late login and cannot resurrect private credentials', async () => {
    const fixture = await storedFixture()
    const authenticated = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const delayed: ProjectAuthorityStoragePorts = { ...fixture.ports, authenticate: async input => {
      const verified = await authenticateProjectAuthority(input)
      authenticated.resolve(); await release.promise
      return verified
    } }
    const connecting = connectStoredProjectAuthority(fixture.localId, loginInput(), () => true, delayed)
    await authenticated.promise
    expect(await disconnectStoredProjectAuthority(fixture.localId, fixture.ports)).toEqual({ ok: true })
    release.resolve()
    expect(await connecting).toEqual({ ok: false, error: { code: 'WORKSPACE_MISMATCH', status: 403 } })
    expect(await resolveStoredProjectAuthority(fixture.localId, fixture.ports)).toBeNull()
    expect(await credentials.get({ type: 'service_oauth', workspaceId: fixture.localId, name: PROJECT_AUTHORITY_CREDENTIAL_NAME })).toBeNull()
  })

  test('a newer same-workspace login wins after two actual HTTP authentications finish out of order', async () => {
    const fixture = await storedFixture()
    const authenticated = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const delayed: ProjectAuthorityStoragePorts = { ...fixture.ports, authenticate: async input => {
      const verified = await authenticateProjectAuthority(input)
      authenticated.resolve(); await release.promise
      return verified
    } }
    const older = connectStoredProjectAuthority(fixture.localId, loginInput(), () => true, delayed)
    await authenticated.promise
    expect(await connectStoredProjectAuthority(fixture.localId, loginInput(loginB, workspaceB, 'Actual authority B'), () => true, fixture.ports)).toEqual({ ok: true })
    release.resolve()
    expect(await older).toEqual({ ok: false, error: { code: 'WORKSPACE_MISMATCH', status: 403 } })
    const target = await resolveStoredProjectAuthority(fixture.localId, fixture.ports)
    if (!target) throw new Error('Missing committed latest authority')
    expect(target.workspaceId).toBe(workspaceB)
    expect((await service.actorResolver.authenticate(target.token)).actor.principalId).toBe(principalB)
  })

  test('credential writes reread disk metadata and a superseded write rolls back before disconnect commits', async () => {
    const fixture = await storedFixture()
    const written = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    let first = true
    const delayed: ProjectAuthorityStoragePorts = { ...fixture.ports, credentials: {
      get: id => fixture.ports.credentials.get(id), delete: id => fixture.ports.credentials.delete(id),
      set: async (id, value) => { await fixture.ports.credentials.set(id, value); if (first && id.name === PROJECT_AUTHORITY_CREDENTIAL_NAME) { first = false; written.resolve(); await release.promise } },
    } }
    const storing = storeProjectAuthorityCredential(fixture.localId, fixture.configuration,
      { token: tokenA, expiresAt: expiresAtA }, delayed)
    await written.promise
    const concurrentMetadata = fixture.ports.loadConfig()
    if (!concurrentMetadata) throw new Error('Missing actual disk configuration')
    concurrentMetadata.notificationsEnabled = true
    concurrentMetadata.workspaces = concurrentMetadata.workspaces.map(workspace => ({ ...workspace, name: 'Concurrent metadata update' }))
    fixture.ports.saveConfig(concurrentMetadata)
    release.resolve(); await storing
    const preserved = fixture.ports.loadConfig()
    expect(preserved?.notificationsEnabled).toBe(true)
    expect(preserved?.workspaces[0]?.name).toBe('Concurrent metadata update')
    // Start a different actual credential write, then invalidate it while the encrypted store is paused.
    const writtenAgain = Promise.withResolvers<void>(); const releaseAgain = Promise.withResolvers<void>()
    first = true
    const delayedAgain: ProjectAuthorityStoragePorts = { ...fixture.ports, credentials: {
      get: id => fixture.ports.credentials.get(id), delete: id => fixture.ports.credentials.delete(id),
      set: async (id, value) => { await fixture.ports.credentials.set(id, value); if (first && id.name === PROJECT_AUTHORITY_CREDENTIAL_NAME) { first = false; writtenAgain.resolve(); await releaseAgain.promise } },
    } }
    const staleWrite = storeProjectAuthorityCredential(fixture.localId, { url, workspaceId: workspaceB, workspaceName: 'Actual authority B' },
      { token: tokenB, expiresAt: expiresAtB }, delayedAgain)
    // Attach rejection before releasing the barrier so it cannot become an unhandled rejection.
    const staleResult = staleWrite.then(() => true, () => false)
    await writtenAgain.promise
    const disconnecting = disconnectStoredProjectAuthority(fixture.localId, fixture.ports)
    const reading = resolveStoredProjectAuthority(fixture.localId, fixture.ports)
    releaseAgain.resolve()
    expect(await staleResult).toBe(false)
    expect(await disconnecting).toEqual({ ok: true })
    expect(await reading).toBeNull()
    expect(await getStoredProjectAuthorityConfiguration(fixture.localId, fixture.ports)).toBeNull()
    expect(fixture.ports.loadConfig()?.notificationsEnabled).toBe(true)
  })

  test('native and HTTP accept the full Project text boundary and reject overflow without a persisted effect', async () => {
    const { routed } = await authority(localA, workspaceA)
    const name = 'Я'.repeat(SHARED_PROJECT_TEXT_MAX_LENGTH)
    const body = createSharedProjectIntent(localA, 'Actual private authority A', name, 'private')
    const created = requireSharedProjectResult(await routed.invoke(DOMAIN_PROJECT_RPC.CREATE_SHARED, localA, body), body.commandId)
    expect(created.data.name).toBe(name)
    expect(requireSharedProject(await routed.invoke(DOMAIN_PROJECT_RPC.GET, localA, { entityId: created.entity.entityId })).name).toBe(name)
    expect(() => createSharedProjectIntent(localA, 'Actual private authority A', name + 'Я', 'private')).toThrow('INVALID_PAYLOAD')
    const before = await database.unsafe<{ count: string }[]>(`SELECT count(*)::text AS count FROM "${schema}".project`)
    const overflow = await fetch(url.replace('ws:', 'http:') + '/v1/workspaces/' + workspaceA + '/commands/project.createShared', {
      method: 'POST', headers: { Authorization: 'Bearer ' + tokenA, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, commandId: randomUUID(), idempotencyKey: randomUUID(), workspaceId: workspaceA,
        payload: { ...body.payload, name: name + 'Я' } }),
    })
    expect(overflow.status).toBe(400)
    expect(await overflow.json()).toEqual({ error: { code: 'INVALID_PAYLOAD' } })
    expect(await database.unsafe<{ count: string }[]>(`SELECT count(*)::text AS count FROM "${schema}".project`)).toEqual(before)
  })

  test('a late A credential resolution cannot replace the live B authority connection or return A private titles', async () => {
    const localRaceA = randomUUID(); const localRaceB = randomUUID()
    await credential(localRaceA, tokenA, expiresAtA); await credential(localRaceB, tokenB, expiresAtB)
    const delayedA = Promise.withResolvers<ProjectAuthorityTarget | null>()
    const connection = new ProjectAuthorityConnection(id => id === localRaceA ? delayedA.promise
      : resolveProjectAuthorityTarget(id, { url, workspaceId: workspaceB }, credentials))
    authorities.push(connection)
    const original = connection.setWorkspace(localRaceA)
    await connection.setWorkspace(localRaceB)
    await waitForAuthority(connection)
    expect(connection.getState()).toBe('ready')
    delayedA.resolve(await resolveProjectAuthorityTarget(localRaceA, { url, workspaceId: workspaceA }, credentials))
    await original
    const page = requireSharedProjectPage(await connection.invoke(DOMAIN_PROJECT_RPC.LIST, localRaceB, {}))
    expect(page.items).toEqual([])
    expect(JSON.stringify(page)).not.toContain('PRIVATE_NATIVE_')
    expect(connection.getState()).toBe('ready')
    expect(unsafeHostDomainInvocations).toBe(0)
  })

  test('missing credentials, arbitrary domain channels and forged scope never fall back to host or another principal', async () => {
    const local = await hostClient()
    const absent = new RoutedClient(local, local)
    await expect(absent.invoke(DOMAIN_PROJECT_RPC.GET, localA, {})).rejects.toMatchObject({ code: 'CAPABILITY_UNAVAILABLE' })
    await expect(absent.invoke('domain.project.export', localA, {})).rejects.toMatchObject({ code: 'CAPABILITY_UNAVAILABLE' })
    const a = await authority(localA, workspaceA)
    await expect(a.routed.invoke(DOMAIN_PROJECT_RPC.GET, localB, {})).rejects.toMatchObject({ code: 'WORKSPACE_MISMATCH' })
    await expect(a.routed.invoke(DOMAIN_PROJECT_RPC.GET, localA, { entityId: 'project:' + randomUUID(), actor: { principalId: principalB } }))
      .rejects.toMatchObject({ code: 'INVALID_PAYLOAD' })
    expect(() => a.routed.on(DOMAIN_PROJECT_RPC.EVENTS, () => {})).toThrow('CAPABILITY_UNAVAILABLE')
    await credentials.delete({ type: 'service_oauth', workspaceId: localA, name: PROJECT_AUTHORITY_CREDENTIAL_NAME })
    await a.connection.setWorkspace(localA)
    expect(a.connection.getState()).toBe('denied')
    await expect(a.routed.invoke(DOMAIN_PROJECT_RPC.GET, localA, {})).rejects.toMatchObject({ code: 'AUTH_FAILED' })
    expect(JSON.stringify(await a.routed.invoke(RPC_CHANNELS.projects.GET, localA))).toContain('Actual local folder A')
    expect(unsafeHostDomainInvocations).toBe(0)
  })
})
