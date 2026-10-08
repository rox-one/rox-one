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
import { CommandStoreUnavailable, InMemoryCommandStore, someErrorInChain, type CommandStore, type CommandStoreTransaction } from '../store'
import { ACTOR, WS, envelope, testRegistry } from './helpers'

/** Wraps the in-memory store; `failNext` makes the next N operations throw like a lost connection. */
class FlakyStore implements CommandStore {
  readonly inner = new InMemoryCommandStore()
  failTransactions = 0
  failFinds = 0
  failCommit = false
  /** Next commit throws this (deterministic) error instead. */
  commitError: unknown = null
  /** Next findReceipt throws this error instead. */
  findError: unknown = null
  /** Driver-like classification: connection loss, serialization, pool timeout (cause chain walked). */
  transient = (error: unknown) => someErrorInChain(error, candidate => {
    const record = candidate as { code?: string; errno?: string; message?: string }
    return record.code === 'ECONNRESET' || record.code === 'ERR_POSTGRES_CONNECTION_CLOSED' ||
      record.errno === '40001' || record.errno === '40P01' || record.message === 'pool timeout'
  })
  async transaction<T>(workspaceId: string, fn: (tx: CommandStoreTransaction) => Promise<T>): Promise<T> {
    if (this.failTransactions > 0) { this.failTransactions -= 1; throw Object.assign(new Error('Connection terminated'), { code: 'ERR_POSTGRES_CONNECTION_CLOSED' }) }
    return this.inner.transaction(workspaceId, async tx => {
      const result = await fn(tx)
      if (this.failCommit) { this.failCommit = false; throw Object.assign(new Error('could not serialize access'), { errno: '40001' }) }
      if (this.commitError) { const error = this.commitError; this.commitError = null; throw error }
      return result
    })
  }
  async findReceipt(...args: Parameters<CommandStore['findReceipt']>) {
    if (this.failFinds > 0) { this.failFinds -= 1; throw new Error('pool timeout') }
    if (this.findError) { const error = this.findError; this.findError = null; throw error }
    return this.inner.findReceipt(...args)
  }
  listEvents(...args: Parameters<CommandStore['listEvents']>) { return this.inner.listEvents(...args) }
  isTransientError(error: unknown) { return this.transient(error) }
  /** Postgres-like data errors (SQLSTATE class 22). */
  isDataError(error: unknown) { return someErrorInChain(error, c => String((c as { errno?: string }).errno ?? '').startsWith('22')) }
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

describe('review 2: only transient store errors are retryable; the rest are terminal INTERNAL receipts', () => {
  test('25P02 (in failed sql transaction) at commit → INTERNAL receipt, nothing committed, not thrown', async () => {
    const f = setup()
    const store = f.store as FlakyStore
    store.commitError = Object.assign(new Error('current transaction is aborted, commands ignored until end of transaction block'), { errno: '25P02' })
    const env = envelope('test.increment', {}, { commandId: 'c-25p02' })
    const receipt = await f.run(env)
    expect(receipt).toMatchObject({ status: 'rejected', error: { code: 'INTERNAL' } })
    expect(store.inner.counts()).toEqual({ receipts: 0, events: 0 })
    expect(f.storeErrors).toHaveLength(1)
  })

  test('a deterministic receipt-lookup error (pre-policy replay) → INTERNAL, a pool timeout → retryable', async () => {
    const f = setup()
    const store = f.store as FlakyStore
    store.findError = Object.assign(new Error('invalid byte sequence for encoding "UTF8": 0x00'), { errno: '22021' })
    expect(await f.run(envelope('test.increment', {}, { commandId: 'c-22021' }))).toMatchObject({ status: 'rejected', error: { code: 'INTERNAL' } })
    store.failFinds = 1
    await expect(f.run(envelope('test.increment', {}, { commandId: 'c-pool' }))).rejects.toBeInstanceOf(CommandStoreUnavailable)
  })

  test('a handler error wrapping a deadlock (error.cause) is retryable; a wrapped constraint error is terminal', async () => {
    const f = setup()
    f.registry.unbind('test.increment')
    let mode: 'deadlock' | 'constraint' | 'ok' = 'deadlock'
    f.registry.bind('test.increment', async () => {
      if (mode === 'deadlock') {
        throw new Error('task repository failed', { cause: new Error('query failed', { cause: Object.assign(new Error('deadlock detected'), { errno: '40P01' }) }) })
      }
      if (mode === 'constraint') throw new Error('task repository failed', { cause: Object.assign(new Error('violates check constraint'), { errno: '23514' }) })
      return { revision: 1 }
    })
    const env = envelope('test.increment', {}, { commandId: 'c-dead' })
    await expect(f.run(env)).rejects.toBeInstanceOf(CommandStoreUnavailable)
    mode = 'constraint'
    expect(await f.run(envelope('test.increment', {}, { commandId: 'c-23514' }))).toMatchObject({ status: 'rejected', error: { code: 'INTERNAL' } })
    mode = 'ok'
    expect(await f.run(env)).toMatchObject({ status: 'applied' })
  })

  test('BEGIN failure is retryable even when the error itself is not classified transient', async () => {
    const f = setup()
    const store = f.store as FlakyStore
    store.transient = () => false
    store.failTransactions = 1
    await expect(f.run(envelope('test.increment', {}, { commandId: 'c-begin' }))).rejects.toBeInstanceOf(CommandStoreUnavailable)
  })

  test('someErrorInChain walks causes and AggregateError members, bounded and cycle-safe', () => {
    const leaf = Object.assign(new Error('x'), { code: 'HIT' })
    const hit = (e: unknown) => (e as { code?: string }).code === 'HIT'
    expect(someErrorInChain(new Error('a', { cause: new Error('b', { cause: leaf }) }), hit)).toBe(true)
    expect(someErrorInChain(new AggregateError([new Error('n'), leaf]), hit)).toBe(true)
    const cyclic = new Error('c') as Error & { cause?: unknown }
    cyclic.cause = cyclic
    expect(someErrorInChain(cyclic, hit)).toBe(false)
    let deep: unknown = leaf
    for (let i = 0; i < 20; i += 1) deep = new Error(`w${i}`, { cause: deep })
    expect(someErrorInChain(deep, hit)).toBe(false)
  })
})

describe('review 3: read-only lookups retry everything except data errors; transient authorizer failures retry', () => {
  test('an unclassified lookup failure (real driver code the classifier may not know) is retryable', async () => {
    const f = setup()
    const store = f.store as FlakyStore
    store.findError = Object.assign(new Error('Failed to connect'), { code: 'ERR_POSTGRES_SOMETHING_NEW' })
    await expect(f.run(envelope('test.increment', {}, { commandId: 'c-unknown' }))).rejects.toBeInstanceOf(CommandStoreUnavailable)
    store.findError = new TypeError('socket hang up')
    await expect(f.run(envelope('test.increment', {}, { commandId: 'c-type' }))).rejects.toBeInstanceOf(CommandStoreUnavailable)
    expect(store.inner.counts()).toEqual({ receipts: 0, events: 0 })
  })

  test('a store without isDataError retries every lookup failure', async () => {
    const f = setup()
    const store = f.store as FlakyStore & { isDataError?: unknown }
    Object.defineProperty(store, 'isDataError', { value: undefined })
    store.findError = Object.assign(new Error('invalid byte sequence'), { errno: '22021' })
    await expect(f.run(envelope('test.increment', {}, { commandId: 'c-nodata' }))).rejects.toBeInstanceOf(CommandStoreUnavailable)
  })

  test('authorizer: transient throw → CommandStoreUnavailable, other throw → FORBIDDEN, nothing runs', async () => {
    let mode: 'transient' | 'bug' | 'ok' = 'transient'
    const authorizer: Authorizer = {
      can: async () => {
        if (mode === 'transient') throw new Error('acl lookup failed', { cause: Object.assign(new Error('deadlock detected'), { errno: '40P01' }) })
        if (mode === 'bug') throw new TypeError('acl bug')
        return true
      },
    }
    const f = setup({ authorizer })
    const env = envelope('test.increment', {}, { commandId: 'c-acl-blip' })
    await expect(f.run(env)).rejects.toBeInstanceOf(CommandStoreUnavailable)
    mode = 'bug'
    expect(await f.run(envelope('test.increment', {}, { commandId: 'c-acl-bug' }))).toMatchObject({ status: 'rejected', error: { code: 'FORBIDDEN' } })
    expect(f.state.calls).toBe(0)
    mode = 'ok'
    expect(await f.run(env)).toMatchObject({ status: 'applied' })
  })
})
