/**
 * W1-03 (#1500) — workspace command bus without Postgres: HTTP route, negative
 * paths, realtime gateway (topic ACL, per-delivery revalidation, replay,
 * snapshot_required, cursors), relay and Valkey sink.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { PLACEHOLDER_PAYLOAD_SCHEMA, type CommandRegistry } from '../../../packages/core/src/commands/index.ts'
import type { RealtimeEventFrame } from '../../../packages/core/src/events/index.ts'
import { InMemoryCommandStore } from '../../../packages/server-core/src/commands/store.ts'
import { InProcessEventBus } from '../../../packages/server-core/src/commands/event-bus.ts'
import { createCommandRegistry } from '../../../packages/server-core/src/commands/registry.ts'
import type { SharedProjectAuthority } from '../../../packages/shared/src/workspace-domain/identity/contracts.ts'
import { WorkspaceCommandService } from '../src/modules/commands/service.ts'
import { WORKSPACE_MEMBER_AUTHORIZER, type WorkspaceAuthorizer } from '../src/modules/commands/authorizer.ts'
import { DomainEventRelay } from '../src/modules/events/relay.ts'
import { valkeyEventSink } from '../src/modules/events/valkey.ts'
import { RealtimeGateway, type RealtimePushTransport } from '../src/modules/realtime/gateway.ts'
import { InMemoryRealtimeCursorStore } from '../src/modules/realtime/cursor-store.ts'
import { actor, fakeResolver, request, serve } from './helpers.ts'

const closers: Array<() => Promise<void> | void> = []
afterEach(async () => { for (const close of closers.splice(0).reverse()) await close() })

const unusedAuthority = new Proxy({}, { get: () => () => { throw new Error('not used') } }) as SharedProjectAuthority

function testRegistry(): { registry: CommandRegistry; calls: { n: number; revision: number } } {
  const registry = createCommandRegistry()
  const calls = { n: 0, revision: 0 }
  const define = (type: string) => registry.define({ type: type as `${string}.${string}`, module: 'test', authority: 'workspace', verb: 'write', schema: PLACEHOLDER_PAYLOAD_SCHEMA, schemaBound: false })
  define('test.bump')
  define('test.unbound')
  registry.bind('test.bump', ctx => {
    if (ctx.envelope.expectedRevision !== undefined && ctx.envelope.expectedRevision !== calls.revision) ctx.conflict(calls.revision)
    calls.n += 1
    calls.revision += 1
    return { ref: { kind: 'task', id: 'bump' }, revision: calls.revision, events: [{ type: 'task.task_status_change' }] }
  })
  return { registry, calls }
}

async function setup(options: { bus?: boolean; authorizer?: WorkspaceAuthorizer; maxBodyBytes?: number } = {}) {
  const workspaceId = randomUUID()
  const owner = actor([workspaceId])
  const { resolver, state } = fakeResolver(owner)
  const store = new InMemoryCommandStore()
  const eventBus = new InProcessEventBus({ epoch: 'epoch-1' })
  const relay = new DomainEventRelay({ store, sinks: [events => { eventBus.publish(events) }] })
  const { registry, calls } = testRegistry()
  const service = new WorkspaceCommandService({ store, registry, authorizer: options.authorizer ?? WORKSPACE_MEMBER_AUTHORIZER, publish: relay.publish })
  const http = await serve({
    authority: unusedAuthority,
    actorResolver: resolver,
    ...(options.maxBodyBytes ? { maxBodyBytes: options.maxBodyBytes } : {}),
    ...(options.bus === false ? {} : { commandBus: service }),
  })
  closers.push(http.close)
  const path = `/v1/workspaces/${workspaceId}/commands`
  const post = (body: unknown, extra: Parameters<typeof request>[2] = {}) => request(http.url, path, { body, ...extra })
  return { workspaceId, owner, state, store, eventBus, relay, calls, http, path, post }
}

const envelope = (type: string, payload: unknown = {}, extra: Record<string, unknown> = {}) =>
  ({ commandId: randomUUID(), type, payload, issuedAt: new Date().toISOString(), ...extra })

describe('POST /v1/workspaces/{ws}/commands', () => {
  test('without the opt-in the route does not exist (404, as on main)', async () => {
    const f = await setup({ bus: false })
    expect(await f.post(envelope('system.ping'))).toMatchObject({ status: 404, body: { error: { code: 'NOT_FOUND' } } })
    expect(await request(f.http.url, f.path)).toMatchObject({ status: 404 })
  })

  test('system.ping: 200 + applied receipt + stored system.pinged event; replay → duplicate, one effect', async () => {
    const f = await setup()
    const frames: RealtimeEventFrame[] = []
    f.eventBus.subscribe((_ws, frame) => frames.push(frame))
    const ping = envelope('system.ping', { nonce: 'n1' })
    const first = await f.post(ping)
    expect(first.status).toBe(200)
    expect(first.body).toMatchObject({ commandId: ping.commandId, status: 'applied', result: { pong: true, nonce: 'n1', authority: 'workspace' } })
    const events = await f.store.listEvents(f.workspaceId)
    expect(events).toEqual([expect.objectContaining({ type: 'system.pinged', actorId: f.owner.principalId, causationId: ping.commandId, sequence: 1 })])
    expect(frames).toEqual([expect.objectContaining({ topic: `user:${f.owner.principalId}`, type: 'system.pinged', seq: 1, payload: { commandId: ping.commandId, nonce: 'n1' } })])
    const again = await f.post(ping)
    expect(again).toMatchObject({ status: 200, body: { status: 'duplicate', original: first.body } })
    expect(f.store.counts()).toEqual({ receipts: 1, events: 1 })
    expect(frames).toHaveLength(1)
  })

  test('negative receipts: VALIDATION, unknown command, unbound handler, conflict, oversized payload, LOCAL_ONLY, idempotency reuse', async () => {
    const f = await setup()
    expect((await f.post({ type: 'system.ping' })).body).toMatchObject({ status: 'rejected', error: { code: 'VALIDATION' } })
    expect((await f.post(envelope('system.ping', { nonce: 1 }))).body).toMatchObject({ status: 'rejected', error: { code: 'VALIDATION' } })
    expect((await f.post({ ...envelope('system.ping'), actorId: 'spoofed' })).body).toMatchObject({ error: { code: 'VALIDATION' } })
    expect((await f.post(envelope('nope.never'))).body).toMatchObject({ status: 'rejected', error: { code: 'UNKNOWN_COMMAND' } })
    expect((await f.post(envelope('test.unbound'))).body).toMatchObject({ status: 'rejected', error: { code: 'NOT_BOUND' } })
    expect((await f.post(envelope('tasks.update_status'))).body).toMatchObject({ status: 'rejected', error: { code: 'UNAVAILABLE' } })
    await f.post(envelope('test.bump'))
    expect((await f.post(envelope('test.bump', {}, { expectedRevision: 0 }))).body).toMatchObject({ status: 'conflict', conflict: { currentRevision: 1 } })
    expect((await f.post(envelope('system.ping', { nonce: 'x'.repeat(5000) }))).body).toMatchObject({ status: 'rejected', error: { code: 'PAYLOAD_TOO_LARGE' } })
    const localOnly = createCommandRegistry().list().find(def => def.authority === 'local')!
    expect((await f.post(envelope(localOnly.type))).body).toMatchObject({ status: 'rejected', error: { code: 'LOCAL_ONLY' } })
    const reused = envelope('system.ping', { nonce: 'a' })
    await f.post(reused)
    expect((await f.post({ ...reused, payload: { nonce: 'b' } })).body).toMatchObject({ status: 'rejected', error: { code: 'IDEMPOTENCY_KEY_REUSED' } })
    expect(f.calls.n).toBe(1)
  })

  test('FORBIDDEN: authorizer deny is a receipt; a non-member gets HTTP 403 and no effect', async () => {
    const denyAll: WorkspaceAuthorizer = { can: async () => false, canReadTopic: async () => false }
    const f = await setup({ authorizer: denyAll })
    expect((await f.post(envelope('test.bump'))).body).toMatchObject({ status: 'rejected', error: { code: 'FORBIDDEN' } })
    f.state.actor = actor([randomUUID()], f.owner.principalId)
    expect(await f.post(envelope('system.ping'))).toEqual({ status: 403, body: { error: { code: 'FORBIDDEN' } }, allow: null })
    expect(f.store.counts()).toEqual({ receipts: 0, events: 0 })
  })

  test('HTTP-level errors: 401, 405, 400 workspace id, 415, 400 JSON, 413 body', async () => {
    const f = await setup({ maxBodyBytes: 2048 })
    expect(await f.post(envelope('system.ping'), { token: null })).toMatchObject({ status: 401, body: { error: { code: 'UNAUTHENTICATED' } } })
    expect(await request(f.http.url, f.path, { method: 'GET' })).toMatchObject({ status: 405, allow: 'POST' })
    expect(await request(f.http.url, '/v1/workspaces/not-a-uuid/commands', { body: envelope('system.ping') })).toMatchObject({ status: 400, body: { error: { code: 'INVALID_PAYLOAD' } } })
    expect(await f.post(undefined, { raw: '{}', contentType: 'text/plain' })).toMatchObject({ status: 415 })
    expect(await f.post(undefined, { raw: '{oops' })).toMatchObject({ status: 400, body: { error: { code: 'INVALID_PAYLOAD' } } })
    expect(await f.post(envelope('system.ping', { nonce: 'x'.repeat(4000) }))).toMatchObject({ status: 413, body: { error: { code: 'BODY_TOO_LARGE' } } })
    expect(await request(f.http.url, f.path + '?x=1', { body: envelope('system.ping') })).toMatchObject({ status: 400 })
  })

  test('a session revoked while the command runs gets no receipt back', async () => {
    const f = await setup()
    f.state.revokeAfter = 1 // the post-execution revalidation fails
    expect(await f.post(envelope('system.ping'))).toMatchObject({ status: 401, body: { error: { code: 'UNAUTHENTICATED' } } })
  })
})

/** Transport double: records deliveries; the guard runs like WsRpcServer's. */
function fakeTransport() {
  const sessions = new Map<string, { principalId: string; workspaceId: string; live: boolean }>()
  const delivered: Array<{ clientId: string; frame: RealtimeEventFrame }> = []
  const disconnect = new Set<(id: string) => void>()
  const transport: RealtimePushTransport = {
    async pushToWorkspaceClient(clientId, workspaceId, channel, args, guard) {
      const session = sessions.get(clientId)
      if (!session || !session.live || session.workspaceId !== workspaceId || channel !== 'realtime:event') return false
      if (guard && !(await guard({ principalId: session.principalId }))) return false
      delivered.push({ clientId, frame: args[1] as RealtimeEventFrame })
      return true
    },
    onClientDisconnect(listener) { disconnect.add(listener); return () => disconnect.delete(listener) },
  }
  return { transport, sessions, delivered, disconnect: (id: string) => { for (const l of disconnect) l(id) } }
}

