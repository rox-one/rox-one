import { describe, expect, it } from 'bun:test'
import type { PersonalTask } from '@rox/core/tasks/personal'
import { dragPatch, dropPatch, epochOf, groupTasks, isoOf, partitionTasks, taskSpan, timelineRange } from '../timeline-model'

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
