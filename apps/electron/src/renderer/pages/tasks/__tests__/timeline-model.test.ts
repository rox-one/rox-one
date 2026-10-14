import { describe, expect, it } from 'bun:test'
import type { PersonalTask } from '@rox/core/tasks/personal'
import { applySchedule, dependencyConflicts, dependencyEdges, timelineRowOrder, weekRange, weekTasks, dragPatch, dropPatch, epochOf, groupTasks, isoOf, partitionTasks, taskSpan, timelineRange } from '../timeline-model'

const today = '2026-02-10'
let n = 0
function task(patch: Partial<PersonalTask> = {}): PersonalTask {
  n += 1
  return { id: `t${n}`, title: `T${n}`, notes: '', list: 'anytime', tags: [], priority: 'none', evening: false, links: [], order: n, createdAt: 0, ...patch } as PersonalTask
}

describe('taskSpan', () => {
  it('runs from start to deadline, single dates are one day, today list starts today', () => {
    expect(taskSpan(task({ startAt: epochOf('2026-02-12'), dueAt: epochOf('2026-02-20') }), today)).toEqual({ start: '2026-02-12', end: '2026-02-20' })
    expect(taskSpan(task({ dueAt: epochOf('2026-02-20') }), today)).toEqual({ start: '2026-02-20', end: '2026-02-20' })
    expect(taskSpan(task({ list: 'today' }), today)).toEqual({ start: today, end: today })
    expect(taskSpan(task({ list: 'today', dueAt: epochOf('2026-02-15') }), today)).toEqual({ start: today, end: '2026-02-15' })
    expect(taskSpan(task(), today)).toBeNull()
    expect(taskSpan(task({ startAt: epochOf('2026-02-12'), dueAt: epochOf('2026-02-01') }), today)).toEqual({ start: '2026-02-12', end: '2026-02-12' })
  })

  it('round-trips local dates', () => {
    expect(isoOf(epochOf('2026-03-29'))).toBe('2026-03-29')
  })
})

describe('partition, range, groups', () => {
  it('separates the unscheduled tray', () => {
    const a = task({ dueAt: epochOf('2026-02-20') })
    const b = task()
    const { scheduled, unscheduled } = partitionTasks([a, b], today)
    expect(scheduled.map((s) => s.task.id)).toEqual([a.id])
    expect(unscheduled.map((t) => t.id)).toEqual([b.id])
  })

  it('pads the window and includes today', () => {
    expect(timelineRange([], today)).toEqual({ start: '2026-02-03', end: '2026-03-02' })
    const r = timelineRange([{ start: '2026-01-01', end: '2026-06-01' }], today)
    expect(r).toEqual({ start: '2025-12-25', end: '2026-06-15' })
  })

  it('groups by project, area and list with the ungrouped bucket last', () => {
    const a = task({ projectId: 'p1' })
    const b = task()
    const c = task({ projectId: 'p2' })
    const d = task({ projectId: 'p1', list: 'today' })
    expect(groupTasks([a, b, c, d], 'project').map((g) => [g.id, g.tasks.map((t) => t.id)])).toEqual([['p1', [a.id, d.id]], ['p2', [c.id]], [null, [b.id]]])
    expect(groupTasks([a, d], 'list').map((g) => g.id)).toEqual(['anytime', 'today'])
    expect(groupTasks([a, b], 'none')[0]!.tasks.length).toBe(2)
    expect(groupTasks([a], 'area').map((g) => g.id)).toEqual([null])
  })
})

describe('drag and drop patches', () => {
  it('moves only the dates a task has', () => {
    const both = task({ startAt: epochOf('2026-02-12'), dueAt: epochOf('2026-02-14') })
    expect(dragPatch(both, 'move', 3, today)).toEqual({ startAt: epochOf('2026-02-15'), dueAt: epochOf('2026-02-17') })
    const dueOnly = task({ dueAt: epochOf('2026-02-14') })
    expect(dragPatch(dueOnly, 'move', -2, today)).toEqual({ dueAt: epochOf('2026-02-12') })
    expect(dragPatch(dueOnly, 'move', 0, today)).toEqual({})
    expect(dragPatch(task(), 'move', 2, today)).toEqual({})
  })

  it('resizing an edge sets or creates that date without inverting', () => {
    const startOnly = task({ startAt: epochOf('2026-02-12') })
    expect(dragPatch(startOnly, 'end', 4, today)).toEqual({ dueAt: epochOf('2026-02-16') })
    expect(dragPatch(startOnly, 'start', -1, today)).toEqual({ startAt: epochOf('2026-02-11') })
    const both = task({ startAt: epochOf('2026-02-12'), dueAt: epochOf('2026-02-14') })
    expect(dragPatch(both, 'start', 10, today)).toEqual({ startAt: epochOf('2026-02-14') })
    expect(dragPatch(both, 'end', -10, today)).toEqual({ dueAt: epochOf('2026-02-12') })
  })

  it('dropping schedules the start', () => {
    expect(dropPatch('2026-02-18')).toEqual({ startAt: epochOf('2026-02-18') })
  })
})

