/**
 * W1-03 (#1500) review 2 (client side): the rejected credential is the one
 * the request used, a paused workspace is still probed slowly, a head command
 * that keeps failing is reported `stuck` (and stays first), and a subscribe
 * releases each topic's pending slot exactly once.
 */
import { describe, expect, test } from 'bun:test'
import { createCommandEnvelope } from '@rox/core/commands'
import type { RealtimeEventFrame, RealtimeFrame, RealtimeSubscribeResult } from '@rox/core/events'
import { CommandExecutor } from '../../commands/executor'
import { InMemoryCommandStore } from '../../commands/store'
import { ACTOR, testRegistry } from '../../commands/__tests__/helpers'
import { WorkspaceCommandHttpClient, WorkspaceCommandSync, WorkspaceTransportError, fingerprintCredential, type WorkspaceSyncStatus } from '../client'
import { InMemoryCommandOutbox } from '../outbox'
import { RealtimeSubscriber, type RealtimeConnection } from '../realtime'

const WS = 'ws-shared'
const remote = (n: number) => createCommandEnvelope('test.remote_increment', { by: 1, n }, { commandId: `cmd-${n}` })

function service() {
  const { registry, state } = testRegistry()
  const executor = new CommandExecutor({ registry, store: new InMemoryCommandStore(), authority: 'workspace' })
  const net = { status: 200, requests: 0, tokens: [] as string[], onRequest: (() => {}) as () => void }
  const fetchImpl = async (_url: URL, init: RequestInit) => {
    net.requests += 1
    net.tokens.push(String((init.headers as Record<string, string>).authorization).slice(7))
    net.onRequest()
    if (net.status !== 200) return new Response('{}', { status: net.status })
    const receipt = await executor.execute({ workspaceId: WS, actor: ACTOR, envelope: JSON.parse(String(init.body)) })
    return new Response(JSON.stringify(receipt), { status: 200 })
  }
  return { fetchImpl: fetchImpl as unknown as typeof fetch, net, state }
}

describe('401 while the host refreshes the token', () => {
  test('the transport error carries the fingerprint of the token the request used', async () => {
    const svc = service()
    svc.net.status = 401
    const client = new WorkspaceCommandHttpClient({ baseUrl: 'http://127.0.0.1:9', token: () => 'aaa.bbb.one', fetch: svc.fetchImpl })
    const error = await client.send(WS, remote(1)).catch(e => e)
    expect(error).toBeInstanceOf(WorkspaceTransportError)
    expect(error).toMatchObject({ status: 401, credentialFingerprint: fingerprintCredential('aaa.bbb.one') })
    expect(String(error.credentialFingerprint)).not.toContain('aaa')
  })

  test('a refresh that lands while the request is in flight resumes without a manual nudge', async () => {
    const svc = service()
    const outbox = new InMemoryCommandOutbox()
    let token = 'aaa.bbb.old'
    const client = new WorkspaceCommandHttpClient({ baseUrl: 'http://127.0.0.1:9', token: () => token, fetch: svc.fetchImpl })
    const sync = new WorkspaceCommandSync({ outbox, transport: client, autoDrain: false })
    await sync.enqueue(WS, remote(1))
    svc.net.status = 401
    svc.net.onRequest = () => { token = 'aaa.bbb.new' } // refreshed before the 401 arrives
    expect(await sync.drain(WS)).toMatchObject({ authRequired: true })
    svc.net.status = 200
    svc.net.onRequest = () => {}
    // Old code fingerprinted *after* the 401 (= the new token) and stayed paused.
    expect(await sync.drain(WS)).toEqual({ sent: 1, failed: 0, remaining: 0 })
    expect(svc.net.tokens).toEqual(['aaa.bbb.old', 'aaa.bbb.new'])
  })
})

