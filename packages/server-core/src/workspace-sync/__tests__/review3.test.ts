/**
 * W1-03 (#1500) review 3 (client side): a transient ACL failure answers
 * `unavailable`; the subscriber keeps the topic and retries with backoff
 * instead of treating it as a permanent `forbidden`.
 */
import { describe, expect, test } from 'bun:test'
import type { RealtimeFrame, RealtimeSubscribeRequest, RealtimeSubscribeResult } from '@rox/core/events'
import { RealtimeSubscriber, type RealtimeConnection } from '../realtime'

function connection(statuses: Array<'unavailable' | 'subscribed' | 'forbidden'>) {
  const requests: RealtimeSubscribeRequest[] = []
  const conn: RealtimeConnection = {
    async subscribe(request) {
      requests.push(request)
      const status = statuses.shift() ?? 'subscribed'
      return {
        topics: request.topics.map(item => status === 'subscribed'
          ? { topic: item.topic, status, seq: 4, epoch: 'e1' }
          : { topic: item.topic, status, seq: 0, epoch: '' }),
      } as RealtimeSubscribeResult
    },
    async unsubscribe() {},
    onFrame(_listener: (frame: RealtimeFrame) => void) { return () => {} },
  }
  return { conn, requests }
}

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

describe('RealtimeSubscriber: unavailable is retryable', () => {
  test('keeps the topic, reports onUnavailable, retries with backoff until subscribed', async () => {
    const { conn, requests } = connection(['unavailable', 'unavailable', 'subscribed'])
    const unavailable: string[] = []
    const forbidden: string[] = []
    const sub = new RealtimeSubscriber({
      connection: conn, onEvent: () => {}, unavailableRetryMs: 10,
      onUnavailable: topic => unavailable.push(topic), onForbidden: topic => forbidden.push(topic),
    })
    expect((await sub.subscribe(['user:a']))[0]).toMatchObject({ status: 'unavailable' })
    expect(sub.subscribed()).toEqual(['user:a'])
    for (let i = 0; i < 50 && requests.length < 3; i++) await wait(10)
    expect(requests).toHaveLength(3)
    expect(unavailable).toEqual(['user:a', 'user:a'])
    expect(forbidden).toEqual([])
    expect(sub.position('user:a')).toEqual({ epoch: 'e1', seq: 4 })
    await wait(60)
    expect(requests).toHaveLength(3) // no retry after success
    sub.close()
  })

  test('close() and unsubscribe() cancel pending retries', async () => {
    const { conn, requests } = connection(['unavailable', 'unavailable'])
    const sub = new RealtimeSubscriber({ connection: conn, onEvent: () => {}, unavailableRetryMs: 10 })
    await sub.subscribe(['user:a'])
    await sub.unsubscribe(['user:a'])
    await wait(40)
    expect(requests).toHaveLength(1)
    await sub.subscribe(['user:b'])
    sub.close()
    await wait(40)
    expect(requests).toHaveLength(2)
  })
})
