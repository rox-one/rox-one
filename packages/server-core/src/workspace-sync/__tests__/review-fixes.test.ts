/**
 * W1-03 (#1500) review 1: 503 / transient failures keep the outbox entry,
 * 401 pauses in `auth_required` until the credential changes, `start()`
 * drains workspaces persisted by an earlier process, and the realtime
 * subscriber buffers frames that overtake their subscribe result.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCommandEnvelope, type CommandReceipt } from '@rox/core/commands'
import type { RealtimeEventFrame, RealtimeFrame, RealtimeSubscribeResult } from '@rox/core/events'
import { CommandExecutor } from '../../commands/executor'
import { CommandStoreUnavailable, InMemoryCommandStore } from '../../commands/store'
import { ACTOR, testRegistry } from '../../commands/__tests__/helpers'
import { WorkspaceCommandHttpClient, WorkspaceCommandSync, type WorkspaceSyncStatus } from '../client'
import { InMemoryCommandOutbox, SqliteCommandOutbox } from '../outbox'
import { RealtimeSubscriber, type RealtimeConnection } from '../realtime'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
const WS = 'ws-shared'

/** HTTP double of the workspace route: executor behind fetch, with switchable failures. */
function service() {
  const { registry, state } = testRegistry()
  const store = new InMemoryCommandStore()
  const executor = new CommandExecutor({ registry, store, authority: 'workspace' })
  const net = { storeDown: false, unauthorized: false, requests: 0, tokens: [] as string[] }
  const fetchImpl = async (_url: URL, init: RequestInit) => {
    net.requests += 1
    net.tokens.push(String((init.headers as Record<string, string>).authorization))
    if (net.unauthorized) return new Response(JSON.stringify({ error: { code: 'UNAUTHENTICATED' } }), { status: 401 })
    try {
      if (net.storeDown) throw new CommandStoreUnavailable(new Error('ECONNRESET'))
      const receipt = await executor.execute({ workspaceId: WS, actor: ACTOR, envelope: JSON.parse(String(init.body)) })
      return new Response(JSON.stringify(receipt), { status: 200 })
    } catch (error) {
      // The route's mapping: nothing committed → 503.
      if (error instanceof CommandStoreUnavailable) return new Response(JSON.stringify({ error: { code: 'SERVICE_UNAVAILABLE' } }), { status: 503 })
      throw error
    }
  }
  return { fetchImpl: fetchImpl as unknown as typeof fetch, net, state, store }
}

const remote = (n: number) => createCommandEnvelope('test.remote_increment', { by: 1, n }, { commandId: `cmd-${n}` })

describe('transient server failure', () => {
  test('503 (store unavailable) is retried, never deleted; the retry applies exactly once', async () => {
    const svc = service()
    const outbox = new InMemoryCommandOutbox()
    const receipts: CommandReceipt[] = []
    let now = 0
    const client = new WorkspaceCommandHttpClient({ baseUrl: 'http://127.0.0.1:9', token: () => 'aaa.bbb.ccc', fetch: svc.fetchImpl })
    const sync = new WorkspaceCommandSync({ outbox, transport: client, autoDrain: false, now: () => now, backoffBaseMs: 10, onReceipt: (_w, r) => receipts.push(r) })
    await sync.enqueue(WS, remote(1))
    svc.net.storeDown = true
    expect(await sync.drain(WS)).toEqual({ sent: 0, failed: 1, remaining: 1 })
    expect(await outbox.count(WS)).toBe(1)
    expect(receipts).toEqual([])
    svc.net.storeDown = false
    now = 100
    expect(await sync.drain(WS)).toEqual({ sent: 1, failed: 0, remaining: 0 })
    expect(receipts).toEqual([expect.objectContaining({ commandId: 'cmd-1', status: 'applied' })])
    expect(svc.state.calls).toBe(1)
  })
})

