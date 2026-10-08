/**
 * W1-03 (#1500) review 5 regressions (no Postgres server needed): a
 * multi-topic unsubscribe of a resume client removes all of its topics
 * synchronously — before any cursor write is awaited — so a subscribe on the
 * same socket that lands while the writes are pending is never deleted by it.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { InProcessEventBus } from '../../../packages/server-core/src/commands/event-bus.ts'
import { WORKSPACE_MEMBER_AUTHORIZER } from '../src/modules/commands/authorizer.ts'
import { RealtimeGateway, type RealtimePushTransport } from '../src/modules/realtime/gateway.ts'
import { InMemoryRealtimeCursorStore, type RealtimeCursorOwner, type RealtimeCursorPosition } from '../src/modules/realtime/cursor-store.ts'

const closers: Array<() => void> = []
afterEach(() => { for (const close of closers.splice(0).reverse()) close() })

/** Cursor store whose `save` blocks until released. */
class BlockingCursorStore extends InMemoryRealtimeCursorStore {
  readonly saves: string[] = []
  private readonly held: Array<() => void> = []
  override async save(owner: RealtimeCursorOwner, topic: string, position: RealtimeCursorPosition, policyEpoch: number): Promise<void> {
    this.saves.push(topic)
    await new Promise<void>(resolve => { this.held.push(resolve) })
    await super.save(owner, topic, position, policyEpoch)
  }
  async releaseAll(): Promise<void> {
    for (let i = 0; i < 50; i++) {
      while (this.held.length > 0) this.held.shift()!()
      await new Promise(resolve => setTimeout(resolve, 2))
    }
  }
}

function setup() {
  const bus = new InProcessEventBus({ epoch: 'e1' })
  const transport: RealtimePushTransport = { async pushToWorkspaceClient() { return true }, onClientDisconnect() { return () => {} } }
  const cursors = new BlockingCursorStore()
  const gateway = new RealtimeGateway({ bus, transport, authorizer: WORKSPACE_MEMBER_AUTHORIZER, cursors })
  closers.push(() => gateway.close())
  const ws = randomUUID()
  const ctx = { clientId: 'c1', workspaceId: ws, principalId: 'alice', deviceKey: 'd1' }
  return { bus, cursors, gateway, ws, ctx }
}


describe('gateway unsubscribe removes all topics before awaiting cursor writes', () => {
  test('multi-topic unsubscribe with resume on: every topic is gone synchronously, cursors are saved afterwards', async () => {
    const f = setup()
    const subscribed = await f.gateway.subscribe(f.ctx, { resume: true, topics: [{ topic: 'user:alice' }, { topic: 'channel:general' }, { topic: 'doc:plan' }] })
    expect(subscribed.topics.map(t => t.status)).toEqual(['subscribed', 'subscribed', 'subscribed'])
    expect(f.gateway.subscriberCount()).toBe(1)

    const pending = f.gateway.unsubscribe(f.ctx, { topics: ['user:alice', 'channel:general', 'doc:plan'] })
    // No microtask has run yet: the old loop had only removed the first topic here.
    expect(f.gateway.subscriberCount('user:alice')).toBe(0)
    expect(f.gateway.subscriberCount('channel:general')).toBe(0)
    expect(f.gateway.subscriberCount('doc:plan')).toBe(0)
    expect(f.gateway.hasSubscribers(f.ws)).toBe(false)
    expect(f.gateway.subscriberCount()).toBe(0)

    await f.cursors.releaseAll()
    expect(await pending).toEqual({ topics: ['user:alice', 'channel:general', 'doc:plan'] })
    expect(f.cursors.saves).toEqual(['user:alice', 'channel:general', 'doc:plan'])
    expect(await f.cursors.load(f.ctx, 'doc:plan', 1)).toEqual({ epoch: 'e1', seq: 0 })
  })

  test('a subscribe landing while the unsubscribe awaits its cursor writes survives it', async () => {
    const f = setup()
    await f.gateway.subscribe(f.ctx, { resume: true, topics: [{ topic: 'user:alice' }, { topic: 'channel:general' }] })
    const unsubscribed = f.gateway.unsubscribe(f.ctx, { topics: ['user:alice', 'channel:general'] })
    // Same socket, handled concurrently: re-subscribe channel:general while alice's cursor write is pending.
    const again = await f.gateway.subscribe(f.ctx, { topics: [{ topic: 'channel:general', sinceSeq: 0, epoch: 'e1' }] })
    expect(again.topics[0]).toMatchObject({ topic: 'channel:general', status: 'subscribed' })
    await f.cursors.releaseAll()
    await unsubscribed
    expect(f.gateway.subscriberCount('channel:general')).toBe(1)
    expect(f.gateway.subscriberCount('user:alice')).toBe(0)
    expect(f.gateway.hasSubscribers(f.ws)).toBe(true)
  })

  test('duplicate topics in one unsubscribe are removed and saved once', async () => {
    const f = setup()
    await f.gateway.subscribe(f.ctx, { resume: true, topics: [{ topic: 'user:alice' }] })
    const pending = f.gateway.unsubscribe(f.ctx, { topics: ['user:alice', 'user:alice'] })
    await f.cursors.releaseAll()
    expect(await pending).toEqual({ topics: ['user:alice'] })
    expect(f.cursors.saves).toEqual(['user:alice'])
  })
})
