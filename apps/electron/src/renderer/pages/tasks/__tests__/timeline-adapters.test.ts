import { describe, expect, it } from 'bun:test'
import type { WorkspaceTask } from '@rox/shared/workspace-work'
import { workspaceDuePatch, workspaceTaskToTimeline } from '../timeline-adapters'
import { groupTasks, partitionTasks } from '../timeline-model'

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
    expect(workspaceDuePatch({ startAt: 5 })).toBe(5)
    expect(workspaceDuePatch({ startAt: 5, dueAt: 9 })).toBe(9)
    expect(workspaceDuePatch({})).toBeNull()
  })
})
