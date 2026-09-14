import { describe, expect, it } from 'bun:test'
import { startOfDay } from 'date-fns'
import {
  catalogLabelOrId,
  emptyListGroupBuckets,
  getListGroupKey,
  listCrossGroupDropAction,
  listRankReorderRequest,
  resolveListGroupingMode,
  withEmptyListGroups,
} from '../list-grouping'
import type { SessionMeta } from '@/atoms/sessions'

function meta(overrides: Partial<SessionMeta> = {}): SessionMeta {
  return {
    id: overrides.id ?? 's-1',
    workspaceId: 'ws-1',
    ...overrides,
  } as SessionMeta
}

const NOW = new Date(2026, 7, 12, 15, 0, 0).getTime()

describe('resolveListGroupingMode (Display groupBy drives list grouping)', () => {
  it('falls back to the legacy grouping mode when Display groupBy is none/unset', () => {
    expect(resolveListGroupingMode('none', 'date')).toBe('date')
    expect(resolveListGroupingMode('none', 'unread')).toBe('unread')
    expect(resolveListGroupingMode(undefined, 'project')).toBe('project')
  })

  it('maps Display groupBy dimensions onto list grouping modes', () => {
    expect(resolveListGroupingMode('status', 'date')).toBe('status')
    expect(resolveListGroupingMode('project', 'date')).toBe('project')
    expect(resolveListGroupingMode('priority', 'date')).toBe('priority')
    expect(resolveListGroupingMode('dueDate', 'date')).toBe('dueDate')
    expect(resolveListGroupingMode('label', 'date')).toBe('label')
  })

  it('keeps the none fallback even when leftover compact cycle chrome is hidden', () => {
    expect(resolveListGroupingMode('none', 'date')).toBe('date')
  })
})

describe('getListGroupKey', () => {
  it('keeps legacy key shapes for legacy modes', () => {
    const item = meta({ sessionStatus: 'in-progress', hasUnread: true, projectId: 'p1' })
    expect(getListGroupKey(item, 'status', NOW)).toBe('status-in-progress')
    expect(getListGroupKey(item, 'unread', NOW)).toBe('unread-yes')
    expect(getListGroupKey(meta({ hasUnread: false }), 'unread', NOW)).toBe('unread-no')
    expect(getListGroupKey(item, 'project', NOW)).toBe('project-p1')
    expect(getListGroupKey(meta({}), 'project', NOW)).toBe('project-__none__')
    const day = startOfDay(new Date(NOW)).toISOString()
    expect(getListGroupKey(meta({ lastMessageAt: NOW }), 'date', NOW)).toBe(day)
  })

  it('computes priority buckets with none fallback', () => {
    expect(getListGroupKey(meta({ priority: 'urgent' }), 'priority', NOW)).toBe('priority:urgent')
    expect(getListGroupKey(meta({}), 'priority', NOW)).toBe('priority:none')
  })

  it('computes due-date buckets via the shared dueBucket helper', () => {
    const todayNoon = startOfDay(new Date(NOW)).getTime() + 12 * 60 * 60 * 1000
    expect(getListGroupKey(meta({ dueDate: todayNoon }), 'dueDate', NOW)).toBe('due:today')
    expect(getListGroupKey(meta({ dueDate: NOW - 3 * 24 * 60 * 60 * 1000 }), 'dueDate', NOW)).toBe('due:overdue')
    expect(getListGroupKey(meta({ dueDate: null }), 'dueDate', NOW)).toBe('due:none')
    expect(getListGroupKey(meta({}), 'dueDate', NOW)).toBe('due:none')
  })

  it('computes label buckets from the first sorted label id', () => {
    expect(getListGroupKey(meta({ labels: ['beta', 'alpha'] }), 'label', NOW)).toBe('label:alpha')
    expect(getListGroupKey(meta({ labels: [] }), 'label', NOW)).toBe('label:none')
    expect(getListGroupKey(meta({}), 'label', NOW)).toBe('label:none')
  })
})

describe('listCrossGroupDropAction (FR-47 writable group fields)', () => {
  it('maps status buckets to setSessionStatus', () => {
    expect(listCrossGroupDropAction('status', 'status-done')).toEqual({
      metadataPatch: { sessionStatus: 'done' },
      command: { type: 'setSessionStatus', state: 'done' },
    })
  })

  it('maps project buckets to setProjectId, including the no-project bucket', () => {
    expect(listCrossGroupDropAction('project', 'project-p1')).toEqual({
      metadataPatch: { projectId: 'p1' },
      command: { type: 'setProjectId', projectId: 'p1' },
    })
    expect(listCrossGroupDropAction('project', 'project-__none__')).toEqual({
      metadataPatch: { projectId: undefined },
      command: { type: 'setProjectId', projectId: null },
    })
  })

  it('maps priority buckets to setPriority', () => {
    expect(listCrossGroupDropAction('priority', 'priority:urgent')).toEqual({
      metadataPatch: { priority: 'urgent' },
      command: { type: 'setPriority', priority: 'urgent' },
    })
  })

  it('rejects non-writable group dimensions', () => {
    expect(listCrossGroupDropAction('date', 'status-done')).toBeNull()
    expect(listCrossGroupDropAction('unread', 'unread-no')).toBeNull()
    expect(listCrossGroupDropAction('dueDate', 'due:today')).toBeNull()
    expect(listCrossGroupDropAction('label', 'label:alpha')).toBeNull()
    expect(listCrossGroupDropAction('status', 'bogus')).toBeNull()
  })
})

