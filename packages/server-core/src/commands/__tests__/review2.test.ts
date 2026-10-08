/**
 * W1-03 (#1500) review 2 regressions (server-core): SQLite cause-chain
 * classification, poison projectors in the event bus.
 */
import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DomainEvent } from '@rox/core/events'
import { EventProjectionRegistry } from '@rox/core/events'
import { InProcessEventBus } from '../event-bus'
import { SqliteCommandStore, isTransientSqliteError } from '../local-store'

describe('SqliteCommandStore.isTransientError walks error.cause', () => {
  test('wrapped SQLITE_BUSY is transient; wrapped constraint errors are not', () => {
    const root = mkdtempSync(join(tmpdir(), 'rox-cmd-review2-'))
    try {
      const store = new SqliteCommandStore({ workspaceRoot: root })
      const busy = Object.assign(new Error('database is locked'), { code: 'SQLITE_BUSY' })
      expect(store.isTransientError(busy)).toBe(true)
      expect(store.isTransientError(new Error('handler failed', { cause: new Error('query', { cause: busy }) }))).toBe(true)
      expect(store.isTransientError(new Error('handler failed', { cause: Object.assign(new Error('UNIQUE constraint failed'), { code: 'SQLITE_CONSTRAINT' }) }))).toBe(false)
      expect(isTransientSqliteError(new Error('x', { cause: busy }))).toBe(false) // single-error predicate
      store.close?.()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

const event = (n: number, type = 'system.pinged'): DomainEvent => ({
  eventId: `ev-${n}`, workspaceId: 'ws', type: type as DomainEvent['type'], actorId: 'u1', causationId: `c-${n}`,
  aggregateRevision: 0, payload: { nonce: String(n) }, createdAt: 'now', sequence: n,
})

describe('InProcessEventBus: poison projectors and redelivery', () => {
  test('a throwing projector skips only its event; later events are sequenced in order', () => {
    const projections = new EventProjectionRegistry()
    projections.register('system.pinged', e => { if (e.eventId === 'ev-2') throw new Error('poison'); return [] })
    const errors: unknown[] = []
    const bus = new InProcessEventBus({ projections, epoch: 'e1', onListenerError: error => errors.push(error) })
    const seen: number[] = []
    bus.subscribe((_ws, frame) => seen.push(frame.seq))
    const frames = bus.publish([event(1), event(2), event(3)])
    expect(errors).toHaveLength(1)
    expect(frames.map(frame => [frame.seq, frame.eventId])).toEqual([[1, 'ev-1'], [2, 'ev-3']])
    expect(seen).toEqual([1, 2])
  })

  test('redelivering already-published events neither re-sequences nor re-notifies', () => {
    const bus = new InProcessEventBus({ epoch: 'e1' })
    const seen: Array<[number, string]> = []
    bus.subscribe((_ws, frame) => seen.push([frame.seq, frame.eventId ?? '']))
    bus.publish([event(1), event(2)])
    expect(bus.publish([event(1), event(2), event(3)]).map(frame => frame.seq)).toEqual([3])
    expect(seen).toEqual([[1, 'ev-1'], [2, 'ev-2'], [3, 'ev-3']])
    expect(bus.latest('ws', 'user:u1')).toBe(3)
  })
})
