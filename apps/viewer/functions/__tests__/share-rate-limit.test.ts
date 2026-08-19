/**
 * Best-effort per-IP rate limiting for the share API.
 *
 * Platform constraint (see apps/viewer/SECURITY.md §8): Pages Functions have no
 * durable state, so the limiter is in-memory per isolate. Tests exercise the
 * real module state; each test uses a distinct CF-Connecting-IP for isolation.
 */
import { describe, expect, it } from 'bun:test'
import { FakeR2Bucket, jsonRequest, uniqueIp } from './fake-r2'
import { onRequestPost } from '../s/api'
import { onRequestPut } from '../s/api/[id]'

describe('rate limiting (best-effort, per-IP)', () => {
  it('throttles share creation floods from a single IP with 429 RATE_LIMITED', async () => {
    const env = { SHARES: new FakeR2Bucket() }
    const ip = uniqueIp()
    let lastStatus = 0
    let lastBody: Record<string, unknown> = {}
    // 30/hour create budget: the 31st create from the same IP must be rejected
    for (let i = 0; i < 31; i++) {
      const res = await onRequestPost({
        request: jsonRequest('https://viewer.test/s/api', 'POST', { id: `s${i}`, messages: [] }, {}, ip),
        env,
      } as never)
      lastStatus = res.status
      lastBody = (await res.json()) as Record<string, unknown>
    }
    expect(lastStatus).toBe(429)
    expect(lastBody.code).toBe('RATE_LIMITED')
  })

  it('does not throttle a different IP when one IP is limited', async () => {
    const env = { SHARES: new FakeR2Bucket() }
    const noisy = uniqueIp()
    for (let i = 0; i < 35; i++) {
      await onRequestPost({
        request: jsonRequest('https://viewer.test/s/api', 'POST', { id: `n${i}`, messages: [] }, {}, noisy),
        env,
      } as never)
    }
    const res = await onRequestPost({
      request: jsonRequest('https://viewer.test/s/api', 'POST', { id: 'quiet', messages: [] }, {}, uniqueIp()),
      env,
    } as never)
    expect(res.status).toBe(201)
  })

  it('throttles mutation floods (PUT) from a single IP with 429', async () => {
    const env = { SHARES: new FakeR2Bucket() }
    const ownerIp = uniqueIp()
    const create = await onRequestPost({
      request: jsonRequest('https://viewer.test/s/api', 'POST', { id: 'rl', messages: [] }, {}, ownerIp),
      env,
    } as never)
    const { id, ownerKey } = (await create.json()) as { id: string; ownerKey: string }

    const attackerIp = uniqueIp()
    let lastStatus = 0
    let lastBody: Record<string, unknown> = {}
    // 60/hour mutation budget per IP
    for (let i = 0; i < 61; i++) {
      const res = await onRequestPut({
        request: jsonRequest(`https://viewer.test/s/api/${id}`, 'PUT', { id: 'rl', messages: [] }, {
          Authorization: `Bearer ${ownerKey}`,
        }, attackerIp),
        env,
        params: { id },
      } as never)
      lastStatus = res.status
      lastBody = (await res.json()) as Record<string, unknown>
    }
    expect(lastStatus).toBe(429)
    expect(lastBody.code).toBe('RATE_LIMITED')
  })
})
