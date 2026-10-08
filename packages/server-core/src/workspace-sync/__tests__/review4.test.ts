/**
 * W1-03 (#1500) review 4 (client side): the `unavailable` retry survives a
 * throwing retry request, and per-topic intent generations make results and
 * timers that outlived an `unsubscribe()` stale — no retry, no re-add, no
 * server-side subscription leak.
 */
import { describe, expect, test } from 'bun:test'
import type { RealtimeFrame, RealtimeSubscribeRequest, RealtimeSubscribeResult, RealtimeSubscribeTopicResult } from '@rox/core/events'
import { RealtimeSubscriber, type RealtimeConnection } from '../realtime'

type Status = RealtimeSubscribeTopicResult['status']
type Reply = Status | 'throw'

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

function result(request: RealtimeSubscribeRequest, status: Status): RealtimeSubscribeResult {
  return {
    topics: request.topics.map(item => status === 'subscribed' || status === 'snapshot_required'
      ? { topic: item.topic, status, seq: 4, epoch: 'e1' }
      : { topic: item.topic, status, seq: 0, epoch: '' }),
  } as RealtimeSubscribeResult
}

/** Replies come from a script; `manual` replies wait until `release()` is called. */
function connection(script: Array<Reply | 'manual'>) {
  const requests: RealtimeSubscribeRequest[] = []
  const unsubscribes: string[][] = []
  const held: Array<(reply: Reply) => void> = []
  const conn: RealtimeConnection = {
    subscribe(request) {
      requests.push(request)
      const step = script.shift() ?? 'subscribed'
      const answer = (reply: Reply) => reply === 'throw' ? Promise.reject(new Error('rpc timeout')) : Promise.resolve(result(request, reply))
      if (step !== 'manual') return answer(step)
      return new Promise<RealtimeSubscribeResult>((resolve, reject) => {
        held.push(reply => { answer(reply).then(resolve, reject) })
      })
    },
    async unsubscribe(topics) { unsubscribes.push([...topics]) },
    onFrame(_listener: (frame: RealtimeFrame) => void) { return () => {} },
  }
  const release = async (reply: Reply) => {
    for (let i = 0; i < 100 && held.length === 0; i++) await wait(5)
    held.shift()!(reply)
    await wait(5)
  }
  return { conn, requests, unsubscribes, release, held }
}

describe('unavailable retry: a throwing retry request reschedules', () => {
  test('unavailable → retry throws → retry throws → subscribed (bounded backoff, errors reported)', async () => {
    const { conn, requests } = connection(['unavailable', 'throw', 'throw', 'subscribed'])
    const errors: unknown[] = []
    const sub = new RealtimeSubscriber({ connection: conn, onEvent: () => {}, unavailableRetryMs: 5, onError: e => errors.push(e) })
    await sub.subscribe(['user:a'])
    for (let i = 0; i < 100 && requests.length < 4; i++) await wait(5)
    await wait(10)
    expect(requests).toHaveLength(4)
    expect(errors).toHaveLength(2)
    expect(sub.subscribed()).toEqual(['user:a'])
    expect(sub.position('user:a')).toEqual({ epoch: 'e1', seq: 4 })
    await wait(60)
    expect(requests).toHaveLength(4) // done after success
    sub.close()
  })

  test('backoff keeps doubling across throwing retries (bounded by the 30 s cap)', async () => {
    const { conn, requests } = connection(['unavailable', 'throw', 'throw', 'throw'])
    const times: number[] = []
    const timed: RealtimeConnection = { ...conn, subscribe: request => { times.push(performance.now()); return conn.subscribe(request) } }
    const sub = new RealtimeSubscriber({ connection: timed, onEvent: () => {}, unavailableRetryMs: 40, onError: () => {} })
    await sub.subscribe(['user:a'])
    for (let i = 0; i < 200 && requests.length < 3; i++) await wait(10)
    expect(requests).toHaveLength(3)
    // Timers never fire early: lower bounds only (robust under load).
    expect(times[1]! - times[0]!).toBeGreaterThanOrEqual(35) // 40 ms
    expect(times[2]! - times[1]!).toBeGreaterThanOrEqual(75) // 80 ms after the first throw
    sub.close()
    const count = requests.length
    await wait(200)
    expect(requests).toHaveLength(count) // close() stops it
  })

  test('a throwing retry for a topic unsubscribed meanwhile does not reschedule', async () => {
    const { conn, requests, release } = connection(['unavailable', 'manual'])
    const sub = new RealtimeSubscriber({ connection: conn, onEvent: () => {}, unavailableRetryMs: 5, onError: () => {} })
    await sub.subscribe(['user:a'])
    for (let i = 0; i < 100 && requests.length < 2; i++) await wait(5)
    await sub.unsubscribe(['user:a'])
    await release('throw')
    await wait(60)
    expect(requests).toHaveLength(2)
    expect(sub.subscribed()).toEqual([])
    sub.close()
  })
})

