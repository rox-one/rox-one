/**
 * W1-03 (#1500) review 3 regressions (no Postgres server needed): the real
 * Bun driver against a refused port is a retryable 503 (outbox keeps the
 * command), the transient classifier covers every Bun connection-class code
 * and the listed SQLSTATEs, transient ACL failures are retryable (commands
 * 503, subscribe `unavailable`), a JWKS outage is 503 on the commands route,
 * the gateway follows a recreated log's new epoch, and the service registry
 * is the single wired one.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:net'
import { SQL } from 'bun'
import { SignJWT, exportJWK, generateKeyPair } from 'jose'
import { createCommandEnvelope } from '../../../packages/core/src/commands/index.ts'
import type { DomainEvent } from '../../../packages/core/src/events/index.ts'
import { CommandStoreUnavailable, InMemoryCommandStore } from '../../../packages/server-core/src/commands/store.ts'
import { InProcessEventBus } from '../../../packages/server-core/src/commands/event-bus.ts'
import { boundCommandTypes, createWiredCommandRegistry } from '../../../packages/server-core/src/commands/registry.ts'
import { getLocalCommandRegistry } from '../../../packages/server-core/src/handlers/rpc/commands.ts'
import { WorkspaceCommandHttpClient, WorkspaceCommandSync } from '../../../packages/server-core/src/workspace-sync/client.ts'
import { InMemoryCommandOutbox } from '../../../packages/server-core/src/workspace-sync/outbox.ts'
import type { AuthenticatedActor, SharedProjectAuthority } from '../../../packages/shared/src/workspace-domain/identity/contracts.ts'
import { AuthenticationUnavailableError, createVerifiedActorResolver, type PersistedAuthSession } from '../src/auth/verified-actor.ts'
import type { WorkspaceHttpOptions } from '../src/http.ts'
import { WorkspaceCommandService } from '../src/modules/commands/service.ts'
import { WORKSPACE_MEMBER_AUTHORIZER, type WorkspaceAuthorizer } from '../src/modules/commands/authorizer.ts'
import { PostgresCommandStore, TRANSIENT_POSTGRES_DRIVER_CODES, isPostgresDataError, isTransientPostgresError } from '../src/modules/commands/store.ts'
import { RealtimeGateway, type RealtimePushTransport } from '../src/modules/realtime/gateway.ts'
import { TOKEN, actor, fakeResolver, request, serve } from './helpers.ts'

const closers: Array<() => Promise<void> | void> = []
afterEach(async () => { for (const close of closers.splice(0).reverse()) await close() })
const unusedAuthority = new Proxy({}, { get: () => () => { throw new Error('not used') } }) as SharedProjectAuthority
const envelope = (type: string, payload: unknown = {}) => ({ commandId: randomUUID(), type, payload, issuedAt: new Date().toISOString() })

async function refusedPort(): Promise<number> {
  const server = createServer()
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('no address')
  await new Promise<void>(resolve => server.close(() => resolve()))
  return address.port
}

describe('the real Bun Postgres driver against a refused port', () => {
  test('raises a connection-class code the classifier knows; lookups and commands are retryable', async () => {
    const sql = new SQL({ url: `postgres://rox:rox@127.0.0.1:${await refusedPort()}/rox`, max: 1, connectionTimeout: 3 })
    closers.push(() => sql.close().catch(() => {}))
    const store = new PostgresCommandStore(sql)
    const error = await store.findReceipt(randomUUID(), 'k', 'c').catch(e => e)
    expect(error).toBeInstanceOf(Error)
    expect(TRANSIENT_POSTGRES_DRIVER_CODES as readonly string[]).toContain(String(error.code))
    expect(isTransientPostgresError(error)).toBe(true)
    expect(store.isTransientError(error)).toBe(true)
    expect(store.isDataError(error)).toBe(false)

    const service = new WorkspaceCommandService({ store, authorizer: WORKSPACE_MEMBER_AUTHORIZER })
    const workspaceId = randomUUID()
    await expect(service.execute(actor([workspaceId]), workspaceId, envelope('system.ping'))).rejects.toBeInstanceOf(CommandStoreUnavailable)

    const { resolver } = fakeResolver(actor([workspaceId]))
    const http = await serve({ authority: unusedAuthority, actorResolver: resolver, commandBus: service })
    closers.push(http.close)
    const path = `/v1/workspaces/${workspaceId}/commands`
    expect(await request(http.url, path, { body: envelope('system.ping') })).toEqual({ status: 503, body: { error: { code: 'SERVICE_UNAVAILABLE' } }, allow: null })

    const outbox = new InMemoryCommandOutbox()
    const sync = new WorkspaceCommandSync({
      outbox, autoDrain: false, backoffBaseMs: 1,
      transport: new WorkspaceCommandHttpClient({ baseUrl: http.url, token: () => TOKEN }),
    })
    await sync.enqueue(workspaceId, createCommandEnvelope('system.ping', { nonce: 'n1' }))
    expect(await sync.drain(workspaceId, { force: true })).toMatchObject({ sent: 0, failed: 1, remaining: 1 })
    expect(await outbox.count(workspaceId)).toBe(1)
  }, 30_000)
})

describe('Postgres classifier (review 3 list)', () => {
  const pg = (errno: string) => Object.assign(new Error(`pg ${errno}`), { errno, code: 'ERR_POSTGRES_SERVER_ERROR' })
  test('every Bun connection-class driver code is transient, directly and wrapped', () => {
    for (const code of TRANSIENT_POSTGRES_DRIVER_CODES) {
      const error = Object.assign(new Error(code), { code, name: 'PostgresError' })
      expect([code, isTransientPostgresError(error)]).toEqual([code, true])
      expect([code, isTransientPostgresError(new Error('repo', { cause: error }))]).toEqual([code, true])
    }
    for (const code of ['ERR_POSTGRES_CONNECTION_REFUSED', 'ERR_POSTGRES_CONNECTION_TIMEOUT', 'ERR_POSTGRES_IDLE_TIMEOUT', 'ERR_POSTGRES_LIFETIME_TIMEOUT', 'ERR_POSTGRES_TLS_UPGRADE_FAILED', 'ERR_POSTGRES_QUERY_CANCELLED']) {
      expect(TRANSIENT_POSTGRES_DRIVER_CODES as readonly string[]).toContain(code)
    }
  })

  test('SQLSTATEs: 57014, 57P01-03, 08xxx, 53xxx, 40001, 40P01, 55P03, 28000, 28P01 retry; data / constraint / logic errors do not', () => {
    for (const s of ['57014', '57P01', '57P02', '57P03', '08000', '08003', '08006', '08001', '08P01', '53000', '53100', '53200', '53300', '40001', '40P01', '55P03', '28000', '28P01']) {
      expect([s, isTransientPostgresError(pg(s))]).toEqual([s, true])
    }
    for (const s of ['22021', '22P02', '23505', '25P02', '42P01', '40002', '42501', 'XX000']) {
      expect([s, isTransientPostgresError(pg(s))]).toEqual([s, false])
    }
    expect(isTransientPostgresError(Object.assign(new Error('x'), { code: 'ERR_POSTGRES_SERVER_ERROR' }))).toBe(false)
  })

  test('data errors (class 22 and driver encoding codes) are the only non-retryable lookup failures', () => {
    expect(isPostgresDataError(pg('22021'))).toBe(true)
    expect(isPostgresDataError(new Error('wrapped', { cause: pg('22P02') }))).toBe(true)
    expect(isPostgresDataError(Object.assign(new Error('x'), { code: 'ERR_POSTGRES_INVALID_BYTE_SEQUENCE' }))).toBe(true)
    expect(isPostgresDataError(pg('08006'))).toBe(false)
    expect(isPostgresDataError(pg('42P01'))).toBe(false)
    expect(isPostgresDataError(new TypeError('boom'))).toBe(false)
  })
})

describe('authorizer failures', () => {
  const blip = () => Object.assign(new Error('terminating connection due to administrator command'), { errno: '57P01', code: 'ERR_POSTGRES_SERVER_ERROR' })

  test('commands: a transient authorizer throw is 503, any other throw is a FORBIDDEN receipt', async () => {
    let mode: 'blip' | 'bug' = 'blip'
    const authorizer: WorkspaceAuthorizer = {
      ...WORKSPACE_MEMBER_AUTHORIZER,
      async can() { throw mode === 'blip' ? new Error('acl', { cause: blip() }) : new TypeError('acl bug') },
    }
    const store = Object.assign(new InMemoryCommandStore(), { isTransientError: isTransientPostgresError })
    const service = new WorkspaceCommandService({ store, authorizer })
    const workspaceId = randomUUID()
    const { resolver } = fakeResolver(actor([workspaceId]))
    const http = await serve({ authority: unusedAuthority, actorResolver: resolver, commandBus: service })
    closers.push(http.close)
    const path = `/v1/workspaces/${workspaceId}/commands`
    expect(await request(http.url, path, { body: envelope('system.ping') })).toMatchObject({ status: 503, body: { error: { code: 'SERVICE_UNAVAILABLE' } } })
    mode = 'bug'
    expect(await request(http.url, path, { body: envelope('system.ping') })).toMatchObject({ status: 200, body: { status: 'rejected', error: { code: 'FORBIDDEN' } } })
  })

  test('subscribe: a transient canReadTopic throw answers `unavailable`; any other throw `forbidden`', async () => {
    let mode: 'blip' | 'bug' = 'blip'
    const errors: unknown[] = []
    const authorizer: WorkspaceAuthorizer = { ...WORKSPACE_MEMBER_AUTHORIZER, async canReadTopic() { throw mode === 'blip' ? blip() : new TypeError('acl bug') } }
    const transport: RealtimePushTransport = { async pushToWorkspaceClient() { return true }, onClientDisconnect() { return () => {} } }
    const gateway = new RealtimeGateway({ bus: new InProcessEventBus({ epoch: 'e1' }), transport, authorizer, isTransientError: isTransientPostgresError, onError: e => errors.push(e) })
    closers.push(() => gateway.close())
    const ctx = { clientId: 'c1', workspaceId: randomUUID(), principalId: 'alice', deviceKey: 'd1' }
    expect((await gateway.subscribe(ctx, { topics: [{ topic: 'entity:task:t1' }] })).topics[0]).toMatchObject({ topic: 'entity:task:t1', status: 'unavailable' })
    expect(errors).toHaveLength(1)
    mode = 'bug'
    expect((await gateway.subscribe(ctx, { topics: [{ topic: 'entity:task:t2' }] })).topics[0]).toMatchObject({ status: 'forbidden' })
    const strict = new RealtimeGateway({ bus: new InProcessEventBus({ epoch: 'e1' }), transport, authorizer })
    closers.push(() => strict.close())
    mode = 'blip'
    expect((await strict.subscribe(ctx, { topics: [{ topic: 'entity:task:t3' }] })).topics[0]).toMatchObject({ status: 'forbidden' }) // no classifier → denial (unchanged)
  })
})

describe('JWKS outage', () => {
  async function setup(jwksUri: URL) {
    const { publicKey, privateKey } = await generateKeyPair('EdDSA')
    const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'EdDSA' }
    const workspaceId = randomUUID()
    const principalId = randomUUID()
    const session: PersistedAuthSession = { issuer: 'urn:test', subject: 'sub-1', principalId, sessionId: 'session-1', deviceId: 'device-1', expiresAt: Date.now() + 600_000, revokedAt: null }
    const resolver = createVerifiedActorResolver<AuthenticatedActor>(
      { issuer: 'urn:test', audience: 'rox', algorithms: ['EdDSA'], keySource: { jwksUri, allowLoopbackHttp: true } },
      { async resolvePrincipal() { return principalId }, async resolveSession() { return session }, async findSession() { return session } },
      { async listActiveWorkspaceIds() { return [workspaceId] } },
      input => ({ principalId: input.principalId, deviceId: input.deviceId, sessionId: input.sessionId, expiresAt: input.expiresAt, authenticatedWorkspaceIds: [...input.authenticatedWorkspaceIds] }),
    )
    const sign = (kid: string) => new SignJWT({ sid: 'session-1' }).setProtectedHeader({ alg: 'EdDSA', kid })
      .setIssuer('urn:test').setAudience('rox').setSubject('sub-1').setExpirationTime('10m').sign(privateKey)
    const service = new WorkspaceCommandService({ store: new InMemoryCommandStore(), authorizer: WORKSPACE_MEMBER_AUTHORIZER })
    const http = await serve({ authority: unusedAuthority, actorResolver: resolver as unknown as WorkspaceHttpOptions['actorResolver'], commandBus: service })
    closers.push(http.close)
    return { resolver, sign, jwk, http, path: `/v1/workspaces/${workspaceId}/commands` }
  }

  test('an unreachable JWKS endpoint is AuthenticationUnavailableError → 503 on the commands route', async () => {
    const f = await setup(new URL(`http://127.0.0.1:${await refusedPort()}/jwks`))
    const token = await f.sign('k1')
    expect(await f.resolver.authenticate(token).catch(e => e)).toBeInstanceOf(AuthenticationUnavailableError)
    expect(await request(f.http.url, f.path, { token, body: envelope('system.ping') })).toMatchObject({ status: 503, body: { error: { code: 'SERVICE_UNAVAILABLE' } } })
    expect(await request(f.http.url, f.path, { token: 'aaa.bbb.ccc', body: envelope('system.ping') })).toMatchObject({ status: 401 })
  })

  test('a JWKS 503 is retryable; once the IdP is back the command applies; an unknown kid stays 401', async () => {
    const idp = { status: 503, keys: [] as unknown[] }
    const server = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: () => new Response(JSON.stringify({ keys: idp.keys }), { status: idp.status, headers: { 'content-type': 'application/json' } }) })
    closers.push(() => server.stop(true))
    const f = await setup(new URL(`http://127.0.0.1:${server.port}/jwks`))
    idp.keys = [f.jwk]
    const token = await f.sign('k1')
    expect(await request(f.http.url, f.path, { token, body: envelope('system.ping') })).toMatchObject({ status: 503 })
    idp.status = 200
    expect(await request(f.http.url, f.path, { token, body: envelope('system.ping') })).toMatchObject({ status: 200, body: { status: 'applied' } })
    expect(await request(f.http.url, f.path, { token: await f.sign('unknown-kid'), body: envelope('system.ping') })).toMatchObject({ status: 401 })
  })
})

describe('gateway after a log rotation', () => {
  // Review 4: live subscriptions now retain an idle log, so a live subscriber
  // only sees a new epoch after a seq-cap rotation (cap 1, two topics).
  test('live subscribers get the new epoch\'s frames (seq restarts)', async () => {
    let now = 0
    const bus = new InProcessEventBus({ epoch: 'e1', windowIdleTtlMs: 1_000, maxSeqCountersPerWorkspace: 1, now: () => new Date(now) })
    const pushed: Array<[string, number]> = []
    const transport: RealtimePushTransport = {
      async pushToWorkspaceClient(_c, _w, _ch, args, verify) {
        if (verify && !(await verify({ principalId: 'alice' } as never))) return false
        const frame = args[1] as { epoch: string; seq: number }
        pushed.push([frame.epoch, frame.seq])
        return true
      },
      onClientDisconnect() { return () => {} },
    }
    const gateway = new RealtimeGateway({ bus, transport, authorizer: WORKSPACE_MEMBER_AUTHORIZER })
    closers.push(() => gateway.close())
    const ws = randomUUID()
    const ping = (): DomainEvent => ({ eventId: randomUUID(), workspaceId: ws, type: 'system.pinged', actorId: 'alice', aggregateRevision: 0, payload: {}, createdAt: 'now' })
    expect((await gateway.subscribe({ clientId: 'c1', workspaceId: ws, principalId: 'alice', deviceKey: 'd1' }, { topics: [{ topic: 'user:alice' }] })).topics[0]).toMatchObject({ status: 'subscribed', epoch: 'e1' })
    bus.publish([ping()])
    bus.publish([{ ...ping(), actorId: 'bob' }]) // second seq counter (user:bob)
    await gateway.flush()
    now = 5_000
    expect(bus.evictIdle()).toBeGreaterThanOrEqual(0)
    expect(bus.logCount()).toBe(0)
    bus.publish([ping()])
    bus.publish([ping()])
    await gateway.flush()
    expect(pushed).toEqual([['e1', 1], ['e1~1', 1], ['e1~1', 2]])
  })
})

describe('one wired registry', () => {
  test('the workspace service, the local RPC registry and createWiredCommandRegistry bind the same set', () => {
    const service = new WorkspaceCommandService({ store: new InMemoryCommandStore() })
    const wired = boundCommandTypes(createWiredCommandRegistry())
    expect(wired).toContain('system.ping')
    expect(boundCommandTypes(service.registry)).toEqual(wired)
    expect(boundCommandTypes(getLocalCommandRegistry())).toEqual(wired)
  })
})