describe('RealtimeGateway', () => {
  function gatewaySetup(authorizer: WorkspaceAuthorizer = WORKSPACE_MEMBER_AUTHORIZER, capacity = 100) {
    const ws = randomUUID()
    const bus = new InProcessEventBus({ epoch: 'e1', capacity })
    const t = fakeTransport()
    const cursors = new InMemoryRealtimeCursorStore()
    const gateway = new RealtimeGateway({ bus, transport: t.transport, authorizer, cursors })
    closers.push(() => gateway.close())
    const alice = { clientId: 'c-alice', workspaceId: ws, principalId: 'alice' }
    const bob = { clientId: 'c-bob', workspaceId: ws, principalId: 'bob' }
    t.sessions.set('c-alice', { principalId: 'alice', workspaceId: ws, live: true })
    t.sessions.set('c-bob', { principalId: 'bob', workspaceId: ws, live: true })
    const pinged = (principal: string, n: number) => bus.publish([{ eventId: randomUUID(), workspaceId: ws, type: 'system.pinged', actorId: principal, causationId: `cmd-${n}`, aggregateRevision: 0, payload: {}, createdAt: 'now' }])
    const touched = (id: string) => bus.publish([{ eventId: randomUUID(), workspaceId: ws, type: 'task.task_name_updating', subject: { kind: 'task', id }, aggregateRevision: 1, payload: { name: 'secret' }, createdAt: 'now' }])
    return { ws, bus, t, gateway, alice, bob, pinged, touched, cursors }
  }

  test('topic ACL: own user topic allowed, others denied; invalid topics flagged', async () => {
    const g = gatewaySetup()
    const result = await g.gateway.subscribe(g.alice, { topics: [{ topic: 'user:alice' }, { topic: 'user:bob' }, { topic: `workspace:${randomUUID()}` }, { topic: 'nope:1' }] })
    expect(result.topics.map(t => [t.topic, t.status])).toEqual([
      ['user:alice', 'subscribed'], ['user:bob', 'forbidden'], [expect.stringMatching(/^workspace:/), 'forbidden'], ['nope:1', 'invalid'],
    ])
    g.pinged('bob', 1)
    g.pinged('alice', 2)
    await g.gateway.flush()
    expect(g.t.delivered.map(d => [d.clientId, d.frame.topic])).toEqual([['c-alice', 'user:alice']])
  })

  test('entity topics: authorizer deny on subscribe and per delivery; payload is ids only', async () => {
    let allowBob = true
    const authorizer: WorkspaceAuthorizer = {
      can: async () => true,
      canReadTopic: async (p, target) => target.kind !== 'entity' || p.principalId === 'alice' || allowBob,
    }
    const g = gatewaySetup(authorizer)
    await g.gateway.subscribe(g.alice, { topics: [{ topic: 'entity:task:t1' }] })
    await g.gateway.subscribe(g.bob, { topics: [{ topic: 'entity:task:t1' }] })
    g.touched('t1')
    await g.gateway.flush()
    expect(g.t.delivered.map(d => d.clientId).sort()).toEqual(['c-alice', 'c-bob'])
    expect(JSON.stringify(g.t.delivered)).not.toContain('secret')
    allowBob = false // ACL revoked after subscribe
    g.touched('t1')
    await g.gateway.flush()
    expect(g.t.delivered.filter(d => d.clientId === 'c-bob')).toHaveLength(1)
    expect(g.t.delivered.filter(d => d.clientId === 'c-alice')).toHaveLength(2)
    const denied = await g.gateway.subscribe({ ...g.bob, clientId: 'c-bob-2' }, { topics: [{ topic: 'entity:task:t1' }] })
    expect(denied.topics[0]!.status).toBe('forbidden')
  })

  test('a revoked session (transport revalidation fails) receives nothing', async () => {
    const g = gatewaySetup()
    await g.gateway.subscribe(g.alice, { topics: [{ topic: 'user:alice' }] })
    g.t.sessions.get('c-alice')!.live = false
    g.pinged('alice', 1)
    await g.gateway.flush()
    expect(g.t.delivered).toEqual([])
  })

  test('seq gap recovery: resubscribe with sinceSeq replays exactly the missed frames', async () => {
    const g = gatewaySetup()
    await g.gateway.subscribe(g.alice, { topics: [{ topic: 'user:alice' }] })
    g.pinged('alice', 1)
    await g.gateway.flush()
    g.t.sessions.get('c-alice')!.live = false // frames 2 and 3 are lost
    g.pinged('alice', 2)
    g.pinged('alice', 3)
    await g.gateway.flush()
    g.t.sessions.get('c-alice')!.live = true
    const result = await g.gateway.subscribe(g.alice, { topics: [{ topic: 'user:alice', sinceSeq: 1, epoch: 'e1' }] })
    expect(result.topics[0]).toMatchObject({ status: 'subscribed', seq: 3, epoch: 'e1' })
    expect(result.topics[0]!.frames!.map(f => f.seq)).toEqual([2, 3])
    g.pinged('alice', 4)
    await g.gateway.flush()
    expect(g.t.delivered.map(d => d.frame.seq)).toEqual([1, 4])
  })

  test('snapshot_required beyond the window or after an epoch change', async () => {
    const g = gatewaySetup(WORKSPACE_MEMBER_AUTHORIZER, 2)
    for (let n = 1; n <= 5; n++) g.pinged('alice', n)
    expect((await g.gateway.subscribe(g.alice, { topics: [{ topic: 'user:alice', sinceSeq: 1, epoch: 'e1' }] })).topics[0]).toMatchObject({ status: 'snapshot_required', seq: 5 })
    expect((await g.gateway.subscribe(g.alice, { topics: [{ topic: 'user:alice', sinceSeq: 3, epoch: 'e1' }] })).topics[0]!.frames!.map(f => f.seq)).toEqual([4, 5])
    expect((await g.gateway.subscribe(g.alice, { topics: [{ topic: 'user:alice', sinceSeq: 5, epoch: 'old' }] })).topics[0]).toMatchObject({ status: 'snapshot_required' })
  })

  test('server-side cursor: disconnect stores the position, resume replays from it', async () => {
    const g = gatewaySetup()
    await g.gateway.subscribe(g.alice, { topics: [{ topic: 'user:alice' }] })
    g.pinged('alice', 1)
    await g.gateway.flush()
    g.t.disconnect('c-alice')
    await Bun.sleep(5)
    expect(g.gateway.subscriberCount()).toBe(0)
    g.pinged('alice', 2)
    const resumed = await g.gateway.subscribe({ ...g.alice, clientId: 'c-alice-2' }, { topics: [{ topic: 'user:alice' }], resume: true })
    expect(resumed.topics[0]!.frames!.map(f => f.seq)).toEqual([2])
    expect(await g.gateway.unsubscribe({ ...g.alice, clientId: 'c-alice-2' }, { topics: ['user:alice'] })).toEqual({ topics: ['user:alice'] })
    await expect(g.gateway.subscribe(g.alice, { topics: [] })).rejects.toThrow()
  })
})