describe('401 → auth_required', () => {
  test('pauses without timer retries until the token changes, then resumes in order', async () => {
    const svc = service()
    const outbox = new InMemoryCommandOutbox()
    const statuses: WorkspaceSyncStatus[] = []
    let token = 'aaa.bbb.one'
    const client = new WorkspaceCommandHttpClient({ baseUrl: 'http://127.0.0.1:9', token: () => token, fetch: svc.fetchImpl })
    const sync = new WorkspaceCommandSync({ outbox, transport: client, autoDrain: false, onStatus: (_w, s) => statuses.push(s) })
    await sync.enqueue(WS, remote(1))
    await sync.enqueue(WS, remote(2))
    svc.net.unauthorized = true
    expect(await sync.drain(WS, { force: true })).toMatchObject({ sent: 0, failed: 1, remaining: 2, authRequired: true })
    expect(statuses.at(-1)).toMatchObject({ state: 'auth_required', pending: 2 })
    expect(sync.isAuthRequired(WS)).toBe(true)
    // Same token: no request at all, however often the timer fires.
    for (let i = 0; i < 5; i++) expect(await sync.drain(WS, { force: true })).toMatchObject({ sent: 0, authRequired: true })
    expect(svc.net.requests).toBe(1)
    svc.net.unauthorized = false
    token = 'aaa.bbb.two'
    expect(await sync.drain(WS)).toEqual({ sent: 2, failed: 0, remaining: 0 })
    expect(svc.net.tokens.slice(1)).toEqual(['Bearer aaa.bbb.two', 'Bearer aaa.bbb.two'])
    expect(statuses.at(-1)).toEqual({ pending: 0, state: 'idle' })
  })

  test('credentialsChanged() resumes a paused workspace explicitly', async () => {
    const svc = service()
    const outbox = new InMemoryCommandOutbox()
    const transport = { send: (ws: string, env: never) => client.send(ws, env) } // no fingerprint support
    const client = new WorkspaceCommandHttpClient({ baseUrl: 'http://127.0.0.1:9', token: () => 'aaa.bbb.ccc', fetch: svc.fetchImpl })
    const sync = new WorkspaceCommandSync({ outbox, transport, autoDrain: false })
    await sync.enqueue(WS, remote(1))
    svc.net.unauthorized = true
    await sync.drain(WS, { force: true })
    svc.net.unauthorized = false
    expect(await sync.drain(WS, { force: true })).toMatchObject({ authRequired: true })
    sync.credentialsChanged(WS)
    await Bun.sleep(5)
    expect(await outbox.count(WS)).toBe(0)
  })
})

describe('start() seeds workspaces from the persisted outbox', () => {
  test('commands left by an earlier process for another workspace are drained after restart', async () => {
    const root = mkdtempSync(join(tmpdir(), 'rox-outbox-seed-'))
    roots.push(root)
    const first = new SqliteCommandOutbox({ workspaceRoot: root })
    await first.enqueue('ws-a', remote(1), new Date().toISOString())
    await first.enqueue('ws-b', remote(2), new Date().toISOString())
    first.close?.()
    const outbox = new SqliteCommandOutbox({ workspaceRoot: root })
    expect(await outbox.workspaceIds()).toEqual(['ws-a', 'ws-b'])
    const sent: string[] = []
    const sync = new WorkspaceCommandSync({
      outbox,
      autoDrain: false,
      transport: { send: async (ws, env) => { sent.push(`${ws}:${env.commandId}`); return { commandId: env.commandId, status: 'applied' } } },
    })
    await sync.start(60_000)
    await Bun.sleep(10)
    sync.stop()
    expect(sent.sort()).toEqual(['ws-a:cmd-1', 'ws-b:cmd-2'])
    expect(await outbox.count()).toBe(0)
    outbox.close?.()
  })
})

describe('RealtimeSubscriber: frames that overtake the subscribe result', () => {
  test('a live frame arriving before the result is buffered and applied once', async () => {
    const listeners = new Set<(frame: RealtimeFrame) => void>()
    const frame = (seq: number): RealtimeEventFrame => ({ frame: 'event', topic: 'user:a', seq, epoch: 'e1', type: 'system.pinged', payload: { seq }, at: 'now' })
    const connection: RealtimeConnection = {
      async subscribe() {
        // The gateway registered the topic and pushed seq 1 before its result left (result says seq 0).
        for (const l of listeners) l(frame(1))
        await Bun.sleep(1)
        return { topics: [{ topic: 'user:a', status: 'subscribed', seq: 0, epoch: 'e1' }] } satisfies RealtimeSubscribeResult
      },
      async unsubscribe() {},
      onFrame(listener) { listeners.add(listener); return () => listeners.delete(listener) },
    }
    const seen: number[] = []
    const sub = new RealtimeSubscriber({ connection, onEvent: f => seen.push(f.seq) })
    await sub.subscribe(['user:a'])
    for (const l of listeners) l(frame(2))
    await sub.settled()
    expect(seen).toEqual([1, 2])
    expect(sub.position('user:a')).toEqual({ epoch: 'e1', seq: 2 })
  })

  test('limit_exceeded drops the topic and reports it', async () => {
    const limited: string[] = []
    const connection: RealtimeConnection = {
      subscribe: async () => ({ topics: [{ topic: 'user:a', status: 'limit_exceeded', seq: 0, epoch: 'e1' }] }),
      async unsubscribe() {},
      onFrame: () => () => {},
    }
    const sub = new RealtimeSubscriber({ connection, onEvent: () => {}, onLimitExceeded: t => limited.push(t) })
    await sub.subscribe(['user:a'])
    expect(sub.subscribed()).toEqual([])
    expect(limited).toEqual(['user:a'])
  })
})
