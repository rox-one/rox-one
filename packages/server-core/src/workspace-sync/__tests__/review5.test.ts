/**
 * W1-03 (#1500) review 5 (client side): an in-flight unsubscribe — explicit or
 * the cleanup of a stale reply — must reach the gateway before a later
 * subscribe of the same topic. The WS-RPC server handles one socket's
 * messages concurrently, so without the ordering a re-subscribe can overtake
 * the unsubscribe and be deleted by it: the client believes it is subscribed
 * while the server holds nothing.
 *
 * The fake transport models the gateway: a subscribe takes effect on the
 * "server" when it is processed, an unsubscribe only when its (delayed) reply
 * is released, so a subscribe sent meanwhile overtakes it.
 */
import { describe, expect, test } from 'bun:test'
import type { RealtimeFrame, RealtimeSubscribeRequest, RealtimeSubscribeResult } from '@rox/core/events'
import { RealtimeSubscriber, type RealtimeConnection } from '../realtime'

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

type Held = { resolve: () => void; reject: (error: Error) => void }

function fakeGateway() {
  const server = new Set<string>()
  const subscribes: RealtimeSubscribeRequest[] = []
  const unsubscribes: string[][] = []
  /** Delayed unsubscribes (`holdUnsubscribes`): processed on the server when released. */
  const heldUnsubscribes: Held[] = []
  /** Delayed subscribe replies (`holdSubscribes`): processed (inserted) on release. */
  const heldSubscribes: Array<() => void> = []
  const mode = { holdUnsubscribes: false, holdSubscribes: false }
  const conn: RealtimeConnection = {
    subscribe(request) {
      subscribes.push(request)
      const apply = (): RealtimeSubscribeResult => {
        for (const item of request.topics) server.add(item.topic)
        return { topics: request.topics.map(item => ({ topic: item.topic, status: 'subscribed', seq: 4, epoch: 'e1' })) } as RealtimeSubscribeResult
      }
      if (!mode.holdSubscribes) return Promise.resolve(apply())
      return new Promise(resolve => { heldSubscribes.push(() => resolve(apply())) })
    },
    unsubscribe(topics) {
      unsubscribes.push([...topics])
      const apply = () => { for (const topic of topics) server.delete(topic) }
      if (!mode.holdUnsubscribes) { apply(); return Promise.resolve() }
      return new Promise<void>((resolve, reject) => {
        heldUnsubscribes.push({
          resolve: () => { apply(); resolve() },
          reject: error => { reject(error) },
        })
      })
    },
    onFrame(_listener: (frame: RealtimeFrame) => void) { return () => {} },
  }
  const until = async (check: () => boolean) => { for (let i = 0; i < 200 && !check(); i++) await wait(5) }
  return { conn, server, subscribes, unsubscribes, heldUnsubscribes, heldSubscribes, mode, until }
}

const pendingUnsubscribes = (sub: RealtimeSubscriber) => (sub as unknown as { unsubscribing: Map<string, unknown> }).unsubscribing.size
const waiters = (sub: RealtimeSubscriber) => (sub as unknown as { unsubscribeWaiters: Set<unknown> }).unsubscribeWaiters.size

