import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCommandEnvelope, type CommandEnvelope, type CommandReceipt } from '@rox/core/commands'
import { CommandExecutor } from '../../commands/executor'
import { InMemoryCommandStore } from '../../commands/store'
import { ACTOR, testRegistry } from '../../commands/__tests__/helpers'
import { WorkspaceCommandHttpClient, WorkspaceCommandSync, WorkspaceTransportError, type WorkspaceCommandTransport, type WorkspaceSyncStatus } from '../client'
import { InMemoryCommandOutbox, SqliteCommandOutbox, type CommandOutbox } from '../outbox'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
const WS = 'ws-shared'

/** A workspace authority behind a switchable, lossy network. */
function fakeWorkspace() {
  const { registry, state } = testRegistry()
  const store = new InMemoryCommandStore()
  const server = new CommandExecutor({ registry, store, authority: 'workspace' })
  const net = { online: false, dropAckEvery: 0, requests: 0 }
  const transport: WorkspaceCommandTransport = {
    async send(workspaceId, env) {
      net.requests += 1
      if (!net.online) throw new WorkspaceTransportError('offline')
      const receipt = await server.execute({ workspaceId, actor: ACTOR, envelope: env })
      // The service applied it but the answer is lost on the way back.
      if (net.dropAckEvery > 0 && net.requests % net.dropAckEvery === 0) throw new WorkspaceTransportError('connection reset')
      return receipt
    },
  }
  return { transport, net, state, store }
}

function remote(n: number): CommandEnvelope {
  return createCommandEnvelope('test.remote_increment', { by: 1, n }, { commandId: `cmd-${String(n).padStart(4, '0')}` })
}

async function drainAll(sync: WorkspaceCommandSync, workspaceId: string, max = 100) {
  for (let i = 0; i < max; i++) {
    const result = await sync.drain(workspaceId, { force: true })
    if (result.remaining === 0) return
  }
  throw new Error('outbox did not drain')
}

describe('outbox drain after offline', () => {
  for (const kind of ['memory', 'sqlite'] as const) {
    test(`${kind}: 1,000 commands queued offline → drained with zero duplicates`, async () => {
      let outbox: CommandOutbox
      if (kind === 'sqlite') {
        const root = mkdtempSync(join(tmpdir(), 'rox-outbox-'))
        roots.push(root)
        outbox = new SqliteCommandOutbox({ workspaceRoot: root })
      } else {
        outbox = new InMemoryCommandOutbox()
      }
      const ws = fakeWorkspace()
      const receipts: CommandReceipt[] = []
      const sync = new WorkspaceCommandSync({ outbox, transport: ws.transport, autoDrain: true, backoffBaseMs: 1, backoffMaxMs: 1, onReceipt: (_w, r) => receipts.push(r) })

      for (let n = 0; n < 1000; n++) {
        const receipt = await sync.enqueue(WS, remote(n))
        expect(receipt.status).toBe('queued')
      }
      // Re-enqueueing the same command id while offline does not duplicate it.
      await sync.enqueue(WS, remote(7))
      await sync.drain(WS, { force: true })
      expect(await outbox.count(WS)).toBe(1000)
      expect(ws.state.calls).toBe(0)

      ws.net.online = true
      ws.net.dropAckEvery = 37 // every 37th answer is lost after the effect
      await drainAll(sync, WS)

      expect(await outbox.count(WS)).toBe(0)
      expect(ws.state.calls).toBe(1000)
      expect(ws.state.value).toBe(1000)
      expect(ws.store.counts()).toEqual({ receipts: 1000, events: 1000 })
      const applied = receipts.filter(r => r.status === 'applied').length
      const duplicate = receipts.filter(r => r.status === 'duplicate').length
      expect(applied + duplicate).toBe(1000)
      expect(duplicate).toBeGreaterThan(0)
      // Every command produced exactly one terminal receipt, in FIFO order.
      expect(receipts.map(r => r.commandId)).toEqual(Array.from({ length: 1000 }, (_, n) => `cmd-${String(n).padStart(4, '0')}`))
      outbox.close?.()
    }, 60_000)
  }

  test('transport failure keeps order and backs off exponentially', async () => {
    let now = 1_000
    const outbox = new InMemoryCommandOutbox()
    const ws = fakeWorkspace()
    const statuses: WorkspaceSyncStatus[] = []
    const sync = new WorkspaceCommandSync({ outbox, transport: ws.transport, autoDrain: false, now: () => now, backoffBaseMs: 100, backoffMaxMs: 250, onStatus: (_w, s) => statuses.push(s) })
    await sync.enqueue(WS, remote(1))
    await sync.enqueue(WS, remote(2))
    expect(await sync.drain(WS)).toEqual({ sent: 0, failed: 1, remaining: 2 })
    let [head] = await outbox.pending(WS, 1)
    expect(head).toMatchObject({ commandId: 'cmd-0001', attempts: 1, nextAttemptAt: 1_100, lastError: 'offline' })
    expect(await sync.drain(WS)).toEqual({ sent: 0, failed: 0, remaining: 2 }) // still backing off
    now = 1_100
    await sync.drain(WS)
    ;[head] = await outbox.pending(WS, 1)
    expect(head).toMatchObject({ attempts: 2, nextAttemptAt: 1_300 })
    now = 1_300
    await sync.drain(WS)
    ;[head] = await outbox.pending(WS, 1)
    expect(head!.nextAttemptAt).toBe(1_550) // capped at 250
    ws.net.online = true
    now = 2_000
    expect(await sync.drain(WS)).toEqual({ sent: 2, failed: 0, remaining: 0 })
    expect(statuses.at(-1)).toEqual({ pending: 0, state: 'idle' })
  })

  test('sqlite outbox survives a restart with private files', async () => {
    const root = mkdtempSync(join(tmpdir(), 'rox-outbox-'))
    roots.push(root)
    let outbox = new SqliteCommandOutbox({ workspaceRoot: root })
    expect(statSync(outbox.dbPath).mode & 0o777).toBe(0o600)
    await outbox.enqueue(WS, remote(1), 'now')
    await outbox.enqueue('other-ws', remote(2), 'now')
    outbox.close()
    outbox = new SqliteCommandOutbox({ workspaceRoot: root })
    expect((await outbox.pending(WS, 10)).map(e => e.envelope.commandId)).toEqual(['cmd-0001'])
    expect(await outbox.count()).toBe(2)
    outbox.close()
  })
})