describe('applySchedule', () => {
  const NOW = epochOf('2026-02-10') + 12 * 3600_000
  const fresh = () => {
    const { PersonalTaskStore } = require('@rox/core/tasks/personal') as typeof import('@rox/core/tasks/personal')
    return new PersonalTaskStore()
  }

  it('preserves evening and keeps order within the same list', () => {
    const store = fresh()
    const a = store.create({ title: 'a' })
    store.setWhen(a.id, { kind: 'date', at: epochOf('2026-02-12'), evening: true }, NOW)
    const b = store.create({ title: 'b' })
    store.setWhen(b.id, { kind: 'date', at: epochOf('2026-02-13') }, NOW)
    const order = store.get(a.id)!.order
    applySchedule(store, a.id, { startAt: epochOf('2026-02-15') }, NOW)
    expect(store.get(a.id)!.evening).toBe(true)
    expect(store.get(a.id)!.order).toBe(order)
    expect(isoOf(store.get(a.id)!.startAt!)).toBe('2026-02-15')
  })

  it('clamps today or earlier to Сегодня (evening kept) and skips unchanged days', () => {
    const store = fresh()
    const a = store.create({ title: 'a' })
    store.setWhen(a.id, { kind: 'date', at: epochOf('2026-02-12'), evening: true }, NOW)
    applySchedule(store, a.id, { startAt: epochOf('2026-02-01') }, NOW)
    expect(store.get(a.id)!.list).toBe('today')
    expect(store.get(a.id)!.startAt).toBeUndefined()
    expect(store.get(a.id)!.evening).toBe(true)
    const audit = store.auditLog().length
    applySchedule(store, a.id, { startAt: epochOf('2026-02-10') }, NOW)
    expect(store.auditLog().length).toBe(audit)
  })

  it('sets the deadline without touching the start', () => {
    const store = fresh()
    const a = store.create({ title: 'a' })
    applySchedule(store, a.id, { dueAt: epochOf('2026-02-20') }, NOW)
    expect(isoOf(store.get(a.id)!.dueAt!)).toBe('2026-02-20')
    expect(store.get(a.id)!.startAt).toBeUndefined()
  })
})

describe('timelineRowOrder', () => {
  it('lists scheduled ids in grouped row order', () => {
    const order = timelineRowOrder([], 'none', '2026-02-10')
    expect(order).toEqual([])
  })
})

describe('dependencies and Моя неделя', () => {
  const T = '2026-02-11' // Wednesday
  it('builds edges and flags finish-to-start violations', () => {
    const a = task({ id: 'a', list: 'upcoming', startAt: epochOf('2026-02-12'), dueAt: epochOf('2026-02-15') })
    const b = task({ id: 'b', list: 'upcoming', startAt: epochOf('2026-02-14'), blockedBy: ['a'] })
    const spans = new Map(partitionTasks([a, b], T).scheduled.map((s) => [s.task.id, s.span]))
    expect(dependencyEdges([a, b], spans)).toEqual([{ from: 'a', to: 'b', violated: true }])
    expect(dependencyConflicts([a, b], 'a', T).map((c) => c.blocked.id)).toEqual(['b'])
    const ok = { ...b, startAt: epochOf('2026-02-15') }
    expect(dependencyConflicts([a, ok], 'b', T)).toEqual([])
  })
  it('ignores completed blockers and unscheduled tasks', () => {
    const a = task({ id: 'a', list: 'upcoming', startAt: epochOf('2026-02-12'), dueAt: epochOf('2026-02-15'), completedAt: 1 })
    const b = task({ id: 'b', list: 'upcoming', startAt: epochOf('2026-02-13'), blockedBy: ['a'] })
    expect(dependencyConflicts([a, b], 'b', T)).toEqual([])
    expect(dependencyConflicts([task({ id: 'x', blockedBy: ['y'] }), task({ id: 'y' })], 'x', T)).toEqual([])
  })
  it('week is Monday–Sunday and keeps overlapping tasks only', () => {
    expect(weekRange(T)).toEqual({ start: '2026-02-09', end: '2026-02-15' })
    expect(weekRange('2026-02-15')).toEqual({ start: '2026-02-09', end: '2026-02-15' })
    const inWeek = task({ id: 'in', list: 'upcoming', startAt: epochOf('2026-02-14') })
    const later = task({ id: 'later', list: 'upcoming', startAt: epochOf('2026-02-20') })
    expect(weekTasks([inWeek, later], T).map((x) => x.id)).toEqual(['in'])
  })
})