describe('events relay + Valkey sink', () => {
  test('relay delivers in sequence order and re-delivers after a sink failure', async () => {
    const store = new InMemoryCommandStore()
    let fail = true
    const seen: number[] = []
    const errors: unknown[] = []
    const relay = new DomainEventRelay({ store, sinks: [events => { if (fail) throw new Error('down'); seen.push(...events.map(e => e.sequence!)) }], onError: e => errors.push(e) })
    const append = async (n: number) => {
      const events = await store.transaction('w', async tx => tx.appendEvents([{ eventId: `e${n}`, workspaceId: 'w', type: 'system.pinged', aggregateRevision: 0, payload: {}, createdAt: 'now' }]))
      await relay.publish(events)
    }
    await append(1)
    expect(errors).toHaveLength(1)
    expect(relay.watermark('w')).toBe(0)
    fail = false
    await append(2)
    expect(seen).toEqual([1, 2])
    expect(relay.watermark('w')).toBe(2)
  })

  test('valkey sink publishes ids only, per workspace channel', async () => {
    const published: Array<[string, string]> = []
    await valkeyEventSink({ publish: (c, m) => { published.push([c, m]) } })([
      { eventId: 'e1', sequence: 7, workspaceId: 'w1', type: 'task.task_name_updating', subject: { kind: 'task', id: 't' }, aggregateRevision: 2, payload: { name: 'secret' }, createdAt: 'now' },
    ])
    expect(published).toHaveLength(1)
    expect(published[0]![0]).toBe('rox:events:w1')
    expect(JSON.parse(published[0]![1])).toEqual({ eventId: 'e1', sequence: 7, type: 'task.task_name_updating', subject: { kind: 'task', id: 't' }, aggregateRevision: 2, actorId: null, causationId: null })
    expect(published[0]![1]).not.toContain('secret')
  })
})