describe('intent generations: unsubscribe during an in-flight subscribe', () => {
  for (const reply of ['unavailable', 'subscribed', 'snapshot_required'] as const) {
    test(`initial subscribe in flight, unsubscribe, reply ${reply}: no re-add, no retry, no leak`, async () => {
      const { conn, requests, unsubscribes, release } = connection(['manual'])
      const unavailable: string[] = []
      const snapshots: string[] = []
      const sub = new RealtimeSubscriber({
        connection: conn, onEvent: () => {}, unavailableRetryMs: 5,
        onUnavailable: t => unavailable.push(t), onSnapshotRequired: t => snapshots.push(t),
      })
      const pending = sub.subscribe(['user:a'])
      await sub.unsubscribe(['user:a'])
      await release(reply)
      await pending
      await wait(40)
      expect(sub.subscribed()).toEqual([])
      expect(sub.position('user:a')).toBeUndefined()
      expect(requests).toHaveLength(1) // no retry
      expect(unavailable).toEqual([])
      expect(snapshots).toEqual([])
      // The explicit unsubscribe, plus (for a server-side attach) one cleanup unsubscribe.
      expect(unsubscribes).toEqual(reply === 'unavailable' ? [['user:a']] : [['user:a'], ['user:a']])
      sub.close()
    })
  }

  for (const reply of ['unavailable', 'subscribed'] as const) {
    test(`retry in flight, unsubscribe, reply ${reply}: no re-add, no further retry, no leak`, async () => {
      const { conn, requests, unsubscribes, release } = connection(['unavailable', 'manual'])
      const sub = new RealtimeSubscriber({ connection: conn, onEvent: () => {}, unavailableRetryMs: 5 })
      await sub.subscribe(['user:a'])
      for (let i = 0; i < 100 && requests.length < 2; i++) await wait(5)
      expect(requests).toHaveLength(2)
      await sub.unsubscribe(['user:a'])
      await release(reply)
      await wait(40)
      expect(sub.subscribed()).toEqual([])
      expect(requests).toHaveLength(2)
      expect(unsubscribes).toEqual(reply === 'subscribed' ? [['user:a'], ['user:a']] : [['user:a']])
      sub.close()
    })
  }

  test('unsubscribe then re-subscribe while the old request is in flight: the stale reply is ignored, the new one applies, nothing is unsubscribed', async () => {
    const { conn, requests, unsubscribes, release } = connection(['manual', 'manual'])
    const unavailable: string[] = []
    const sub = new RealtimeSubscriber({ connection: conn, onEvent: () => {}, unavailableRetryMs: 5, onUnavailable: t => unavailable.push(t) })
    const first = sub.subscribe(['user:a'])
    await sub.unsubscribe(['user:a'])
    const second = sub.subscribe(['user:a'])
    await release('unavailable') // stale: no retry scheduled for it
    await first
    await wait(30)
    expect(unavailable).toEqual([])
    expect(requests).toHaveLength(2)
    await release('subscribed')
    await second
    expect(sub.subscribed()).toEqual(['user:a'])
    expect(sub.position('user:a')).toEqual({ epoch: 'e1', seq: 4 })
    expect(unsubscribes).toEqual([['user:a']]) // only the explicit one
    sub.close()
  })

  test('a stale subscribed reply for a re-wanted topic sends no cleanup unsubscribe', async () => {
    const { conn, unsubscribes, release } = connection(['manual', 'manual'])
    const sub = new RealtimeSubscriber({ connection: conn, onEvent: () => {} })
    const first = sub.subscribe(['user:a'])
    await sub.unsubscribe(['user:a'])
    const second = sub.subscribe(['user:a'])
    await release('subscribed') // stale, but the topic is wanted again
    await first
    await release('subscribed')
    await second
    expect(unsubscribes).toEqual([['user:a']])
    expect(sub.subscribed()).toEqual(['user:a'])
    sub.close()
  })
})