describe('WorkspaceCommandHttpClient', () => {
  const env = createCommandEnvelope('system.ping', {}, { commandId: 'h1' })
  const client = (fetchImpl: (url: URL, init: RequestInit) => Promise<Response>) =>
    new WorkspaceCommandHttpClient({ baseUrl: 'http://127.0.0.1:9', token: () => 'tok', fetch: fetchImpl as unknown as typeof fetch })

  test('posts the envelope with the bearer token and decodes the receipt', async () => {
    let seen: { url: string; init: RequestInit } | null = null
    const receipt = await client(async (url, init) => {
      seen = { url: String(url), init }
      return Response.json({ commandId: 'h1', status: 'applied', eventIds: ['e'] })
    }).send('w 1', env)
    expect(receipt).toEqual({ commandId: 'h1', status: 'applied', eventIds: ['e'] })
    expect(seen!.url).toBe('http://127.0.0.1:9/v1/workspaces/w%201/commands')
    expect((seen!.init.headers as Record<string, string>).authorization).toBe('Bearer tok')
    expect(JSON.parse(String(seen!.init.body))).toMatchObject({ commandId: 'h1', type: 'system.ping' })
  })

  test('rejected receipts are terminal; 5xx/429/401/network are retryable', async () => {
    expect(await client(async () => Response.json({ commandId: 'h1', status: 'rejected', error: { code: 'FORBIDDEN', message: 'no' } }, { status: 403 })).send('w', env))
      .toMatchObject({ status: 'rejected', error: { code: 'FORBIDDEN' } })
    expect(await client(async () => new Response('', { status: 404 })).send('w', env)).toMatchObject({ error: { code: 'SERVER_REQUIRED' } })
    expect(await client(async () => Response.json({ error: { code: 'BODY_TOO_LARGE' } }, { status: 413 })).send('w', env)).toMatchObject({ error: { code: 'PAYLOAD_TOO_LARGE' } })
    expect(await client(async () => Response.json({ error: { code: 'INVALID_PAYLOAD' } }, { status: 400 })).send('w', env)).toMatchObject({ error: { code: 'VALIDATION' } })
    for (const status of [500, 503, 429, 401, 408]) {
      await expect(client(async () => new Response('x', { status })).send('w', env)).rejects.toBeInstanceOf(WorkspaceTransportError)
    }
    await expect(client(async () => { throw new TypeError('ECONNREFUSED') }).send('w', env)).rejects.toBeInstanceOf(WorkspaceTransportError)
    await expect(client(async () => Response.json({ commandId: 'other', status: 'applied' })).send('w', env)).rejects.toBeInstanceOf(WorkspaceTransportError)
  })

  test('refuses plain http to non-loopback hosts', () => {
    expect(() => new WorkspaceCommandHttpClient({ baseUrl: 'http://example.com', token: () => 't' })).toThrow(/https/)
    expect(() => new WorkspaceCommandHttpClient({ baseUrl: 'https://example.com', token: () => 't' })).not.toThrow()
  })
})
