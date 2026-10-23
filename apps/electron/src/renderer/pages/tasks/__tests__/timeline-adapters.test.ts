import { describe, expect, it } from 'bun:test'
import type { WorkspaceTask } from '@rox/shared/workspace-work'
import { draftAfterOwnScheduleWrite, overlayAfterScheduleWrite, reconcileOptimisticDue, timelineOwnedDueInput, withOptimisticDue, workspaceDuePatch, workspaceTaskToTimeline } from '../timeline-adapters'
import { groupTasks, partitionTasks, timelineGroupTitle } from '../timeline-model'

const ws = (patch: Partial<WorkspaceTask>): WorkspaceTask => ({
  id: 'w', workspaceId: 'ws', authorId: 'u', assigneeId: null, title: 'T', description: '', status: 'todo',
  project: null, dueAt: null, links: [], revision: 1, createdAt: 1, updatedAt: 2, ...patch,
})

describe('workspace timeline adapter', () => {
  it('maps deadline, project and closed states', () => {
    const due = new Date(2026, 1, 12).getTime()
    const row = workspaceTaskToTimeline(ws({ dueAt: due, project: { workspaceId: 'ws', id: 'p1' } }))
    expect(row.projectId).toBe('p1')
    expect(partitionTasks([row], '2026-02-10').scheduled[0]!.span).toEqual({ start: '2026-02-12', end: '2026-02-12' })
    expect(workspaceTaskToTimeline(ws({ status: 'done' })).completedAt).toBe(2)
    expect(workspaceTaskToTimeline(ws({ status: 'canceled' })).cancelledAt).toBe(2)
  })
  it('groups across projects and turns any move into a deadline', () => {
    const rows = [ws({ id: 'a', project: { workspaceId: 'ws', id: 'p1' } }), ws({ id: 'b', project: { workspaceId: 'ws', id: 'p2' } }), ws({ id: 'c' })].map(workspaceTaskToTimeline)
    expect(groupTasks(rows, 'project').map((g) => g.id).sort()).toEqual(['p1', 'p2', null].sort())
    expect(workspaceDuePatch({ startAt: 5 }, null)).toBeNull()
    expect(workspaceDuePatch({}, 1)).toBeNull()
  })
})

describe('workspace deadline moves', () => {
  it('keeps the original time of day; a first deadline is the day itself', () => {
    const prev = new Date(2026, 1, 10, 14, 30).getTime()
    const day = new Date(2026, 1, 13).getTime()
    expect(workspaceDuePatch({ dueAt: day }, prev)).toBe(new Date(2026, 1, 13, 14, 30).getTime())
    expect(workspaceDuePatch({ dueAt: day }, null)).toBe(day)
  })
  it('overlays optimistic deadlines', () => {
    const rows = withOptimisticDue([ws({ id: 'a', dueAt: 1 }), ws({ id: 'b', dueAt: 2 })], new Map([['a', 9]]))
    expect(rows.map((r) => r.dueAt)).toEqual([9, 2])
  })
})

describe('timelineGroupTitle', () => {
  const t = (k: string) => `t:${k}`
  it('branches on group kind', () => {
    const g = (kind: 'list' | 'project' | 'area' | 'none', id: string | null) => ({ key: String(id), id, kind, tasks: [] as never[] })
    expect(timelineGroupTitle(g('list', 'today'), t, () => 'P', () => 'A')).toBe('t:tasks.projection.today')
    expect(timelineGroupTitle(g('project', 'p1'), t, (id) => `P:${id}`, () => 'A')).toBe('P:p1')
    expect(timelineGroupTitle(g('area', 'a1'), t, () => 'P', (id) => `A:${id}`)).toBe('A:a1')
    expect(timelineGroupTitle(g('project', null), t, () => 'P', () => 'A')).toBe('t:tasks.move.noPlace')
    expect(timelineGroupTitle(g('area', null), t, () => 'P', () => 'A')).toBe('t:tasks.move.noArea')
    expect(timelineGroupTitle(g('area', 'gone'), t, () => 'P', () => undefined)).toBe('t:tasks.move.noArea')
    expect(timelineGroupTitle(g('area', 'gone'), t, () => 'P', () => '')).toBe('t:tasks.move.noArea')
  })
})

describe('reconcileOptimisticDue', () => {
  it('keeps unmatched overlays and drops confirmed or missing tasks', () => {
    const overlay = new Map([['a', 9], ['b', 2], ['gone', 3]])
    const next = reconcileOptimisticDue(
      overlay,
      [ws({ id: 'a', dueAt: 1 }), ws({ id: 'b', dueAt: 2 })],
    )
    expect([...next.entries()]).toEqual([['a', 9]])
  })
  it('does not wipe everything on an unrelated snapshot', () => {
    const overlay = new Map([['a', 9]])
    const next = reconcileOptimisticDue(overlay, [ws({ id: 'a', dueAt: 1 }), ws({ id: 'c', dueAt: 5 })])
    expect(next.get('a')).toBe(9)
    expect(next.size).toBe(1)
  })
})


describe('timelineOwnedDueInput', () => {
  const toInput = (at: number) => `due:${at}`
  it('returns a due string only when the overlay owns the task', () => {
    const overlay = new Map([['a', 9]])
    expect(timelineOwnedDueInput(overlay, 'a', toInput)).toBe('due:9')
    expect(timelineOwnedDueInput(overlay, 'b', toInput)).toBeNull()
    expect(timelineOwnedDueInput(new Map(), 'a', toInput)).toBeNull()
  })
})

describe('overlayAfterScheduleWrite', () => {
  it('keeps the overlay on ok and skipped; drops only a rejected attempt still owned', () => {
    const overlay = new Map([['a', 9], ['b', 2]])
    expect([...overlayAfterScheduleWrite(overlay, 'a', 9, 'ok').entries()]).toEqual([['a', 9], ['b', 2]])
    expect([...overlayAfterScheduleWrite(overlay, 'a', 9, 'skipped').entries()]).toEqual([['a', 9], ['b', 2]])
    expect([...overlayAfterScheduleWrite(overlay, 'a', 9, 'rejected').entries()]).toEqual([['b', 2]])
  })
  it('does not drop when a newer drag superseded the attempted due', () => {
    const overlay = new Map([['a', 99]])
    expect(overlayAfterScheduleWrite(overlay, 'a', 9, 'rejected').get('a')).toBe(99)
  })
})

describe('draftAfterOwnScheduleWrite', () => {
  const draft = { id: 'a', expectedRevision: 3, due: 'x' }
  it('advances expectedRevision only on ok for the same open task', () => {
    expect(draftAfterOwnScheduleWrite(draft, 'a', { status: 'ok', revision: 4 })).toEqual({ id: 'a', expectedRevision: 4, due: 'x' })
    expect(draftAfterOwnScheduleWrite(draft, 'a', { status: 'ok', revision: 3 })).toBe(draft)
    expect(draftAfterOwnScheduleWrite(draft, 'b', { status: 'ok', revision: 4 })).toBe(draft)
    expect(draftAfterOwnScheduleWrite(draft, 'a', { status: 'rejected' })).toBe(draft)
    expect(draftAfterOwnScheduleWrite(draft, 'a', { status: 'skipped' })).toBe(draft)
    expect(draftAfterOwnScheduleWrite(null, 'a', { status: 'ok', revision: 4 })).toBeNull()
  })
  it('does not treat an unrelated id as own write', () => {
    const other = { id: 'other', expectedRevision: 1 }
    expect(draftAfterOwnScheduleWrite(other, 'a', { status: 'ok', revision: 9 })).toBe(other)
  })
})
