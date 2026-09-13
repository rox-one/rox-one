import { describe, it, expect, beforeEach } from 'bun:test'
import { parseNlDate, parseQuickEntry, startOfLocalDay } from './dates.ts'
import { buildTodayPlan, filterAndSortTasks, projectTasks, tasksForProject, tasksLinkedTo } from './projections.ts'
import { PersonalTaskStore, resetPersonalTaskIds } from './store.ts'

const morning = startOfLocalDay(Date.now()) + 9 * 60 * 60 * 1000

describe('personal tasks (issue 17)', () => {
  beforeEach(() => {
    resetPersonalTaskIds()
  })

  it('parses natural-language dates', () => {
    const today = parseNlDate('today evening', morning)
    expect(today?.list).toBe('today')
    expect(today?.evening).toBe(true)
    const tomorrow = parseNlDate('tomorrow', morning)
    expect(tomorrow?.list).toBe('upcoming')
    const iso = parseNlDate('2026-09-20', morning)
    expect(iso?.list).toBe('upcoming')
  })

  it('quick-enters a titled task with a date token stripped', () => {
    const parsed = parseQuickEntry('Buy milk tomorrow evening', morning)
    expect(parsed.title).toBe('Buy milk')
    expect(parsed.parsed?.evening).toBe(true)
    expect(parsed.parsed?.list).toBe('upcoming')
  })

  it('projects Inbox/Today/Upcoming/Anytime/Someday/Logbook', () => {
    const store = new PersonalTaskStore()
    store.create({ title: 'Triage this', list: 'inbox', now: morning })
    const today = store.create({ title: 'Ship inspect', list: 'today', dueAt: morning, now: morning })
    store.create({ title: 'Later', list: 'upcoming', dueAt: morning + 3 * 86400000, now: morning })
    store.create({ title: 'Whenever', list: 'anytime', now: morning })
    store.create({ title: 'Dream', list: 'someday', now: morning })
    store.complete(today.id, morning + 1000)

    const tasks = store.list()
    expect(projectTasks(tasks, morning, 'inbox')).toHaveLength(1)
    expect(projectTasks(tasks, morning, 'today').map((t) => t.title)).not.toContain('Ship inspect')
    expect(projectTasks(tasks, morning, 'upcoming')).toHaveLength(1)
    expect(projectTasks(tasks, morning, 'anytime')).toHaveLength(1)
    expect(projectTasks(tasks, morning, 'someday')).toHaveLength(1)
    expect(projectTasks(tasks, morning, 'logbook').map((t) => t.title)).toEqual(['Ship inspect'])
  })

  it('keeps provenance links when completing a task', () => {
    const store = new PersonalTaskStore()
    const task = store.create({
      title: 'Follow up',
      list: 'today',
      now: morning,
      links: [
        { kind: 'note', id: 'note-1' },
        { kind: 'session', id: 'sess-1' },
      ],
    })
    store.complete(task.id, morning)
    const completed = store.get(task.id)!
    expect(completed.completedAt).toBe(morning)
    expect(completed.links).toEqual([
      { kind: 'note', id: 'note-1' },
      { kind: 'session', id: 'sess-1' },
    ])
    expect(tasksLinkedTo(store.list(), 'note', 'note-1')[0]?.id).toBe(task.id)
  })

  it('builds a today plan grouped by time and project', () => {
    const store = new PersonalTaskStore()
    const project = store.addProject('Rox')
    store.create({ title: 'Morning review', list: 'today', dueAt: startOfLocalDay(morning) + 9 * 3600000, projectId: project.id, now: morning })
    store.create({ title: 'Evening pack', list: 'today', evening: true, projectId: project.id, now: morning })
    const groups = buildTodayPlan(store.list(), morning)
    expect(groups.some((g) => g.bucket === 'morning' && g.projectId === project.id)).toBe(true)
    expect(groups.some((g) => g.bucket === 'evening' && g.tasks[0]?.title === 'Evening pack')).toBe(true)
  })

  it('round-trips import/export and records audit history', () => {
    const store = new PersonalTaskStore()
    store.create({ title: 'Keep', list: 'inbox', now: morning })
    const json = store.exportJson()
    const restored = PersonalTaskStore.fromJson(json)
    expect(restored.list()).toHaveLength(1)
    expect(restored.list()[0]?.title).toBe('Keep')
    expect(store.auditLog().some((event) => event.action === 'create')).toBe(true)
  })

  it('supports areas, headings, subtasks, tags, priority and recurrence', () => {
    const store = new PersonalTaskStore()
    const area = store.addArea('Home')
    const project = store.addProject('Kitchen', area.id)
    const heading = store.addHeading('Appliances', project.id)
    const parent = store.create({
      title: 'Replace filter',
      list: 'anytime',
      projectId: project.id,
      areaId: area.id,
      headingId: heading.id,
      tags: ['maintenance'],
      priority: 'high',
      recurrence: { rule: 'monthly', interval: 1 },
      now: morning,
    })
    const child = store.addSubtask(parent.id, 'Buy carbon filter', morning)
    expect(child.parentId).toBe(parent.id)
    expect(parent.recurrence?.rule).toBe('monthly')
    expect(parent.priority).toBe('high')
  })

  it('reorders within a list without dropping fields', () => {
    const store = new PersonalTaskStore()
    const a = store.create({ title: 'A', list: 'inbox', now: morning })
    const b = store.create({ title: 'B', list: 'inbox', now: morning })
    store.reorder([b.id, a.id])
    expect(store.get(b.id)?.order).toBe(0)
    expect(store.get(a.id)?.order).toBe(1)
    expect(store.get(a.id)?.title).toBe('A')
  })

  it('lists every open task and filters/sorts by workspace project id', () => {
    const store = new PersonalTaskStore()
    const inbox = store.create({ title: 'Inbox item', list: 'inbox', projectId: 'proj-alpha', now: morning })
    store.create({ title: 'Later', list: 'upcoming', projectId: 'proj-beta', dueAt: morning + 86400000, now: morning })
    store.create({ title: 'Today', list: 'today', projectId: 'proj-alpha', now: morning })
    const all = filterAndSortTasks(store.list(), morning, { filter: 'all', sort: 'title' })
    expect(all.map((task) => task.title)).toEqual(['Inbox item', 'Later', 'Today'])
    expect(filterAndSortTasks(store.list(), morning, { filter: 'all', projectId: 'proj-alpha' })).toHaveLength(2)
    expect(tasksForProject(store.list(), 'proj-beta')[0]?.title).toBe('Later')
    store.update(inbox.id, { priority: 'high' })
    expect(filterAndSortTasks(store.list(), morning, { filter: 'all', sort: 'priority' })[0]?.id).toBe(inbox.id)
  })
})
