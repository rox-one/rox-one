/**
 * W1-03 (#1500) review 4 (server-core): transient middleware errors stay
 * retryable, the event bus rotates a log past the seq-counter cap (even when
 * retained), retainers keep an idle log, and a replay without an epoch can't
 * resume from a non-zero seq.
 */
import { describe, expect, test } from 'bun:test'
import type { CommandMiddleware } from '@rox/core/commands'
import { TopicLog, type DomainEvent } from '@rox/core/events'
import { DEFAULT_MAX_SEQ_COUNTERS_PER_WORKSPACE, InProcessEventBus } from '../event-bus'
import { CommandExecutor } from '../executor'
import { CommandStoreUnavailable, InMemoryCommandStore, someErrorInChain } from '../store'
import { ACTOR, WS, envelope, testRegistry } from './helpers'

describe('middleware errors', () => {
  function setup(fail: () => unknown) {
    const { registry, state } = testRegistry()
    const store = Object.assign(new InMemoryCommandStore(), {
      isTransientError: (error: unknown) => someErrorInChain(error, c => (c as { errno?: string }).errno === '57P05'),
    })
    const storeErrors: unknown[] = []
    const handlerErrors: unknown[] = []
    const executor = new CommandExecutor({ registry, store, authority: 'local', onStoreError: e => storeErrors.push(e), onHandlerError: e => handlerErrors.push(e) })
    const middleware: CommandMiddleware = { name: 'test.policy', async run(_ctx, next) { const error = fail(); if (error) throw error; return next() } }
    executor.use(middleware)
    return { executor, state, storeErrors, handlerErrors, run: (env: unknown) => executor.execute({ workspaceId: WS, actor: ACTOR, envelope: env }) }
  }

  test('a transient middleware throw → CommandStoreUnavailable (503, kept in the outbox); the retry applies once', async () => {
    let error: unknown = new Error('rate-limit read failed', { cause: Object.assign(new Error('idle session timeout'), { errno: '57P05' }) })
    const f = setup(() => error)
    const env = envelope('test.increment', {}, { commandId: 'c-mw' })
    await expect(f.run(env)).rejects.toBeInstanceOf(CommandStoreUnavailable)
    expect(f.state.calls).toBe(0)
    expect(f.storeErrors).toHaveLength(1)
    error = null
    expect(await f.run(env)).toMatchObject({ status: 'applied' })
    expect(f.state.calls).toBe(1)
  })

  test('a deterministic middleware throw is still the terminal INTERNAL receipt', async () => {
    const f = setup(() => new TypeError('policy bug'))
    expect(await f.run(envelope('test.increment', {}))).toMatchObject({ status: 'rejected', error: { code: 'INTERNAL' } })
    expect(f.handlerErrors).toHaveLength(1)
  })
})

const event = (n: number, workspaceId = 'ws', id = `t${n}`): DomainEvent => ({
  eventId: `ev-${workspaceId}-${n}`, workspaceId, type: 'task.task_name_updating', subject: { kind: 'task', id },
  aggregateRevision: n, payload: {}, createdAt: 'now', sequence: n,
})

describe('seq-counter cap', () => {
  test('default cap is 50k', () => {
    expect(DEFAULT_MAX_SEQ_COUNTERS_PER_WORKSPACE).toBe(50_000)
  })

  test('an active log with more counters than the cap is rotated (new epoch → snapshot_required); others are kept', () => {
    let now = 0
    const bus = new InProcessEventBus({ epoch: 'e1', maxSeqCountersPerWorkspace: 3, now: () => new Date(now) })
    for (let i = 1; i <= 3; i++) bus.publish([event(i)]) // 3 entity topics
    bus.publish([event(1, 'other')])
    bus.evictIdle()
    expect(bus.logCount()).toBe(2) // at the cap: kept
    now = 10
    bus.publish([event(4)]) // 4 counters > 3, still active
    bus.evictIdle()
    expect(bus.logCount()).toBe(1) // ws rotated; 'other' kept
    expect(bus.epochOf('other')).toBe('e1')
    expect(bus.epochOf('ws')).toBe('e1~1')
    expect(bus.replay('ws', 'entity:task:t1', 1, 'e1').kind).toBe('snapshot_required')
    expect(bus.publish([event(5)])[0]).toMatchObject({ seq: 1, epoch: 'e1~1' })
  })

  test('a retainer never prevents the cap rotation', () => {
    const bus = new InProcessEventBus({ epoch: 'e1', maxSeqCountersPerWorkspace: 1 })
    bus.retain(() => true)
    bus.publish([event(1), event(2)])
    bus.evictIdle()
    expect(bus.logCount()).toBe(0)
  })
})

describe('retainers', () => {
  test('a retained idle log is kept (positions stay up_to_date); a disposed retainer releases it', () => {
    let now = 0
    const bus = new InProcessEventBus({ epoch: 'e1', windowIdleTtlMs: 1000, now: () => new Date(now) })
    let live = true
    const release = bus.retain(ws => live && ws === 'ws')
    bus.publish([event(1), event(1, 'other')])
    now = 5000
    bus.evictIdle()
    expect(bus.logCount()).toBe(1)
    expect(bus.replay('ws', 'entity:task:t1', 1, 'e1')).toMatchObject({ kind: 'up_to_date', epoch: 'e1' })
    live = false
    now = 10_000
    bus.evictIdle()
    expect(bus.logCount()).toBe(0)
    live = true
    bus.publish([event(2)])
    release()
    now = 20_000
    bus.evictIdle()
    expect(bus.logCount()).toBe(0)
  })

  test('a throwing retainer is reported and does not retain', () => {
    let now = 0
    const errors: unknown[] = []
    const bus = new InProcessEventBus({ epoch: 'e1', windowIdleTtlMs: 1000, now: () => new Date(now), onListenerError: e => errors.push(e) })
    bus.retain(() => { throw new Error('retainer bug') })
    bus.publish([event(1)])
    now = 5000
    bus.evictIdle()
    expect(bus.logCount()).toBe(0)
    expect(errors).toHaveLength(1)
  })
})

describe('replay without an epoch', () => {
  test('sinceSeq > 0 without an epoch → snapshot_required; sinceSeq 0 still replays', () => {
    const log = new TopicLog({ epoch: 'e1' })
    for (let i = 0; i < 3; i++) log.append('user:a', { type: 'entity.updated', payload: {}, at: 'now' })
    expect(log.replay('user:a', 2)).toMatchObject({ kind: 'snapshot_required', latestSeq: 3, epoch: 'e1' })
    expect(log.replay('user:a', 3)).toMatchObject({ kind: 'snapshot_required' })
    expect(log.replay('user:a', 0)).toMatchObject({ kind: 'events' })
    expect(log.replay('user:a', 2, 'e1')).toMatchObject({ kind: 'events' })
    const bus = new InProcessEventBus({ epoch: 'e1' })
    bus.publish([event(1)])
    expect(bus.replay('ws', 'entity:task:t1', 1).kind).toBe('snapshot_required')
    expect(bus.replay('ws', 'entity:task:t1', 1, 'e1').kind).toBe('up_to_date')
  })
})
