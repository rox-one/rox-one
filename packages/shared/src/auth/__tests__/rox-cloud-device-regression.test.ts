import { afterEach, describe, expect, it } from 'bun:test'
import { pollRoxDeviceFlow, startRoxDeviceFlow, waitForRoxDeviceApproval } from '../rox-cloud'

const originalFetch = globalThis.fetch
const originalBase = process.env.ROX_AUTH_BASE_URL
const response = (data: unknown, status = 200, headers?: Record<string, string>) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', ...headers } })
const startPayload = { device_code: 'synthetic-device', user_code: 'TEST-CODE', verification_uri: 'https://auth.example.test/device', expires_in: 60 }
const approvedPayload = { status: 'approved', access_token: 'synthetic-token', expires_in: 60, user: { id: 'synthetic-user', email: 'test@example.test', name: 'Test' } }
const mockFetch = (handler: (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => Promise<Response>) => {
  process.env.ROX_AUTH_BASE_URL = 'https://auth.example.test'
  globalThis.fetch = handler as typeof fetch
}
afterEach(() => {
  globalThis.fetch = originalFetch
  if (originalBase === undefined) delete process.env.ROX_AUTH_BASE_URL
  else process.env.ROX_AUTH_BASE_URL = originalBase
})

describe('Rox device approval regression', () => {
  it('accepts an omitted complete URL and clamps unusable poll intervals', async () => {
    mockFetch(async () => response({ ...startPayload, interval: -1 }))
    expect(await startRoxDeviceFlow()).toMatchObject({ verificationUriComplete: startPayload.verification_uri, interval: 5 })
    mockFetch(async () => response({ status: 'pending', interval: 0.001 }))
    expect(await pollRoxDeviceFlow('synthetic-device')).toEqual({ status: 'pending', interval: 2 })
  })
  it.each(['javascript:alert(1)', 'http://different.example.test/device', 'https://user:password@auth.example.test/device'])('rejects unsafe approval URL %s', async uri => {
    mockFetch(async () => response({ ...startPayload, verification_uri_complete: uri }))
    await expect(startRoxDeviceFlow()).rejects.toThrow('ROX_AUTH_INVALID_RESPONSE')
  })
  it('accepts a separate HTTPS approval frontend supplied by the auth service', async () => {
    mockFetch(async () => response({ ...startPayload, verification_uri: 'https://login.example.test/device' }))
    expect((await startRoxDeviceFlow()).verificationUriComplete).toBe('https://login.example.test/device')
  })
  it('accepts newly registered users whose optional display name has not been set', async () => {
    mockFetch(async () => response({ ...approvedPayload, user: { id: 'new-user', email: 'new@example.test', name: null } }))
    expect(await pollRoxDeviceFlow('synthetic-device')).toMatchObject({ status: 'approved', user: { id: 'new-user', name: '' } })
  })
  it.each([429, 502, 503, 504])('keeps valid approval alive on an HTML %d response', async status => {
    mockFetch(async () => new Response('<html>Temporary outage</html>', { status, headers: { 'retry-after': '7' } }))
    expect(await pollRoxDeviceFlow('synthetic-device')).toEqual({ status: 'pending', interval: 7 })
  })
  it('recognizes standard authorization pending/slowdown and denial responses', async () => {
    for (const error of ['authorization_pending', 'slow_down']) {
      mockFetch(async () => response({ error }, 400))
      expect(await pollRoxDeviceFlow('synthetic-device')).toEqual({ status: 'pending', interval: error === 'slow_down' ? 10 : 5 })
    }
    mockFetch(async () => response({ error: 'access_denied' }, 400))
    await expect(pollRoxDeviceFlow('synthetic-device')).rejects.toThrow('ROX_CONNECT_DENIED')
  })
  it('sanitizes malformed JSON and never echoes a token-bearing response', async () => {
    mockFetch(async () => new Response('{ synthetic-token', { status: 200 }))
    await expect(pollRoxDeviceFlow('synthetic-device')).rejects.toThrow('ROX_AUTH_INVALID_RESPONSE')
    mockFetch(async () => response({ access_token: 'synthetic-token', user: null }))
    await expect(pollRoxDeviceFlow('synthetic-device')).rejects.toThrow('ROX_AUTH_INVALID_RESPONSE')
  })
  it('cancels an in-flight request immediately and cannot return late approval', async () => {
    const controller = new AbortController()
    mockFetch(async (_input, init) => new Promise((_resolve, reject) => {
      init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason), { once: true })
    }))
    const waiting = waitForRoxDeviceApproval('synthetic-device', { signal: controller.signal })
    controller.abort()
    await expect(waiting).rejects.toThrow('ROX_CONNECT_CANCELLED')
  })
  it('cancels the pending interval without waiting five seconds', async () => {
    const controller = new AbortController()
    let requested = false
    mockFetch(async () => { requested = true; return response({ status: 'pending', interval: 5 }) })
    const waiting = waitForRoxDeviceApproval('synthetic-device', { signal: controller.signal })
    while (!requested) await Bun.sleep(1)
    await Bun.sleep(1)
    controller.abort()
    await expect(waiting).rejects.toThrow('ROX_CONNECT_CANCELLED')
  })
  it('limits retry time on a disconnected network to the device deadline', async () => {
    mockFetch(async () => { throw new TypeError('network unavailable') })
    await expect(waitForRoxDeviceApproval('synthetic-device', { timeoutMs: 20 })).rejects.toThrow('DEVICE_CODE_EXPIRED')
  })
  it('honors cancellation even when fetch returns approval after ignoring its signal', async () => {
    const controller = new AbortController()
    mockFetch(async () => { controller.abort(); return response(approvedPayload) })
    await expect(waitForRoxDeviceApproval('synthetic-device', { signal: controller.signal })).rejects.toThrow('ROX_CONNECT_CANCELLED')
  })
})