describe('listRankReorderRequest (FR-45)', () => {
  const peers = [
    meta({ id: 'a', rank: '0|000001' }),
    meta({ id: 'b', rank: '0|000002' }),
    meta({ id: 'c', rank: '0|000003' }),
  ]

  it('drops before the target: neighbors are previous sibling and target', () => {
    const request = listRankReorderRequest('x', 'b', true, peers)
    expect(request).toEqual({
      sessionId: 'x',
      prevId: 'a',
      nextId: 'b',
      previous: peers[0],
      next: peers[1],
    })
  })

  it('drops after the target: neighbors are target and next sibling', () => {
    const request = listRankReorderRequest('x', 'b', false, peers)
    expect(request).toEqual({
      sessionId: 'x',
      prevId: 'b',
      nextId: 'c',
      previous: peers[1],
      next: peers[2],
    })
  })

  it('handles bucket edges', () => {
    expect(listRankReorderRequest('x', 'a', true, peers)).toMatchObject({ prevId: undefined, nextId: 'a' })
    expect(listRankReorderRequest('x', 'c', false, peers)).toMatchObject({ prevId: 'c', nextId: undefined })
  })

  it('returns null when the target is not among peers', () => {
    expect(listRankReorderRequest('x', 'missing', true, peers)).toBeNull()
  })
})

describe('withEmptyListGroups', () => {
  const t = (key: string) => key

  it('is a no-op when showEmptyGroups is false or buckets are empty', () => {
    const groups = [{ key: 'status-todo', label: 'Todo', items: [{ id: 'a' }] }]
    expect(withEmptyListGroups(groups, false, [{ key: 'status-done', label: 'Done' }])).toEqual(groups)
    expect(withEmptyListGroups(groups, true, [])).toEqual(groups)
  })

  it('inserts missing status buckets in configured order and keeps populated groups', () => {
    const populated = [{ key: 'status-todo', label: 'Todo', items: [{ id: 'a' }], collapsible: true }]
    const buckets = emptyListGroupBuckets({
      mode: 'status',
      statuses: [
        { id: 'todo', label: 'Todo' },
        { id: 'done', label: 'Done' },
      ],
      projects: [],
      labels: [],
      t,
    })
    const next = withEmptyListGroups(populated, true, buckets)
    expect(next.map((g) => g.key)).toEqual(['status-todo', 'status-done'])
    expect(next[0].items).toEqual([{ id: 'a' }])
    expect(next[1].items).toEqual([])
  })

  it('labels known catalog buckets via t() and custom ids via the identifier', () => {
    const catalog: Record<string, string> = {
      'status.todo': 'Todo',
      'status.done': 'Done',
      'priority.urgent': 'Urgent',
      'priority.high': 'High',
      'priority.medium': 'Medium',
      'priority.low': 'Low',
      'priority.none': 'None',
      'collection.display.dueBucket.overdue': 'Overdue',
      'collection.display.dueBucket.today': 'Today',
      'collection.display.dueBucket.this_week': 'This week',
      'collection.display.dueBucket.later': 'Later',
      'collection.display.dueBucket.none': 'No date',
    }
    const translate = (key: string) => catalog[key] ?? key
    const empty = { statuses: [], projects: [], labels: [], t: translate }
    expect(
      emptyListGroupBuckets({
        mode: 'status',
        statuses: [
          { id: 'todo', label: 'Todo' },
          { id: 'done', label: 'Done' },
          { id: 'waiting-on-legal', label: 'Waiting on Legal' },
        ],
        projects: [],
        labels: [],
        t: translate,
      }).map((bucket) => bucket.label),
    ).toEqual(['Todo', 'Done', 'waiting-on-legal'])
    expect(emptyListGroupBuckets({ ...empty, mode: 'priority' }).map((bucket) => bucket.label)).toEqual([
      'Urgent',
      'High',
      'Medium',
      'Low',
      'None',
    ])
    expect(emptyListGroupBuckets({ ...empty, mode: 'dueDate' }).map((bucket) => bucket.label)).toEqual([
      'Overdue',
      'Today',
      'This week',
      'Later',
      'No date',
    ])
  })
})

describe('catalogLabelOrId', () => {
  it('returns the catalog string for known keys', () => {
    const t = (key: string) => (key === 'status.todo' ? 'Todo' : key)
    expect(catalogLabelOrId(t, 'status.todo', 'todo')).toBe('Todo')
    expect(catalogLabelOrId(t, 'priority.urgent', 'urgent')).toBe('urgent')
  })

  it('falls back to the identifier when t() returns the key or a non-string', () => {
    expect(catalogLabelOrId((key) => key, 'status.waiting-on-legal', 'waiting-on-legal')).toBe('waiting-on-legal')
    expect(catalogLabelOrId(() => ({ nested: true }), 'priority.custom', 'custom')).toBe('custom')
    expect(catalogLabelOrId(() => 12, 'collection.display.dueBucket.someday', 'someday')).toBe('someday')
  })
})

