/**
 * W1-03 (#1500) review 1 regressions: transient store failures are thrown
 * (retryable), read-only idempotent replay precedes the policy stages,
 * per-workspace sequences in the in-memory store, envelope-size headroom in
 * the router.
 */
import { describe, expect, test } from 'bun:test'
import type { Authorizer } from '@rox/core/commands'
import { CommandExecutor } from '../executor'
import { CommandRouter, ENVELOPE_HEADROOM_BYTES } from '../router'
import { CommandStoreUnavailable, InMemoryCommandStore, type CommandStore, type CommandStoreTransaction } from '../store'
import { ACTOR, WS, envelope, testRegistry } from './helpers'

/** Wraps the in-memory store; `failNext` makes the next N operations throw like a lost connection. */
class FlakyStore implements CommandStore {
  readonly inner = new InMemoryCommandStore()
  failTransactions = 0
  failFinds = 0
  failCommit = false
  transient = (error: unknown) => (error as { code?: string } | null)?.code === 'ECONNRESET'
  async transaction<T>(workspaceId: string, fn: (tx: CommandStoreTransaction) => Promise<T>): Promise<T> {
    if (this.failTransactions > 0) { this.failTransactions -= 1; throw Object.assign(new Error('Connection terminated'), { code: 'ERR_POSTGRES_CONNECTION_CLOSED' }) }
    return this.inner.transaction(workspaceId, async tx => {
      const result = await fn(tx)
      if (this.failCommit) { this.failCommit = false; throw Object.assign(new Error('could not serialize access'), { errno: '40001' }) }
      return result
    })
  }
  async findReceipt(...args: Parameters<CommandStore['findReceipt']>) {
    if (this.failFinds > 0) { this.failFinds -= 1; throw new Error('pool timeout') }
    return this.inner.findReceipt(...args)
  }
  listEvents(...args: Parameters<CommandStore['listEvents']>) { return this.inner.listEvents(...args) }
  isTransientError(error: unknown) { return this.transient(error) }
}

function setup(options: { authorizer?: Authorizer; flags?: Set<string>; store?: CommandStore } = {}) {
  const { registry, state, flags } = testRegistry({ flags: options.flags })
  const store = options.store ?? new FlakyStore()
  const storeErrors: unknown[] = []
  const handlerErrors: unknown[] = []
  const executor = new CommandExecutor({
    registry, store, authority: 'local',
    onStoreError: error => storeErrors.push(error),
    onHandlerError: error => handlerErrors.push(error),
    ...(options.authorizer ? { authorizer: options.authorizer } : {}),
  })
  const run = (env: unknown, actor = ACTOR) => executor.execute({ workspaceId: WS, actor, envelope: env })
  return { executor, store, state, flags, registry, run, storeErrors, handlerErrors }
}

describe('transient store failures are retryable, not terminal receipts', () => {
  test('BEGIN / connection failure → CommandStoreUnavailable; the retry applies once', async () => {
    const f = setup()
    const store = f.store as FlakyStore
    store.failTransactions = 1
    const env = envelope('test.increment', { by: 1 }, { commandId: 'c-1' })
    await expect(f.run(env)).rejects.toBeInstanceOf(CommandStoreUnavailable)
    expect(store.inner.counts()).toEqual({ receipts: 0, events: 0 })
    expect(f.storeErrors).toHaveLength(1)
    expect(await f.run(env)).toMatchObject({ status: 'applied' })
    expect(f.state.value).toBe(1)
  })

  test('commit failure (serialization) and receipt-lookup failure are thrown too', async () => {
    const f = setup()
    const store = f.store as FlakyStore
    store.failCommit = true
    await expect(f.run(envelope('test.increment', {}, { commandId: 'c-2' }))).rejects.toBeInstanceOf(CommandStoreUnavailable)
    store.failFinds = 1
    await expect(f.run(envelope('test.increment', {}, { commandId: 'c-3' }))).rejects.toBeInstanceOf(CommandStoreUnavailable)
    expect(store.inner.counts()).toEqual({ receipts: 0, events: 0 })
  })

  test('a handler error the store classifies as transient is retryable; a handler bug stays INTERNAL', async () => {
    const f = setup()
    f.registry.unbind('test.increment')
    let mode: 'transient' | 'bug' | 'ok' = 'transient'
    f.registry.bind('test.increment', async () => {
      if (mode === 'transient') throw Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' })
      if (mode === 'bug') throw new TypeError('undefined is not a function')
      return { revision: 1 }
    })
    const env = envelope('test.increment', {}, { commandId: 'c-4' })
    await expect(f.run(env)).rejects.toBeInstanceOf(CommandStoreUnavailable)
    mode = 'bug'
    const internal = await f.run(envelope('test.increment', {}, { commandId: 'c-5' }))
    expect(internal).toMatchObject({ status: 'rejected', error: { code: 'INTERNAL' } })
    expect(f.handlerErrors).toHaveLength(1)
    mode = 'ok'
    expect(await f.run(env)).toMatchObject({ status: 'applied' })
  })
})

