import { describe, expect, test } from 'bun:test'
import type { RealtimeEventFrame, RealtimeFrame, RealtimeSubscribeRequest, RealtimeSubscribeResult } from '@rox/core/events'
import { TopicLog } from '@rox/core/events'
import { RealtimeSubscriber, wsRpcRealtimeConnection, type RealtimeConnection } from '../realtime'

/** Gateway double backed by a TopicLog; frames can be dropped in transit. */
function fakeGateway(options: { capacity?: number; forbidden?: string[] } = {}) {
  let log = new TopicLog({ epoch: 'e1', capacity: options.capacity ?? 100 })
  const listeners = new Set<(frame: RealtimeFrame) => void>()
  const subscribed = new Set<string>()
  const requests: RealtimeSubscribeRequest[] = []
  const net = { drop: new Set<number>() }
  const connection: RealtimeConnection = {
    async subscribe(request) {
      requests.push(request)
      const result: RealtimeSubscribeResult = { topics: [] }
      for (const item of request.topics) {
        if (options.forbidden?.includes(item.topic)) {
          result.topics.push({ topic: item.topic, status: 'forbidden', seq: 0, epoch: log.epoch })
          continue
        }
        subscribed.add(item.topic)
        if (item.sinceSeq === undefined) {
          result.topics.push({ topic: item.topic, status: 'subscribed', seq: log.latest(item.topic), epoch: log.epoch })
          continue
        }
        const replay = log.replay(item.topic, item.sinceSeq, item.epoch)
        if (replay.kind === 'snapshot_required') result.topics.push({ topic: item.topic, status: 'snapshot_required', seq: replay.latestSeq, epoch: replay.epoch })
        else result.topics.push({ topic: item.topic, status: 'subscribed', seq: replay.latestSeq, epoch: replay.epoch, ...(replay.kind === 'events' ? { frames: replay.frames } : {}) })
      }
      return result
    },
    async unsubscribe(topics) { for (const t of topics) subscribed.delete(t) },
    onFrame(listener) { listeners.add(listener); return () => listeners.delete(listener) },
  }
  const publish = (topic: string, n: number) => {
    const frame = log.append(topic, { type: 'system.pinged', payload: { n }, at: 'now' })
    if (!subscribed.has(topic) || net.drop.has(frame.seq)) return frame
    for (const listener of listeners) listener(frame)
    return frame
  }
  const restart = () => { log = new TopicLog({ epoch: 'e2', capacity: options.capacity ?? 100 }) }
  const push = (frame: RealtimeFrame) => { for (const l of listeners) l(frame) }
  return { connection, publish, net, requests, restart, push }
}

describe('RealtimeSubscriber seq gap recovery', () => {
  test('a dropped frame is detected and replayed in order, without duplicates', async () => {
    const gw = fakeGateway()
    const seen: number[] = []
    const sub = new RealtimeSubscriber({ connection: gw.connection, onEvent: f => seen.push(f.seq) })
    await sub.subscribe(['user:u1'])
    gw.publish('user:u1', 1)
    gw.net.drop.add(2).add(3)
    gw.publish('user:u1', 2)
    gw.publish('user:u1', 3)
    gw.publish('user:u1', 4) // gap: 1 → 4
    await sub.settled()
    expect(seen).toEqual([1, 2, 3, 4])
    expect(gw.requests.at(-1)).toEqual({ topics: [{ topic: 'user:u1', sinceSeq: 1, epoch: 'e1' }] })
    gw.publish('user:u1', 5)
    expect(seen).toEqual([1, 2, 3, 4, 5])
    expect(sub.position('user:u1')).toEqual({ epoch: 'e1', seq: 5 })
  })

  test('duplicates (replayed twice) are ignored', async () => {
    const gw = fakeGateway()
    const seen: number[] = []
    const sub = new RealtimeSubscriber({ connection: gw.connection, onEvent: f => seen.push(f.seq) })
    await sub.subscribe(['channel:c'])
    const frame = gw.publish('channel:c', 1) as RealtimeEventFrame
    gw.push(frame)
    expect(seen).toEqual([1])
  })

  test('gap beyond the replay window → snapshot_required → refetch, then live again', async () => {
    const gw = fakeGateway({ capacity: 2 })
    const seen: number[] = []
    const snapshots: Array<[string, number]> = []
    const sub = new RealtimeSubscriber({ connection: gw.connection, onEvent: f => seen.push(f.seq), onSnapshotRequired: (t, s) => snapshots.push([t, s]) })
    await sub.subscribe(['doc:d'])
    gw.net.drop.add(1).add(2).add(3).add(4)
    for (let n = 1; n <= 4; n++) gw.publish('doc:d', n)
    gw.publish('doc:d', 5) // window holds 4..5; client is at 0
    await sub.settled()
    expect(snapshots).toEqual([['doc:d', 5]])
    gw.publish('doc:d', 6)
    expect(seen).toEqual([6])
  })

  test('resume after a server restart (new epoch) requires a snapshot', async () => {
    const gw = fakeGateway()
    const snapshots: string[] = []
    const sub = new RealtimeSubscriber({ connection: gw.connection, onEvent: () => {}, onSnapshotRequired: t => snapshots.push(t) })
    await sub.subscribe(['user:u1'])
    gw.publish('user:u1', 1)
    gw.restart()
    await sub.resume()
    expect(snapshots).toEqual(['user:u1'])
    expect(sub.position('user:u1')).toEqual({ epoch: 'e2', seq: 0 })
  })

  test('forbidden topics are dropped and reported', async () => {
    const gw = fakeGateway({ forbidden: ['channel:secret'] })
    const forbidden: string[] = []
    const sub = new RealtimeSubscriber({ connection: gw.connection, onEvent: () => {}, onForbidden: t => forbidden.push(t) })
    const results = await sub.subscribe(['channel:secret', 'user:u1'])
    expect(results.map(r => r.status)).toEqual(['forbidden', 'subscribed'])
    expect(forbidden).toEqual(['channel:secret'])
    expect(sub.subscribed()).toEqual(['user:u1'])
  })

  test('wsRpcRealtimeConnection maps the realtime:* channels and filters by workspace', async () => {
    const calls: unknown[][] = []
    let push: ((...args: unknown[]) => void) | null = null
    const conn = wsRpcRealtimeConnection({
      invoke: async (...args) => { calls.push(args); return { topics: [] } },
      on: (channel, cb) => { calls.push(['on', channel]); push = cb; return () => {} },
    }, 'ws')
    const frames: RealtimeFrame[] = []
    conn.onFrame(f => frames.push(f))
    await conn.subscribe({ topics: [{ topic: 'user:u' }] })
    await conn.unsubscribe(['user:u'])
    const frame = { frame: 'event', topic: 'user:u', type: 'system.pinged', seq: 1, epoch: 'e', payload: {}, at: 'now' }
    push!('other-ws', frame)
    push!('ws', frame)
    expect(frames).toEqual([frame as RealtimeFrame])
    expect(calls).toEqual([
      ['on', 'realtime:event'],
      ['realtime:subscribe', 'ws', { topics: [{ topic: 'user:u' }] }],
      ['realtime:unsubscribe', 'ws', { topics: ['user:u'] }],
    ])
  })
})