describe('a re-subscribe waits for an in-flight unsubscribe of the same topic', () => {
  test('explicit unsubscribe delayed, re-subscribe issued meanwhile: the server ends up holding the topic', async () => {
    const g = fakeGateway()
    const sub = new RealtimeSubscriber({ connection: g.conn, onEvent: () => {} })
    await sub.subscribe(['user:a'])
    expect([...g.server]).toEqual(['user:a'])

    g.mode.holdUnsubscribes = true
    const unsubscribed = sub.unsubscribe(['user:a'])
    const resubscribed = sub.subscribe(['user:a'])
    await wait(20)
    // Old code sent the subscribe at once (it overtook the unsubscribe).
    expect(g.subscribes).toHaveLength(1)
    g.heldUnsubscribes.shift()!.resolve()
    await unsubscribed
    await resubscribed
    expect(g.subscribes).toHaveLength(2)
    expect(sub.subscribed()).toEqual(['user:a'])
    expect([...g.server]).toEqual(['user:a']) // client and server agree
    expect(pendingUnsubscribes(sub)).toBe(0)
    expect(waiters(sub)).toBe(0)
    sub.close()
  })

  test('cleanup unsubscribe of a stale reply delayed, re-subscribe meanwhile: the server ends up holding the topic', async () => {
    const g = fakeGateway()
    const sub = new RealtimeSubscriber({ connection: g.conn, onEvent: () => {} })
    g.mode.holdSubscribes = true
    const first = sub.subscribe(['user:a'])
    await sub.unsubscribe(['user:a']) // processed before the held subscribe reaches the server
    g.mode.holdUnsubscribes = true
    g.heldSubscribes.shift()!() // server attaches after the unsubscribe → stale reply → cleanup C (held)
    await first
    await g.until(() => g.heldUnsubscribes.length === 1)
    expect(g.unsubscribes).toEqual([['user:a'], ['user:a']])
    expect([...g.server]).toEqual(['user:a'])

    g.mode.holdSubscribes = false
    const again = sub.subscribe(['user:a'])
    await wait(20)
    expect(g.subscribes).toHaveLength(1) // waits for C
    g.heldUnsubscribes.shift()!.resolve()
    await again
    expect(g.subscribes).toHaveLength(2)
    expect(sub.subscribed()).toEqual(['user:a'])
    expect([...g.server]).toEqual(['user:a'])
    expect(pendingUnsubscribes(sub)).toBe(0)
    sub.close()
  })

  test('a failed unsubscribe still releases the waiting subscribe (the server keeps or re-gets the topic)', async () => {
    const g = fakeGateway()
    const errors: unknown[] = []
    const sub = new RealtimeSubscriber({ connection: g.conn, onEvent: () => {}, onError: e => errors.push(e) })
    await sub.subscribe(['user:a'])
    g.mode.holdUnsubscribes = true
    const unsubscribed = sub.unsubscribe(['user:a'])
    const resubscribed = sub.subscribe(['user:a'])
    g.heldUnsubscribes.shift()!.reject(new Error('rpc timeout'))
    await expect(unsubscribed).rejects.toThrow('rpc timeout')
    await resubscribed
    expect(sub.subscribed()).toEqual(['user:a'])
    expect([...g.server]).toEqual(['user:a'])
    expect(pendingUnsubscribes(sub)).toBe(0)
    sub.close()
  })

  test('a synchronously throwing transport unsubscribe neither blocks nor leaks', async () => {
    const g = fakeGateway()
    const conn: RealtimeConnection = { ...g.conn, unsubscribe: () => { throw new Error('socket closed') } }
    const sub = new RealtimeSubscriber({ connection: conn, onEvent: () => {} })
    await sub.subscribe(['user:a'])
    await expect(sub.unsubscribe(['user:a'])).rejects.toThrow('socket closed')
    await sub.subscribe(['user:a'])
    expect(sub.subscribed()).toEqual(['user:a'])
    expect(pendingUnsubscribes(sub)).toBe(0)
    sub.close()
  })

  test('overlapping unsubscribes of one topic: the re-subscribe waits for both', async () => {
    const g = fakeGateway()
    const sub = new RealtimeSubscriber({ connection: g.conn, onEvent: () => {} })
    await sub.subscribe(['user:a', 'user:b'])
    g.mode.holdUnsubscribes = true
    const u1 = sub.unsubscribe(['user:a'])
    const u2 = sub.unsubscribe(['user:a', 'user:b'])
    const again = sub.subscribe(['user:a'])
    g.heldUnsubscribes.shift()!.resolve()
    await u1
    await wait(20)
    expect(g.subscribes).toHaveLength(1) // u2 still in flight
    g.heldUnsubscribes.shift()!.resolve()
    await u2
    await again
    expect([...g.server]).toEqual(['user:a'])
    expect(sub.subscribed()).toEqual(['user:a'])
    expect(pendingUnsubscribes(sub)).toBe(0)
    sub.close()
  })

  test('topics without a pending unsubscribe are sent at once; a mixed request waits', async () => {
    const g = fakeGateway()
    const sub = new RealtimeSubscriber({ connection: g.conn, onEvent: () => {} })
    await sub.subscribe(['user:a'])
    g.mode.holdUnsubscribes = true
    const unsubscribed = sub.unsubscribe(['user:a'])
    void sub.subscribe(['user:b'])
    expect(g.subscribes).toHaveLength(2) // synchronous send, not delayed
    const mixed = sub.subscribe(['user:a', 'user:c'])
    await wait(20)
    expect(g.subscribes).toHaveLength(2)
    g.heldUnsubscribes.shift()!.resolve()
    await unsubscribed
    await mixed
    expect(g.subscribes).toHaveLength(3)
    expect([...g.server].sort()).toEqual(['user:a', 'user:b', 'user:c'])
    sub.close()
  })

  test('close() while a subscribe waits for an unsubscribe: the request is abandoned, not sent, nothing leaks', async () => {
    const g = fakeGateway()
    const sub = new RealtimeSubscriber({ connection: g.conn, onEvent: () => {} })
    await sub.subscribe(['user:a'])
    g.mode.holdUnsubscribes = true
    const unsubscribed = sub.unsubscribe(['user:a'])
    const waiting = sub.subscribe(['user:a'])
    await wait(10)
    expect(waiters(sub)).toBe(1)
    sub.close()
    await expect(waiting).rejects.toThrow('closed')
    expect(waiters(sub)).toBe(0)
    expect(g.subscribes).toHaveLength(1)
    expect((sub as unknown as { pending: Map<string, unknown> }).pending.size).toBe(0)
    g.heldUnsubscribes.shift()!.resolve()
    await unsubscribed
    await wait(5)
    expect(pendingUnsubscribes(sub)).toBe(0)
  })
})
