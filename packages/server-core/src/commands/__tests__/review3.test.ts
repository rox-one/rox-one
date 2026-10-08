/**
 * W1-03 (#1500) review 3 (server-core): event-level dedupe keeps fan-out,
 * ids-only memory released by evictIdle (idle logs dropped, new epoch),
 * per-projector isolation with an ids-only refetch fallback, and the single
 * wired registry (COMMAND_MODULES).
 */
import { describe, expect, test } from 'bun:test'
import { EventProjectionRegistry, ProjectorError, type DomainEvent, type RealtimeEventFrame } from '@rox/core/events'
import { InProcessEventBus } from '../event-bus'
import { COMMAND_MODULES, boundCommandTypes, createCommandRegistry, createWiredCommandRegistry } from '../registry'
import { getLocalCommandRegistry } from '../../handlers/rpc/commands'

const touched = (n: number, extra: Partial<DomainEvent> = {}): DomainEvent => ({
  eventId: `ev-${n}`, workspaceId: 'ws', type: 'task.task_name_updating', subject: { kind: 'task', id: 't1' },
  aggregateRevision: n, payload: {}, createdAt: 'now', sequence: n, ...extra,
})

describe('event-level dedupe never collapses legitimate publications', () => {
  test('one projector fanning out N same-type frames to one topic: all N are sequenced', () => {
    const projections = new EventProjectionRegistry({ builtIns: false })
    projections.register('task.task_name_updating', () => [1, 2, 3].map(i => ({ topic: 'entity:task:t1', type: 'entity.updated', payload: { i } })))
    const bus = new InProcessEventBus({ projections, epoch: 'e1' })
    const frames = bus.publish([touched(1)])
    expect(frames.map(f => [f.seq, (f.payload as { i: number }).i])).toEqual([[1, 1], [2, 2], [3, 3]])
    expect(bus.publish([touched(1)])).toEqual([]) // redelivery of the whole event is skipped
  })

  test('two projectors publishing the same type to the same topic both get through', () => {
    const projections = new EventProjectionRegistry({ builtIns: false })
    projections.register('task.task_name_updating', () => [{ topic: 'entity:task:t1', type: 'entity.updated', payload: { from: 'a' } }])
    projections.register('task.task_name_updating', () => [{ topic: 'entity:task:t1', type: 'entity.updated', payload: { from: 'b' } }])
    const bus = new InProcessEventBus({ projections, epoch: 'e1' })
    expect(bus.publish([touched(1)]).map(f => (f.payload as { from: string }).from)).toEqual(['a', 'b'])
  })
})

describe('dedupe memory is ids only and released by evictIdle', () => {
  test('idle logs are dropped; the next event starts a new epoch (held positions → snapshot)', () => {
    let now = 0
    const bus = new InProcessEventBus({ epoch: 'e1', windowIdleTtlMs: 1000, now: () => new Date(now) })
    const big = 'x'.repeat(64 * 1024)
    const frames = bus.publish([touched(1, { payload: { blob: big } })])
    expect(bus.claimedEventCount('ws')).toBe(1)
    expect(frames[0]!.epoch).toBe('e1')
    now = 2000
    bus.evictIdle()
    expect(bus.logCount()).toBe(0)
    expect(bus.claimedEventCount('ws')).toBe(0)
    const next = bus.publish([touched(2)])
    expect(next[0]).toMatchObject({ seq: 1, epoch: 'e1~1' })
    expect(bus.epochOf('ws')).toBe('e1~1')
    // A client holding (e1, 1) resubscribes: different epoch → snapshot_required.
    expect(bus.replay('ws', 'entity:task:t1', 1, 'e1').kind).toBe('snapshot_required')
  })

  test('a log with recent activity is kept', () => {
    let now = 0
    const bus = new InProcessEventBus({ epoch: 'e1', windowIdleTtlMs: 1000, now: () => new Date(now) })
    bus.publish([touched(1)])
    now = 500
    bus.evictIdle()
    expect(bus.logCount()).toBe(1)
  })
})

describe('projector isolation', () => {
  test('a throwing projector is reported as ProjectorError; others publish; an ids-only refetch frame goes to the subject topic', () => {
    const projections = new EventProjectionRegistry({ builtIns: false })
    projections.register('task.task_name_updating', () => { throw new Error('projector bug') })
    projections.register('task.task_name_updating', () => [{ topic: 'workspace:ws', type: 'directory.changed', payload: { ok: true } }])
    const projectorErrors: Array<[ProjectorError, string]> = []
    const listenerErrors: unknown[] = []
    const bus = new InProcessEventBus({
      projections, epoch: 'e1',
      onProjectorError: (error, event) => projectorErrors.push([error, event.eventId]),
      onListenerError: error => listenerErrors.push(error),
    })
    const frames: RealtimeEventFrame[] = bus.publish([touched(1, { payload: { name: 'secret' } })])
    expect(projectorErrors).toHaveLength(1)
    expect(projectorErrors[0]![0]).toMatchObject({ name: 'ProjectorError', eventId: 'ev-1', domainType: 'task.task_name_updating' })
    expect(projectorErrors[0]![1]).toBe('ev-1')
    expect(listenerErrors).toEqual([])
    const byTopic = Object.fromEntries(frames.map(f => [f.topic, f]))
    expect(Object.keys(byTopic).sort()).toEqual(['entity:task:t1', 'workspace:ws'].sort())
    expect(byTopic['entity:task:t1']).toMatchObject({ type: 'entity.updated', payload: { ref: { kind: 'task', id: 't1' }, revision: 1, domainType: 'task.task_name_updating' } })
    expect(JSON.stringify(byTopic['entity:task:t1']!.payload)).not.toContain('secret')
  })

  test('project() without onError propagates the tagged error', () => {
    const projections = new EventProjectionRegistry({ builtIns: false })
    projections.register('task.task_name_updating', () => { throw new Error('x') })
    expect(() => projections.project(touched(1))).toThrow(ProjectorError)
  })
})

describe('one wired registry (COMMAND_MODULES)', () => {
  test('the factory, the deprecated alias and the local RPC registry bind the same set', () => {
    const wired = boundCommandTypes(createWiredCommandRegistry())
    expect(wired).toContain('system.ping')
    expect(boundCommandTypes(createCommandRegistry())).toEqual(wired)
    expect(boundCommandTypes(getLocalCommandRegistry())).toEqual(wired)
    expect(COMMAND_MODULES.map(m => m.name)).toEqual(['system'])
  })

  test('every module binds idempotently', () => {
    const registry = createWiredCommandRegistry()
    for (const module of COMMAND_MODULES) module.bind(registry)
    expect(boundCommandTypes(registry)).toEqual(boundCommandTypes(createWiredCommandRegistry()))
  })
})