describe('read-only idempotent replay precedes the policy stages', () => {
  test('lost ack, then the module flag flips off → duplicate, not UNAVAILABLE', async () => {
    const f = setup({ flags: new Set() })
    f.registry.define({ type: 'test.flagged', module: 'test', authority: 'local', verb: 'write', schema: { safeParse: (v: unknown) => ({ success: true as const, data: v }) }, schemaBound: false, flag: 'test.module.v1' })
    f.registry.bind('test.flagged', async () => ({ revision: 7, result: { ok: true } }))
    f.flags.add('test.module.v1')
    const env = envelope('test.flagged', {}, { commandId: 'c-flag' })
    const first = await f.run(env)
    expect(first.status).toBe('applied')
    f.flags.delete('test.module.v1') // ack lost; the client retries after the flip
    expect(await f.run(envelope('test.flagged', {}, { commandId: 'c-new' }))).toMatchObject({ status: 'rejected', error: { code: 'UNAVAILABLE' } })
    expect(await f.run(env)).toMatchObject({ status: 'duplicate', original: first })
  })

  test('unbound handler, stricter schema and revoked ACL still answer duplicate; another actor gets IDEMPOTENCY_KEY_REUSED', async () => {
    let allow = true
    const f = setup({ authorizer: { can: async () => allow } })
    const env = envelope('test.increment', { by: 3 }, { commandId: 'c-acl' })
    const first = await f.run(env)
    f.registry.bindSchema('test.increment', { safeParse: () => ({ success: false as const, error: { issues: [{ message: 'stricter' }] } }) })
    expect(await f.run(env)).toMatchObject({ status: 'duplicate', original: first })
    expect(await f.run(envelope('test.increment', { by: 3 }))).toMatchObject({ status: 'rejected', error: { code: 'VALIDATION' } })
    f.registry.unbind('test.increment')
    allow = false
    expect(await f.run(env)).toMatchObject({ status: 'duplicate', original: first })
    expect(await f.run(env, { principalId: 'user-2', kind: 'user' })).toMatchObject({ status: 'rejected', error: { code: 'IDEMPOTENCY_KEY_REUSED' } })
    expect(await f.run({ ...env, payload: { by: 4 } })).toMatchObject({ status: 'rejected', error: { code: 'IDEMPOTENCY_KEY_REUSED' } })
    expect(f.state.calls).toBe(1)
  })
})

describe('InMemoryCommandStore', () => {
  test('sequences are per workspace even when transactions of two workspaces interleave', async () => {
    const store = new InMemoryCommandStore()
    const event = (ws: string, n: number) => ({ eventId: `${ws}-${n}`, workspaceId: ws, type: 'system.pinged' as const, aggregateRevision: 0, payload: {}, createdAt: 'now' })
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const slowA = store.transaction('a', async tx => { const stored = await tx.appendEvents([event('a', 1)]); await gate; return stored })
    const b1 = await store.transaction('b', tx => tx.appendEvents([event('b', 1)]))
    release()
    await slowA
    const b2 = await store.transaction('b', tx => tx.appendEvents([event('b', 2)]))
    expect([b1[0]!.sequence, b2[0]!.sequence]).toEqual([1, 2])
    expect((await store.listEvents('a')).map(e => e.sequence)).toEqual([1])
    expect([...(await store.latestSequences()).entries()].sort()).toEqual([['a', 1], ['b', 2]])
  })
})

describe('router: serialized envelope must fit the service body limit with headroom', () => {
  test('payload under the payload limit but envelope over the HTTP limit is rejected before queueing', async () => {
    const { registry } = testRegistry()
    const queued: unknown[] = []
    const local = new CommandExecutor({ registry, store: new InMemoryCommandStore(), authority: 'local' })
    const router = new CommandRouter({ registry, local, maxEnvelopeBytes: 4096, workspaceSink: () => ({ enqueue: async (_ws, env) => { queued.push(env); return { commandId: env.commandId, status: 'queued' } } }) })
    const big = envelope('test.remote_increment', { blob: 'x'.repeat(4096 - ENVELOPE_HEADROOM_BYTES) })
    expect(await router.route({ workspaceId: WS, actor: ACTOR, envelope: big })).toMatchObject({ status: 'rejected', error: { code: 'PAYLOAD_TOO_LARGE' } })
    expect(await router.route({ workspaceId: WS, actor: ACTOR, envelope: envelope('test.remote_increment', { blob: 'x'.repeat(1000) }) })).toMatchObject({ status: 'queued' })
    expect(queued).toHaveLength(1)
  })
})
