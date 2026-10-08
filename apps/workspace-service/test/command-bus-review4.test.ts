/**
 * W1-03 (#1500) review 4 regressions (no Postgres server needed): a transient
 * middleware error is a retryable 503 (the outbox keeps the command), the
 * session-termination SQLSTATEs (57P05, 25P03, 25P04) are transient — also in
 * the opened-transaction path — and live gateway subscriptions retain a quiet
 * workspace's log through idle sweeps (resubscribe stays `up_to_date`).
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { createCommandEnvelope, type CommandMiddleware } from '../../../packages/core/src/commands/index.ts'
import type { DomainEvent } from '../../../packages/core/src/events/index.ts'
import { CommandStoreUnavailable, InMemoryCommandStore, type CommandStoreTransaction } from '../../../packages/server-core/src/commands/store.ts'
import { InProcessEventBus } from '../../../packages/server-core/src/commands/event-bus.ts'
import { WorkspaceCommandHttpClient, WorkspaceCommandSync } from '../../../packages/server-core/src/workspace-sync/client.ts'
import { InMemoryCommandOutbox } from '../../../packages/server-core/src/workspace-sync/outbox.ts'
import type { SharedProjectAuthority } from '../../../packages/shared/src/workspace-domain/identity/contracts.ts'
import { WorkspaceCommandService } from '../src/modules/commands/service.ts'
import { WORKSPACE_MEMBER_AUTHORIZER } from '../src/modules/commands/authorizer.ts'
import { isTransientPostgresError } from '../src/modules/commands/store.ts'
import { RealtimeGateway, type RealtimePushTransport } from '../src/modules/realtime/gateway.ts'
import { TOKEN, actor, fakeResolver, request, serve } from './helpers.ts'

const closers: Array<() => Promise<void> | void> = []
afterEach(async () => { for (const close of closers.splice(0).reverse()) await close() })
const unusedAuthority = new Proxy({}, { get: () => () => { throw new Error('not used') } }) as SharedProjectAuthority
const envelope = (type: string, payload: unknown = {}) => ({ commandId: randomUUID(), type, payload, issuedAt: new Date().toISOString() })
const pgFatal = (errno: string) => Object.assign(new Error(`terminating connection (${errno})`), { errno, code: 'ERR_POSTGRES_SERVER_ERROR' })

describe('session-termination SQLSTATEs are transient', () => {
  test('57P05, 25P03, 25P04 retry (direct and in a cause chain); 25P02 stays deterministic', () => {
    for (const s of ['57P05', '25P03', '25P04']) {
      expect([s, isTransientPostgresError(pgFatal(s))]).toEqual([s, true])
      expect([s, isTransientPostgresError(new Error('repo', { cause: pgFatal(s) }))]).toEqual([s, true])
    }
    for (const s of ['25P02', '25P01', '57P04', '25000']) expect([s, isTransientPostgresError(pgFatal(s))]).toEqual([s, false])
  })

  test('an opened transaction ended by 25P03 / 57P05 / 25P04 is retryable, not a terminal INTERNAL receipt', async () => {
    for (const errno of ['25P03', '57P05', '25P04']) {
      class TimeoutStore extends InMemoryCommandStore {
        isTransientError = isTransientPostgresError
        override async transaction<T>(workspaceId: string, fn: (tx: CommandStoreTransaction) => Promise<T>): Promise<T> {
          return super.transaction(workspaceId, async tx => { await fn(tx); throw pgFatal(errno) })
        }
      }
      const service = new WorkspaceCommandService({ store: new TimeoutStore(), authorizer: WORKSPACE_MEMBER_AUTHORIZER })
      const workspaceId = randomUUID()
      await expect(service.execute(actor([workspaceId]), workspaceId, envelope('system.ping'))).rejects.toBeInstanceOf(CommandStoreUnavailable)
    }
  })
})

describe('middleware errors', () => {
  test('a transient middleware throw is 503 and the outbox keeps the command; a deterministic one is INTERNAL', async () => {
    let mode: 'blip' | 'bug' | 'ok' = 'blip'
    const middleware: CommandMiddleware = {
      name: 'test.policy-read',
      async run(_ctx, next) {
        if (mode === 'blip') throw new Error('policy lookup failed', { cause: pgFatal('57P05') })
        if (mode === 'bug') throw new TypeError('policy bug')
        return next()
      },
    }
    const store = Object.assign(new InMemoryCommandStore(), { isTransientError: isTransientPostgresError })
    const service = new WorkspaceCommandService({ store, authorizer: WORKSPACE_MEMBER_AUTHORIZER })
    service.executor.use(middleware)
    const workspaceId = randomUUID()
    const { resolver } = fakeResolver(actor([workspaceId]))
    const http = await serve({ authority: unusedAuthority, actorResolver: resolver, commandBus: service })
    closers.push(http.close)
    const path = `/v1/workspaces/${workspaceId}/commands`
    expect(await request(http.url, path, { body: envelope('system.ping') })).toMatchObject({ status: 503, body: { error: { code: 'SERVICE_UNAVAILABLE' } } })

    const outbox = new InMemoryCommandOutbox()
    const sync = new WorkspaceCommandSync({
      outbox, autoDrain: false, backoffBaseMs: 1,
      transport: new WorkspaceCommandHttpClient({ baseUrl: http.url, token: () => TOKEN }),
    })
    await sync.enqueue(workspaceId, createCommandEnvelope('system.ping', { nonce: 'n1' }))
    expect(await sync.drain(workspaceId, { force: true })).toMatchObject({ sent: 0, failed: 1, remaining: 1 })
    expect(await outbox.count(workspaceId)).toBe(1)
    mode = 'ok'
    expect(await sync.drain(workspaceId, { force: true })).toMatchObject({ sent: 1, remaining: 0 })
    expect(await outbox.count(workspaceId)).toBe(0)

    mode = 'bug'
    expect(await request(http.url, path, { body: envelope('system.ping') })).toMatchObject({ status: 200, body: { status: 'rejected', error: { code: 'INTERNAL' } } })
  })
})

describe('live subscriptions retain the workspace log (owner decision)', () => {
  function setup() {
    let now = 0
    const bus = new InProcessEventBus({ epoch: 'e1', windowIdleTtlMs: 1_000, now: () => new Date(now) })
    const disconnects: Array<(clientId: string) => void> = []
    const transport: RealtimePushTransport = {
      async pushToWorkspaceClient() { return true },
      onClientDisconnect(listener) { disconnects.push(listener); return () => {} },
    }
    const gateway = new RealtimeGateway({ bus, transport, authorizer: WORKSPACE_MEMBER_AUTHORIZER })
    closers.push(() => gateway.close())
    const ping = (workspaceId: string): DomainEvent => ({ eventId: randomUUID(), workspaceId, type: 'system.pinged', actorId: 'alice', aggregateRevision: 0, payload: {}, createdAt: 'now' })
    return { bus, gateway, ping, disconnect: (id: string) => disconnects.forEach(l => l(id)), advance: (ms: number) => { now += ms } }
  }

  test('a quiet but connected workspace keeps its log: resubscribing from the held position is up_to_date', async () => {
    const f = setup()
    const ws = randomUUID()
    const quiet = randomUUID() // no subscribers: dropped as before
    const ctx = { clientId: 'c1', workspaceId: ws, principalId: 'alice', deviceKey: 'd1' }
    await f.gateway.subscribe(ctx, { topics: [{ topic: 'user:alice' }] })
    f.bus.publish([f.ping(ws), f.ping(quiet)])
    await f.gateway.flush()
    f.advance(15 * 60_000)
    f.bus.evictIdle()
    f.advance(15 * 60_000)
    f.bus.evictIdle()
    expect(f.bus.logCount()).toBe(1)
    expect(f.bus.epochOf(ws)).toBe('e1')
    // Laptop wakes: a second device reconnects holding (e1, 1).
    const again = await f.gateway.subscribe({ ...ctx, clientId: 'c2', deviceKey: 'd2' }, { topics: [{ topic: 'user:alice', sinceSeq: 1, epoch: 'e1' }] })
    expect(again.topics[0]).toEqual({ topic: 'user:alice', status: 'subscribed', seq: 1, epoch: 'e1' })
  })

  test('once the last subscription goes (unsubscribe or disconnect) the idle log is dropped', async () => {
    const f = setup()
    const ws = randomUUID()
    const a = { clientId: 'c1', workspaceId: ws, principalId: 'alice', deviceKey: 'd1' }
    const b = { clientId: 'c2', workspaceId: ws, principalId: 'alice', deviceKey: 'd2' }
    await f.gateway.subscribe(a, { topics: [{ topic: 'user:alice' }] })
    await f.gateway.subscribe(b, { topics: [{ topic: 'user:alice' }] })
    f.bus.publish([f.ping(ws)])
    await f.gateway.flush()
    f.advance(5_000)
    await f.gateway.unsubscribe(a, { topics: ['user:alice'] })
    f.bus.evictIdle()
    expect(f.bus.logCount()).toBe(1) // b still holds it
    f.disconnect('c2')
    await f.gateway.flush()
    expect(f.gateway.hasSubscribers(ws)).toBe(false)
    f.bus.evictIdle()
    expect(f.bus.logCount()).toBe(0)
  })

  test('the seq-counter cap rotates a retained log anyway', async () => {
    const f = setup()
    const ws = randomUUID()
    const bus = new InProcessEventBus({ epoch: 'e1', maxSeqCountersPerWorkspace: 2 })
    const transport: RealtimePushTransport = { async pushToWorkspaceClient() { return true }, onClientDisconnect() { return () => {} } }
    const gateway = new RealtimeGateway({ bus, transport, authorizer: WORKSPACE_MEMBER_AUTHORIZER })
    closers.push(() => gateway.close())
    await gateway.subscribe({ clientId: 'c1', workspaceId: ws, principalId: 'alice', deviceKey: 'd1' }, { topics: [{ topic: 'user:alice' }] })
    for (const who of ['alice', 'bob']) bus.publish([{ ...f.ping(ws), actorId: who }])
    bus.evictIdle()
    expect(bus.logCount()).toBe(1) // 2 counters: at the cap, kept
    bus.publish([{ ...f.ping(ws), actorId: 'carol' }])
    bus.evictIdle()
    expect(bus.logCount()).toBe(0) // 3 > 2: rotated despite the live subscriber
    expect(bus.epochOf(ws)).toBe('e1~1')
    expect((await gateway.subscribe({ clientId: 'c1', workspaceId: ws, principalId: 'alice', deviceKey: 'd1' }, { topics: [{ topic: 'user:alice', sinceSeq: 1, epoch: 'e1' }] })).topics[0])
      .toMatchObject({ status: 'snapshot_required', epoch: 'e1~1' })
  })
})
