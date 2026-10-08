/**
 * W1-03 (#1500) review 2 regressions (no Postgres): command responses never
 * wait on fan-out, a poison projector does not stall the stream, an identity
 * store blip during auth is 503 on the commands route, cursor writes are
 * batched and opt-in, and the runtime sweeps idle replay windows.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import type { SQL } from 'bun'
import { SignJWT, exportJWK, generateKeyPair } from 'jose'
import { EventProjectionRegistry, type DomainEvent, type RealtimeEventFrame } from '../../../packages/core/src/events/index.ts'
import { InMemoryCommandStore } from '../../../packages/server-core/src/commands/store.ts'
import { InProcessEventBus } from '../../../packages/server-core/src/commands/event-bus.ts'
import { createCommandRegistry } from '../../../packages/server-core/src/commands/registry.ts'
import type { AuthenticatedActor, SharedProjectAuthority } from '../../../packages/shared/src/workspace-domain/identity/contracts.ts'
import { AuthenticationError, AuthenticationUnavailableError, createVerifiedActorResolver, type PersistedAuthSession } from '../src/auth/verified-actor.ts'
import type { WorkspaceHttpOptions } from '../src/http.ts'
import { WorkspaceCommandService } from '../src/modules/commands/service.ts'
import { WORKSPACE_MEMBER_AUTHORIZER } from '../src/modules/commands/authorizer.ts'
import { createWorkspaceCommandBus } from '../src/modules/commands/runtime.ts'
import { isTransientPostgresError } from '../src/modules/commands/store.ts'
import { DomainEventRelay } from '../src/modules/events/relay.ts'
import { valkeyEventSink } from '../src/modules/events/valkey.ts'
import { RealtimeGateway, type RealtimePushTransport } from '../src/modules/realtime/gateway.ts'
import { InMemoryRealtimeCursorStore, type RealtimeCursorEntry, type RealtimeCursorOwner, type RealtimeCursorPosition } from '../src/modules/realtime/cursor-store.ts'
import { actor, fakeResolver, request, serve } from './helpers.ts'

const closers: Array<() => Promise<void> | void> = []
afterEach(async () => { for (const close of closers.splice(0).reverse()) await close() })
const unusedAuthority = new Proxy({}, { get: () => () => { throw new Error('not used') } }) as SharedProjectAuthority
const envelope = (type: string, payload: unknown = {}) => ({ commandId: randomUUID(), type, payload, issuedAt: new Date().toISOString() })
const pinged = (ws: string, actorId: string, extra: Partial<DomainEvent> = {}): DomainEvent =>
  ({ eventId: randomUUID(), workspaceId: ws, type: 'system.pinged', actorId, aggregateRevision: 0, payload: {}, createdAt: 'now', ...extra })

describe('command responses do not wait on fan-out', () => {
  test('a hung Valkey publish neither delays the 200 nor holds back the in-process bus', async () => {
    const workspaceId = randomUUID()
    const { resolver } = fakeResolver(actor([workspaceId]))
    const store = new InMemoryCommandStore()
    const bus = new InProcessEventBus({ epoch: 'e1' })
    const frames: RealtimeEventFrame[] = []
    bus.subscribe((_ws, frame) => frames.push(frame))
    let valkeyCalls = 0
    const hung = valkeyEventSink({ publish: () => { valkeyCalls += 1; return new Promise<never>(() => {}) } })
    const relay = new DomainEventRelay({ store, sinks: [events => { bus.publish(events) }, hung] })
    closers.push(() => relay.close())
    await relay.start()
    const service = new WorkspaceCommandService({ store, registry: createCommandRegistry(), authorizer: WORKSPACE_MEMBER_AUTHORIZER, publish: relay.publish })
    const http = await serve({ authority: unusedAuthority, actorResolver: resolver, commandBus: service })
    closers.push(http.close)
    const path = `/v1/workspaces/${workspaceId}/commands`
    for (let i = 1; i <= 2; i++) {
      const started = Date.now()
      const response = await request(http.url, path, { body: envelope('system.ping', { nonce: `n${i}` }) })
      expect(response).toMatchObject({ status: 200, body: { status: 'applied' } })
      expect(Date.now() - started).toBeLessThan(1_000)
    }
    const deadline = Date.now() + 1_000
    while (frames.length < 2 && Date.now() < deadline) await Bun.sleep(2)
    expect(frames.map(frame => frame.seq)).toEqual([1, 2]) // bus sink is independent of the hung one
    expect(valkeyCalls).toBe(1) // the Valkey loop is still stuck on its first batch
    expect(relay.sinkWatermarks(workspaceId)).toEqual([2, 0])
  })
})

describe('a poison projector', () => {
  test('is reported and skipped: later events are delivered, the watermark advances, nothing is re-sequenced', async () => {
    const store = new InMemoryCommandStore()
    const projections = new EventProjectionRegistry({ builtIns: false })
    projections.register('system.pinged', event => {
      if ((event.payload as { poison?: boolean }).poison) throw new Error('projector bug')
      return [{ topic: `user:${event.actorId}`, type: 'system.pinged', payload: {} }]
    })
    const errors: unknown[] = []
    const bus = new InProcessEventBus({ epoch: 'e1', projections, onListenerError: error => errors.push(error) })
    const frames: RealtimeEventFrame[] = []
    bus.subscribe((_ws, frame) => frames.push(frame))
    const relayErrors: unknown[] = []
    const relay = new DomainEventRelay({ store, retryBaseMs: 5, sinks: [events => { bus.publish(events) }], onError: error => relayErrors.push(error) })
    closers.push(() => relay.close())
    const commit = (events: DomainEvent[]) => store.transaction('w', tx => tx.appendEvents(events))
    await relay.publish(await commit([pinged('w', 'alice'), pinged('w', 'alice', { payload: { poison: true } }), pinged('w', 'alice')]))
    await relay.idle()
    expect(frames.map(frame => frame.seq)).toEqual([1, 2])
    expect(errors).toHaveLength(1)
    expect(relayErrors).toEqual([]) // the sink did not fail → no retry → no re-delivery
    expect(relay.watermark('w')).toBe(3)
    await relay.publish(await commit([pinged('w', 'alice')]))
    await relay.idle()
    await Bun.sleep(20)
    expect(frames.map(frame => frame.seq)).toEqual([1, 2, 3])
    expect(new Set(frames.map(frame => frame.eventId)).size).toBe(3)
  })
})

describe('identity store blip during authentication', () => {
  async function setup() {
    const { publicKey, privateKey } = await generateKeyPair('EdDSA')
    const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'EdDSA' }
    const workspaceId = randomUUID()
    const principalId = randomUUID()
    const failures = { principal: 0, memberships: 0 }
    const session: PersistedAuthSession = { issuer: 'urn:test', subject: 'sub-1', principalId, sessionId: 'session-1', deviceId: 'device-1', expiresAt: Date.now() + 600_000, revokedAt: null }
    const blip = () => Object.assign(new Error('Connection closed'), { code: 'ERR_POSTGRES_CONNECTION_CLOSED' })
    const resolver = createVerifiedActorResolver<AuthenticatedActor>(
      { issuer: 'urn:test', audience: 'rox', algorithms: ['EdDSA'], keySource: { jwks: { keys: [jwk] } } },
      {
        async resolvePrincipal() { if (failures.principal > 0) { failures.principal -= 1; throw blip() } return principalId },
        async resolveSession() { return session },
        async findSession() { return session },
      },
      { async listActiveWorkspaceIds() { if (failures.memberships > 0) { failures.memberships -= 1; throw blip() } return [workspaceId] } },
      input => ({ principalId: input.principalId, deviceId: input.deviceId, sessionId: input.sessionId, expiresAt: input.expiresAt, authenticatedWorkspaceIds: [...input.authenticatedWorkspaceIds] }),
    )
    const token = await new SignJWT({ sid: 'session-1' }).setProtectedHeader({ alg: 'EdDSA', kid: 'k1' })
      .setIssuer('urn:test').setAudience('rox').setSubject('sub-1').setExpirationTime('10m').sign(privateKey)
    const service = new WorkspaceCommandService({ store: new InMemoryCommandStore(), registry: createCommandRegistry(), authorizer: WORKSPACE_MEMBER_AUTHORIZER })
    const http = await serve({ authority: unusedAuthority, actorResolver: resolver as unknown as WorkspaceHttpOptions['actorResolver'], commandBus: service })
    closers.push(http.close)
    return { resolver, token, failures, http, path: `/v1/workspaces/${workspaceId}/commands` }
  }

  test('a repository failure is 503 on the commands route (outbox retries), a bad token stays 401', async () => {
    const f = await setup()
    f.failures.principal = 1
    expect(await request(f.http.url, f.path, { token: f.token, body: envelope('system.ping') })).toMatchObject({ status: 503, body: { error: { code: 'SERVICE_UNAVAILABLE' } } })
    f.failures.memberships = 1
    expect(await request(f.http.url, f.path, { token: f.token, body: envelope('system.ping') })).toMatchObject({ status: 503 })
    expect(await request(f.http.url, f.path, { token: 'aaa.bbb.ccc', body: envelope('system.ping') })).toMatchObject({ status: 401 })
    expect(await request(f.http.url, f.path, { token: f.token, body: envelope('system.ping') })).toMatchObject({ status: 200, body: { status: 'applied' } })
  })

  test('the error stays an AuthenticationError (401) everywhere else', async () => {
    const f = await setup()
    f.failures.principal = 1
    const error = await f.resolver.authenticate(f.token).catch(e => e)
    expect(error).toBeInstanceOf(AuthenticationUnavailableError)
    expect(error).toBeInstanceOf(AuthenticationError)
    expect(error).toMatchObject({ name: 'AuthenticationError', code: 'UNAUTHENTICATED', statusCode: 401, message: 'Authentication required' })
  })
})

class CountingCursorStore extends InMemoryRealtimeCursorStore {
  saves = 0
  batches: number[] = []
  override async save(owner: RealtimeCursorOwner, topic: string, position: RealtimeCursorPosition, policyEpoch: number) {
    this.saves += 1
    return super.save(owner, topic, position, policyEpoch)
  }
  override async saveMany(owner: RealtimeCursorOwner, entries: readonly RealtimeCursorEntry[], policyEpoch: number) {
    this.batches.push(entries.length)
    for (const entry of entries) await super.save(owner, entry.topic, entry.position, policyEpoch)
  }
}

describe('disconnect cursors', () => {
  function setup() {
    const ws = randomUUID()
    const bus = new InProcessEventBus({ epoch: 'e1' })
    const live = new Set<string>()
    const disconnect = new Set<(id: string) => void>()
    const transport: RealtimePushTransport = {
      async pushToWorkspaceClient(clientId) { return live.has(clientId) },
      onClientDisconnect(listener) { disconnect.add(listener); return () => disconnect.delete(listener) },
    }
    const cursors = new CountingCursorStore()
    const gateway = new RealtimeGateway({ bus, transport, authorizer: WORKSPACE_MEMBER_AUTHORIZER, cursors })
    closers.push(() => gateway.close())
    const ctx = (clientId: string) => { live.add(clientId); return { clientId, workspaceId: ws, principalId: 'alice', deviceKey: `dev-${clientId}` } }
    const close = (id: string) => { live.delete(id); for (const l of disconnect) l(id) }
    const topics = ['user:alice', 'entity:task:t1', 'entity:task:t2'].map(topic => ({ topic }))
    return { gateway, cursors, ctx, close, topics }
  }

  test('a resume client\'s cursors are written in one batch; clients without resume write nothing', async () => {
    const g = setup()
    await g.gateway.subscribe(g.ctx('c1'), { topics: g.topics, resume: true })
    await g.gateway.subscribe(g.ctx('c2'), { topics: g.topics })
    await g.gateway.unsubscribe(g.ctx('c2'), { topics: ['entity:task:t2'] })
    g.close('c1')
    g.close('c2')
    await Bun.sleep(10)
    expect(g.cursors.batches).toEqual([3])
    expect(g.cursors.saves).toBe(0) // no per-topic writes: one multi-row batch
  })

  test('unsubscribe of a resume client still saves that topic', async () => {
    const g = setup()
    await g.gateway.subscribe(g.ctx('c1'), { topics: g.topics.slice(0, 1) })
    await g.gateway.subscribe(g.ctx('c1'), { topics: g.topics.slice(1), resume: true }) // opting in later counts
    await g.gateway.unsubscribe(g.ctx('c1'), { topics: ['entity:task:t1'] })
    expect(g.cursors.saves).toBe(1)
    g.close('c1')
    await Bun.sleep(10)
    expect(g.cursors.batches).toEqual([2])
  })
})

describe('runtime: idle replay windows are swept on a timer', () => {
  test('an unref\'d interval calls bus.evictIdle(); close() clears it', async () => {
    const commandBus = createWorkspaceCommandBus({} as SQL, 'public', { store: new InMemoryCommandStore(), cursors: null, evictIntervalMs: 5 })
    await commandBus.ready
    let sweeps = 0
    commandBus.bus.evictIdle = () => { sweeps += 1; return 0 }
    await Bun.sleep(40)
    expect(sweeps).toBeGreaterThan(1)
    commandBus.close()
    const after = sweeps
    await Bun.sleep(30)
    expect(sweeps).toBe(after)
  })
})

describe('Postgres transient classification walks error.cause', () => {
  test('a wrapped deadlock / connection loss is retryable; wrapped 25P02 / constraint errors are not', () => {
    const pg = (errno: string) => Object.assign(new Error(`pg ${errno}`), { errno, code: 'ERR_POSTGRES_SERVER_ERROR' })
    expect(isTransientPostgresError(new Error('repository failed', { cause: pg('40P01') }))).toBe(true)
    expect(isTransientPostgresError(new Error('a', { cause: new Error('b', { cause: { code: 'ERR_POSTGRES_CONNECTION_CLOSED' } }) }))).toBe(true)
    expect(isTransientPostgresError(new AggregateError([new Error('x'), pg('40001')]))).toBe(true)
    expect(isTransientPostgresError(pg('25P02'))).toBe(false)
    expect(isTransientPostgresError(new Error('repository failed', { cause: pg('25P02') }))).toBe(false)
    expect(isTransientPostgresError(new Error('repository failed', { cause: pg('23505') }))).toBe(false)
  })
})