describe('slow probe while auth_required', () => {
  test('an unchanged credential is retried once per probe interval (a 401 blip recovers)', async () => {
    const svc = service()
    const outbox = new InMemoryCommandOutbox()
    let now = 0
    const client = new WorkspaceCommandHttpClient({ baseUrl: 'http://127.0.0.1:9', token: () => 'aaa.bbb.same', fetch: svc.fetchImpl })
    const sync = new WorkspaceCommandSync({ outbox, transport: client, autoDrain: false, now: () => now, authProbeIntervalMs: 1_000 })
    await sync.enqueue(WS, remote(1))
    svc.net.status = 401
    expect(await sync.drain(WS)).toMatchObject({ authRequired: true })
    now = 500
    expect(await sync.drain(WS)).toMatchObject({ authRequired: true })
    expect(svc.net.requests).toBe(1)
    now = 1_000 // probe: still 401 → paused again, next probe in another interval
    expect(await sync.drain(WS)).toMatchObject({ authRequired: true })
    expect(svc.net.requests).toBe(2)
    now = 1_500
    await sync.drain(WS)
    expect(svc.net.requests).toBe(2)
    svc.net.status = 200 // the blip is over
    now = 2_000
    expect(await sync.drain(WS)).toEqual({ sent: 1, failed: 0, remaining: 0 })
    expect(sync.isAuthRequired(WS)).toBe(false)
  })

  test('the probe interval defaults to backoffMaxMs', async () => {
    const svc = service()
    const outbox = new InMemoryCommandOutbox()
    let now = 0
    const client = new WorkspaceCommandHttpClient({ baseUrl: 'http://127.0.0.1:9', token: () => 'aaa.bbb.same', fetch: svc.fetchImpl })
    const sync = new WorkspaceCommandSync({ outbox, transport: client, autoDrain: false, now: () => now, backoffMaxMs: 200 })
    await sync.enqueue(WS, remote(1))
    svc.net.status = 401
    await sync.drain(WS)
    now = 199
    await sync.drain(WS)
    expect(svc.net.requests).toBe(1)
    now = 200
    await sync.drain(WS)
    expect(svc.net.requests).toBe(2)
  })
})

describe('stuck head command', () => {
  test('after stuckAfterAttempts retryable failures the status is `stuck`; the command stays first', async () => {
    const svc = service()
    const outbox = new InMemoryCommandOutbox()
    const statuses: WorkspaceSyncStatus[] = []
    const client = new WorkspaceCommandHttpClient({ baseUrl: 'http://127.0.0.1:9', token: () => 'aaa.bbb.ccc', fetch: svc.fetchImpl })
    const sync = new WorkspaceCommandSync({ outbox, transport: client, autoDrain: false, stuckAfterAttempts: 3, onStatus: (_w, s) => statuses.push(s) })
    await sync.enqueue(WS, remote(1))
    await sync.enqueue(WS, remote(2))
    svc.net.status = 503
    for (let i = 0; i < 3; i++) await sync.drain(WS, { force: true })
    expect(statuses.map(s => s.state)).toEqual(['retrying', 'retrying', 'stuck'])
    expect(statuses.at(-1)).toMatchObject({ state: 'stuck', stuckCommandId: 'cmd-1', attempts: 3, pending: 2 })
    expect((await outbox.pending(WS, 10)).map(e => e.commandId)).toEqual(['cmd-1', 'cmd-2'])
    svc.net.status = 200
    const receipts: string[] = []
    const after = new WorkspaceCommandSync({ outbox, transport: client, autoDrain: false, onReceipt: (_w, r) => receipts.push(r.commandId) })
    expect(await after.drain(WS, { force: true })).toEqual({ sent: 2, failed: 0, remaining: 0 })
    expect(receipts).toEqual(['cmd-1', 'cmd-2'])
  })
})

describe('RealtimeSubscriber: one pending slot per requested topic', () => {
  test('a finished subscribe does not release a concurrent subscribe\'s buffer', async () => {
    const listeners = new Set<(frame: RealtimeFrame) => void>()
    const frame = (seq: number): RealtimeEventFrame => ({ frame: 'event', topic: 'user:a', seq, epoch: 'e1', type: 'system.pinged', payload: {}, at: 'now' })
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    let calls = 0
    const connection: RealtimeConnection = {
      async subscribe(request) {
        calls += 1
        if (calls === 2) await gate
        return { topics: request.topics.map(item => ({ topic: item.topic, status: 'subscribed' as const, seq: 0, epoch: 'e1' })) } satisfies RealtimeSubscribeResult
      },
      async unsubscribe() {},
      onFrame(listener) { listeners.add(listener); return () => listeners.delete(listener) },
    }
    const seen: number[] = []
    const sub = new RealtimeSubscriber({ connection, onEvent: f => seen.push(f.seq) })
    const first = sub.subscribe(['user:a', 'user:a']) // duplicates in one request
    const second = sub.subscribe(['user:a'])
    await first
    for (const l of listeners) l(frame(1))
    expect(seen).toEqual([]) // still buffered: the second subscribe is in flight
    release()
    await second
    expect(seen).toEqual([1])
  })
})
