import { describe, expect, it } from 'bun:test'
import { buildTasksSidebarSections, parseTasksViewKey } from '../tasks-sidebar-sections'

const base = {
  listCounts: { inbox: 3, today: 2, upcoming: 0, trash: 1, anytime: null },
  overdue: 1,
  looseProjects: [{ id: 'p1', name: 'Rox', open: 2, done: 1, total: 3 }],
  areas: [{ id: 'a1', name: 'Work', projects: [{ id: 'p2', name: 'Billing', open: 0, done: 0, total: 0 }] }],
  workspaceProjects: [{ id: 'p1', name: 'Rox', open: 2, done: 1, total: 3 }, { id: 'w1', name: 'Server', open: 1, done: 0, total: 1 }],
  tags: [{ tag: 'ui', count: 4 }],
  agents: { board: 0, running: 2, review: 0, conductor: 0 },
}

describe('buildTasksSidebarSections', () => {
  it('fixed Focus lists with counts; overdue flags Today', () => {
    const focus = buildTasksSidebarSections(base)[0]!
    expect(focus.items.map((i) => [i.id, i.count])).toEqual([
      ['list:inbox', 3], ['list:today', 2], ['list:upcoming', undefined], ['list:anytime', undefined], ['list:someday', undefined], ['list:logbook', undefined], ['list:trash', 1],
    ])
    expect(focus.items[1]!.badge).toBe('attention')
    expect(focus.limit).toBeUndefined()
  })

  it('projects: loose, area + its projects, then workspace projects without duplicates', () => {
    const projects = buildTasksSidebarSections(base).find((s) => s.id === 'projects')!
    expect(projects.items.map((i) => i.id)).toEqual(['project:p1', 'area:a1', 'project:p2', 'project:w1'])
    expect(projects.items[2]!.secondary).toBe('Work')
  })

  it('hides empty tag group', () => {
    expect(buildTasksSidebarSections({ ...base, tags: [] }).some((s) => s.id === 'tags')).toBe(false)
  })

  it('parses view keys and rejects junk', () => {
    expect(parseTasksViewKey('list:today')).toEqual({ kind: 'list', id: 'today' })
    expect(parseTasksViewKey('tag:a:b')).toEqual({ kind: 'tag', id: 'a:b' })
    expect(parseTasksViewKey('list:nope')).toBeNull()
    expect(parseTasksViewKey('bogus:x')).toBeNull()
    expect(parseTasksViewKey('project:')).toBeNull()
  })
})
