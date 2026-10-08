/**
 * W1-03 (#1500) review 1 regressions (no Postgres): store outage → HTTP 503,
 * relay per-sink watermarks + backoff retry + startup watermark, gateway
 * liveness / per-client topic cap / revalidation cache, per-device cursors.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import type { DomainEvent, RealtimeEventFrame, TopicAclTarget } from '../../../packages/core/src/events/index.ts'
import { CommandStoreUnavailable, InMemoryCommandStore, type CommandStore } from '../../../packages/server-core/src/commands/store.ts'
import { InProcessEventBus } from '../../../packages/server-core/src/commands/event-bus.ts'
import { createCommandRegistry } from '../../../packages/server-core/src/commands/registry.ts'
import type { SharedProjectAuthority } from '../../../packages/shared/src/workspace-domain/identity/contracts.ts'
import { WorkspaceCommandService } from '../src/modules/commands/service.ts'
import { WORKSPACE_MEMBER_AUTHORIZER, type WorkspaceAuthorizer } from '../src/modules/commands/authorizer.ts'
import { commandLockKeys, isTransientPostgresError } from '../src/modules/commands/store.ts'
import { DomainEventRelay } from '../src/modules/events/relay.ts'
import { RealtimeGateway, type RealtimePushTransport } from '../src/modules/realtime/gateway.ts'
import { InMemoryRealtimeCursorStore, cursorId } from '../src/modules/realtime/cursor-store.ts'
import { actor, fakeResolver, request, serve } from './helpers.ts'

const closers: Array<() => Promise<void> | void> = []
afterEach(async () => { for (const close of closers.splice(0).reverse()) await close() })
const unusedAuthority = new Proxy({}, { get: () => () => { throw new Error('not used') } }) as SharedProjectAuthority
const envelope = (type: string, payload: unknown = {}, extra: Record<string, unknown> = {}) =>
  ({ commandId: randomUUID(), type, payload, issuedAt: new Date().toISOString(), ...extra })
const pinged = (ws: string, actorId: string): DomainEvent => ({ eventId: randomUUID(), workspaceId: ws, type: 'system.pinged', actorId, aggregateRevision: 0, payload: {}, createdAt: 'now' })

describe('route: a store outage is 503, not a terminal receipt', () => {
  test('connection lost → 503 SERVICE_UNAVAILABLE, nothing stored; the same envelope then applies', async () => {
    const workspaceId = randomUUID()
    const { resolver } = fakeResolver(actor([workspaceId]))
    const inner = new InMemoryCommandStore()
    let down = true
    const store: CommandStore = {
      transaction: (ws, fn) => down ? Promise.reject(Object.assign(new Error('Connection closed'), { code: 'ERR_POSTGRES_CONNECTION_CLOSED' })) : inner.transaction(ws, fn),
      findReceipt: (...args) => inner.findReceipt(...args),
      listEvents: (...args) => inner.listEvents(...args),
    }
    const errors: unknown[] = []
    const service = new WorkspaceCommandService({ store, registry: createCommandRegistry(), authorizer: WORKSPACE_MEMBER_AUTHORIZER, onError: e => errors.push(e) })
    await expect(service.execute(actor([workspaceId]), workspaceId, envelope('system.ping'))).rejects.toBeInstanceOf(CommandStoreUnavailable)
    const http = await serve({ authority: unusedAuthority, actorResolver: resolver, commandBus: service })
    closers.push(http.close)
    const ping = envelope('system.ping', { nonce: 'n' })
    const path = `/v1/workspaces/${workspaceId}/commands`
    expect(await request(http.url, path, { body: ping })).toMatchObject({ status: 503, body: { error: { code: 'SERVICE_UNAVAILABLE' } } })
    expect(inner.counts()).toEqual({ receipts: 0, events: 0 })
    down = false
    expect(await request(http.url, path, { body: ping })).toMatchObject({ status: 200, body: { status: 'applied' } })
    expect(errors.length).toBeGreaterThanOrEqual(2)
  })
})

describe('Postgres store helpers', () => {
  test('advisory lock keys are distinct and canonically sorted (crossed envelopes lock in one order)', () => {
    const a = '00000000-0000-4000-8000-00000000000a'
    const b = '00000000-0000-4000-8000-00000000000b'
    expect(commandLockKeys('s', 'w', a, b)).toEqual(commandLockKeys('s', 'w', b, a))
    expect(commandLockKeys('s', 'w', a, a)).toHaveLength(1)
  })

  test('transient classification: connection / deadlock / serialization yes, constraint or syntax no', () => {
    for (const errno of ['40P01', '40001', '08006', '57P01', '53300', '55P03']) expect(isTransientPostgresError({ errno, code: 'ERR_POSTGRES_SERVER_ERROR' })).toBe(true)
    expect(isTransientPostgresError({ code: 'ERR_POSTGRES_CONNECTION_CLOSED' })).toBe(true)
    expect(isTransientPostgresError({ code: 'ECONNRESET' })).toBe(true)
    for (const errno of ['23505', '42601', '22P02']) expect(isTransientPostgresError({ errno, code: 'ERR_POSTGRES_SERVER_ERROR' })).toBe(false)
    expect(isTransientPostgresError(new TypeError('x is undefined'))).toBe(false)
  })
})

describe('DomainEventRelay', () => {
  async function commit(store: InMemoryCommandStore, ws: string, n = 1) {
    return store.transaction(ws, tx => tx.appendEvents(Array.from({ length: n }, () => pinged(ws, 'alice'))))
  }

  test('sink failure → no duplicate frames on the bus; the failed sink is retried with backoff without a new commit', async () => {
    const store = new InMemoryCommandStore()
    const bus = new InProcessEventBus({ epoch: 'e1' })
    const frames: RealtimeEventFrame[] = []
    bus.subscribe((_ws, frame) => frames.push(frame))
    const valkey: number[] = []
    let valkeyDown = 2
    const errors: unknown[] = []
    const relay = new DomainEventRelay({
      store,
      retryBaseMs: 5,
      sinks: [events => { bus.publish(events) }, events => { if (valkeyDown > 0) { valkeyDown -= 1; throw new Error('valkey down') } valkey.push(...events.map(e => e.sequence!)) }],
      onError: e => errors.push(e),
    })
    closers.push(() => relay.close())
    await relay.publish(await commit(store, 'w', 2))
    await relay.idle()
    expect(frames.map(f => f.seq)).toEqual([1, 2])
    expect(relay.sinkWatermarks('w')).toEqual([2, 0])
    await relay.publish(await commit(store, 'w')) // the bus must not see 1, 2 again
    await relay.idle()
    expect(frames.map(f => [f.seq, f.eventId])).toEqual([[1, frames[0]!.eventId], [2, frames[1]!.eventId], [3, frames[2]!.eventId]])
    expect(new Set(frames.map(f => f.eventId)).size).toBe(3)
    // Quiet workspace: the scheduled retry delivers to Valkey on its own.
    const deadline = Date.now() + 2000
    while (valkey.length < 3 && Date.now() < deadline) await Bun.sleep(5)
    expect(valkey).toEqual([1, 2, 3])
    expect(frames).toHaveLength(3)
    expect(relay.watermark('w')).toBe(3)
    expect(errors).toHaveLength(2)
  })

  test('startup watermark comes from the committed max: out-of-order first publishes lose nothing and replay nothing old', async () => {
    const store = new InMemoryCommandStore()
    await commit(store, 'w', 2) // committed before this process started relaying
    const seen: number[] = []
    const relay = new DomainEventRelay({ store, sinks: [events => { seen.push(...events.map(e => e.sequence!)) }] })
    closers.push(() => relay.close())
    await relay.start()
    const third = await commit(store, 'w')
    const fourth = await commit(store, 'w')
    await relay.publish(fourth) // seq 4 publishes before seq 3
    await relay.publish(third)
    await relay.idle()
    expect(seen).toEqual([3, 4])
    await relay.publish(await commit(store, 'fresh-workspace'))
    await relay.idle()
    expect(seen).toEqual([3, 4, 1])
  })
})

function fakeTransport() {
  const live = new Map<string, { principalId: string; workspaceId: string }>()
  const delivered: Array<{ clientId: string; frame: RealtimeEventFrame }> = []
  const options: unknown[] = []
  const disconnect = new Set<(id: string) => void>()
  const transport: RealtimePushTransport = {
    async pushToWorkspaceClient(clientId, workspaceId, _channel, args, guard, pushOptions) {
      options.push(pushOptions)
      const session = live.get(clientId)
      if (!session || session.workspaceId !== workspaceId) return false
      if (guard && !(await guard({ principalId: session.principalId }))) return false
      delivered.push({ clientId, frame: args[1] as RealtimeEventFrame })
      return true
    },
    onClientDisconnect(listener) { disconnect.add(listener); return () => disconnect.delete(listener) },
  }
  return { transport, live, delivered, options, close: (id: string) => { live.delete(id); for (const l of disconnect) l(id) } }
}

describe('RealtimeGateway lifetime, limits and caching', () => {
  function setup(authorizer: WorkspaceAuthorizer = WORKSPACE_MEMBER_AUTHORIZER, extra: Partial<ConstructorParameters<typeof RealtimeGateway>[0]> = {}) {
    const ws = randomUUID()
    const bus = new InProcessEventBus({ epoch: 'e1' })
    const t = fakeTransport()
    const cursors = new InMemoryRealtimeCursorStore()
    const gateway = new RealtimeGateway({ bus, transport: t.transport, authorizer, cursors, ...extra })
    closers.push(() => gateway.close())
    t.live.set('c1', { principalId: 'alice', workspaceId: ws })
    const ctx = { clientId: 'c1', workspaceId: ws, principalId: 'alice', deviceKey: 'laptop', isCurrent: () => t.live.has('c1') }
    return { ws, bus, t, gateway, ctx, cursors }
  }

  test('a client that disconnects while its ACL check is pending gets no subscription', async () => {
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const g = setup({ can: async () => true, canReadTopic: async () => { await gate; return true } })
    const pending = g.gateway.subscribe(g.ctx, { topics: [{ topic: 'user:alice' }] })
    g.t.close('c1') // disconnect hook runs before the subscription would be inserted
    release()
    await expect(pending).rejects.toThrow()
    expect(g.gateway.subscriberCount()).toBe(0)
    g.bus.publish([pinged(g.ws, 'alice')])
    await g.gateway.flush()
    expect(g.t.options).toEqual([]) // nothing is pushed for the dead client
  })

  test('topics per client are capped across subscribe calls', async () => {
    const g = setup(WORKSPACE_MEMBER_AUTHORIZER, { maxTopicsPerClient: 2 })
    expect((await g.gateway.subscribe(g.ctx, { topics: [{ topic: 'entity:task:t1' }, { topic: 'entity:task:t2' }] })).topics.map(t => t.status)).toEqual(['subscribed', 'subscribed'])
    const more = await g.gateway.subscribe(g.ctx, { topics: [{ topic: 'entity:task:t3' }, { topic: 'entity:task:t1' }] })
    expect(more.topics.map(t => [t.topic, t.status])).toEqual([['entity:task:t3', 'limit_exceeded'], ['entity:task:t1', 'subscribed']])
    await g.gateway.unsubscribe(g.ctx, { topics: ['entity:task:t2'] })
    expect((await g.gateway.subscribe(g.ctx, { topics: [{ topic: 'entity:task:t3' }] })).topics[0]!.status).toBe('subscribed')
  })

  test('fan-out reuses session + ACL checks for 5 s, then re-checks (and stops after a revoke)', async () => {
    let now = 1_000
    let allow = true
    const checks: TopicAclTarget[] = []
    const g = setup({ can: async () => true, canReadTopic: async (_p, target) => { checks.push(target); return allow } }, { now: () => now })
    await g.gateway.subscribe(g.ctx, { topics: [{ topic: 'entity:task:t1' }] })
    checks.length = 0
    const touch = () => g.bus.publish([{ ...pinged(g.ws, 'alice'), type: 'task.task_name_updating', subject: { kind: 'task', id: 't1' } }])
    for (let i = 0; i < 3; i++) touch()
    await g.gateway.flush()
    expect(g.t.delivered).toHaveLength(3)
    expect(checks).toHaveLength(1) // one ACL read for three frames
    expect(g.t.options.every(o => (o as { reuseVerifiedSessionMs?: number }).reuseVerifiedSessionMs === 5000)).toBe(true)
    allow = false
    now += 4_000
    touch()
    await g.gateway.flush()
    expect(g.t.delivered).toHaveLength(4) // still inside the cache window
    now += 1_500
    touch()
    await g.gateway.flush()
    expect(g.t.delivered).toHaveLength(4) // re-checked: denied
    expect(checks).toHaveLength(2)
  })

  test('resume cursors are per device: two devices of one principal keep their own positions', async () => {
    const g = setup(WORKSPACE_MEMBER_AUTHORIZER, { revalidationCacheMs: 0 })
    g.t.live.set('c2', { principalId: 'alice', workspaceId: g.ws })
    const phone = { clientId: 'c2', workspaceId: g.ws, principalId: 'alice', deviceKey: 'phone' }
    await g.gateway.subscribe(g.ctx, { topics: [{ topic: 'user:alice' }], resume: true })
    g.bus.publish([pinged(g.ws, 'alice')])
    await g.gateway.flush()
    g.t.close('c1') // laptop saw seq 1
    await Bun.sleep(5)
    await g.gateway.subscribe(phone, { topics: [{ topic: 'user:alice' }], resume: true })
    g.bus.publish([pinged(g.ws, 'alice')])
    g.bus.publish([pinged(g.ws, 'alice')])
    await g.gateway.flush()
    g.t.close('c2') // phone saw seq 3, must not overwrite the laptop's cursor
    await Bun.sleep(5)
    g.t.live.set('c3', { principalId: 'alice', workspaceId: g.ws })
    const laptop = await g.gateway.subscribe({ ...g.ctx, clientId: 'c3', isCurrent: () => true }, { topics: [{ topic: 'user:alice' }], resume: true })
    expect(laptop.topics[0]!.frames!.map(f => f.seq)).toEqual([2, 3])
    g.t.live.set('c4', { principalId: 'alice', workspaceId: g.ws })
    const phoneAgain = await g.gateway.subscribe({ ...phone, clientId: 'c4' }, { topics: [{ topic: 'user:alice' }], resume: true })
    expect(phoneAgain.topics[0]).toMatchObject({ status: 'subscribed', seq: 3 })
    expect(phoneAgain.topics[0]!.frames).toBeUndefined()
    const owner = { workspaceId: g.ws, principalId: 'alice' }
    expect(cursorId({ ...owner, deviceKey: 'laptop' }, 'user:alice')).not.toBe(cursorId({ ...owner, deviceKey: 'phone' }, 'user:alice'))
    expect(cursorId({ ...owner, deviceKey: 'laptop' }, 'user:alice')).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })
})
