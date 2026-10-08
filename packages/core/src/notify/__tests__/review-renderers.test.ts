/**
 * W1-09 (#1506) — Review model, renderer registry and the `notifications.*`
 * command bindings.
 */
import { describe, expect, it } from 'bun:test'
import { CommandRegistry, registerCommandCatalogue } from '../../commands/index.ts'
import {
  ActivityRendererRegistry,
  NOTIFICATIONS_MARK_ALL_READ_SCHEMA,
  NOTIFICATIONS_MARK_READ_SCHEMA,
  NOTIFICATIONS_UPDATE_PREFS_SCHEMA,
  NOTIFY_COMMAND_TYPES,
  bindNotifyCommands,
  groupReviewItems,
  isReviewOverdue,
  mergeReviewItems,
  rendererModuleOf,
  reviewCounts,
  reviewGroupForKind,
  setNotifyCommandHost,
  type ReviewItem,
} from '../index.ts'

const NOW = Date.parse('2026-10-08T12:00:00.000Z')

function item(overrides: Partial<ReviewItem> = {}): ReviewItem {
  return {
    id: 'server:notification-1',
    group: 'due_soon',
    source: 'server',
    subject: { kind: 'goal', id: 'goal-1' },
    kind: 'check_in_due',
    at: NOW - 3_600_000,
    ...overrides,
  }
}

function registry(): CommandRegistry {
  const instance = new CommandRegistry()
  registerCommandCatalogue(instance)
  return instance
}

describe('review model', () => {
  it('maps notification kinds onto the UI-SPEC §12 groups', () => {
    expect(reviewGroupForKind('check_in_submitted')).toBe('needs_review')
    expect(reviewGroupForKind('approval_request')).toBe('needs_approval')
    expect(reviewGroupForKind('kpi_update_due')).toBe('due_soon')
    expect(reviewGroupForKind('mention')).toBeUndefined()
  })

  it('marks overdue rows and counts groups', () => {
    const items = [
      item({ id: 'a', dueAt: NOW - 1000 }),
      item({ id: 'b', dueAt: NOW + 1000 }),
      item({ id: 'c', group: 'needs_review', kind: 'check_in_submitted' }),
    ]
    expect(isReviewOverdue(item({ dueAt: NOW - 1 }), NOW)).toBe(true)
    expect(isReviewOverdue(item({ dueAt: NOW + 1 }), NOW)).toBe(false)
    expect(isReviewOverdue(item(), NOW)).toBe(false)
    expect(reviewCounts(items, NOW)).toEqual({ total: 3, overdue: 1, byGroup: { needs_approval: 0, due_soon: 2, needs_review: 1, upcoming: 0 } })
  })

  it('orders groups as UI-SPEC shows them and drops empty ones', () => {
    const views = groupReviewItems([
      item({ id: 'review-1', group: 'needs_review' }),
      item({ id: 'approval-1', group: 'needs_approval', kind: 'approval_request' }),
      item({ id: 'due-late', group: 'due_soon', dueAt: NOW + 60_000 }),
      item({ id: 'due-first', group: 'due_soon', dueAt: NOW - 60_000 }),
    ], { now: NOW })
    expect(views.map(view => view.group)).toEqual(['needs_approval', 'due_soon', 'needs_review'])
    expect(views[1]?.items.map(entry => entry.id)).toEqual(['due-first', 'due-late'])
    expect(views[1]).toMatchObject({ count: 2, overdue: 1 })
    expect(groupReviewItems([item({ id: 'x', group: 'upcoming' })], { now: NOW, groups: ['due_soon'] })).toEqual([])
    expect(groupReviewItems([item({ id: 'done' })], { now: NOW, excluded: new Set(['done']) })).toEqual([])
  })

  it('merges local and server rows, server winning on the same id', () => {
    const local = item({ id: 'shared', source: 'local', dueAt: NOW + 10 })
    const server = item({ id: 'shared', source: 'server', notificationId: 'notification-9', dueAt: NOW + 20 })
    const merged = mergeReviewItems([local], [server, item({ id: 'server-only', source: 'server' })])
    expect(merged.map(entry => [entry.id, entry.source])).toEqual([['shared', 'server'], ['server-only', 'server']])
    expect(merged[0]?.notificationId).toBe('notification-9')
  })
})

describe('activity renderer registry', () => {
  const renderers = new ActivityRendererRegistry<string>()

  it('resolves an exact event type before the module fallback', () => {
    renderers.register({ id: 'goals-activity', module: 'goals', renderer: 'GoalsCard' })
    renderers.register({ id: 'check-in-card', module: 'goals', eventTypes: ['goals.goal_check_in'], renderer: 'CheckInCard' })
    expect(renderers.forEvent('goals.goal_check_in')?.renderer).toBe('CheckInCard')
    expect(renderers.forEvent('goals.goal_closing')?.renderer).toBe('GoalsCard')
    expect(renderers.forEvent('im.message.receive_v1')).toBeUndefined()
    expect(renderers.has('goals.goal_check_in')).toBe(true)
    expect(renderers.list()).toHaveLength(2)
    expect(rendererModuleOf('goals.goal_check_in')).toBe('goals')
  })

  it('rejects a duplicate registration for one event type or module', () => {
    const duplicates = new ActivityRendererRegistry<string>()
    duplicates.register({ id: 'a', module: 'task', eventTypes: ['task.task_adding'], renderer: 'A' })
    expect(() => duplicates.register({ id: 'b', module: 'task', eventTypes: ['task.task_adding'], renderer: 'B' })).toThrow(/already registered/)
    duplicates.register({ id: 'c', module: 'docs', renderer: 'C' })
    expect(() => duplicates.register({ id: 'd', module: 'docs', renderer: 'D' })).toThrow(/already registered/)
    expect(() => duplicates.register({ id: '', module: 'docs', renderer: 'E' })).toThrow(/need an id and a module/)
  })
})

describe('notifications.* command bindings', () => {
  it('stays unbound without a host, so capability discovery is honest', () => {
    setNotifyCommandHost(null)
    const instance = registry()
    bindNotifyCommands(instance)
    for (const type of NOTIFY_COMMAND_TYPES) {
      expect(instance.handler(type)).toBeUndefined()
      expect(instance.capability(type)).toMatchObject({ available: false, reason: 'not_bound' })
    }
  })

  it('binds the schemas and handlers once a host is installed, and is idempotent', async () => {
    const calls: string[] = []
    const marked: string[][] = []
    setNotifyCommandHost({
      async markRead({ ids }) { marked.push([...ids]); calls.push('markRead'); return { updated: ids.length, readAt: '2026-10-08T12:00:00.000Z' } },
      async markAllRead({ kind }) { calls.push(`markAllRead:${kind ?? 'all'}`); return { updated: 3 } },
      async updatePrefs({ updates }) { calls.push(`updatePrefs:${updates.length}`); return { updated: updates.length, prefs: [] } },
    })
    const instance = registry()
    bindNotifyCommands(instance)
    bindNotifyCommands(instance)
    for (const type of NOTIFY_COMMAND_TYPES) {
      expect(instance.get(type)?.schemaBound).toBe(true)
      expect(instance.capability(type)).toMatchObject({ available: true, module: 'notify', authority: 'workspace' })
    }

    const ctx = (payload: unknown) => ({
      envelope: {},
      payload,
      actor: { principalId: 'principal-1', kind: 'user' },
      workspaceId: 'workspace-1',
      authority: 'workspace',
      conflict: (() => { throw new Error('no conflict') }) as never,
    })
    expect(await instance.handler('notifications.mark_read')!(ctx({ ids: ['n1', 'n2'] }) as never))
      .toEqual({ result: { updated: 2, readAt: '2026-10-08T12:00:00.000Z' } })
    expect(marked).toEqual([['n1', 'n2']])
    await instance.handler('notifications.mark_all_read')!(ctx({ kind: 'comment' }) as never)
    await instance.handler('notifications.update_prefs')!(ctx({ prefs: [{ kind: 'comment', enabled: false }] }) as never)
    expect(calls).toEqual(['markRead', 'markAllRead:comment', 'updatePrefs:1'])
    setNotifyCommandHost(null)
  })

  it('validates the notify payloads', () => {
    expect(NOTIFICATIONS_MARK_READ_SCHEMA.safeParse({ ids: ['n1'] })).toMatchObject({ success: true, data: { ids: ['n1'] } })
    expect(NOTIFICATIONS_MARK_READ_SCHEMA.safeParse({ ids: [] })).toMatchObject({ success: false })
    expect(NOTIFICATIONS_MARK_READ_SCHEMA.safeParse({ ids: ['n1', 'n1'] })).toMatchObject({ success: false })
    expect(NOTIFICATIONS_MARK_READ_SCHEMA.safeParse({ ids: ['n1'], all: true })).toMatchObject({ success: false })
    expect(NOTIFICATIONS_MARK_ALL_READ_SCHEMA.safeParse({})).toMatchObject({ success: true, data: {} })
    expect(NOTIFICATIONS_MARK_ALL_READ_SCHEMA.safeParse({ kind: 'reminder_due' })).toMatchObject({ success: true, data: { kind: 'reminder_due' } })
    expect(NOTIFICATIONS_MARK_ALL_READ_SCHEMA.safeParse({ kind: 7 })).toMatchObject({ success: false })
    expect(NOTIFICATIONS_UPDATE_PREFS_SCHEMA.safeParse({ prefs: [{ kind: 'comment', channels: ['inbox'], batchMinutes: 30 }] }))
      .toMatchObject({ success: true, data: { prefs: [{ kind: 'comment', channels: ['inbox'], batchMinutes: 30 }] } })
    expect(NOTIFICATIONS_UPDATE_PREFS_SCHEMA.safeParse({ prefs: [] })).toMatchObject({ success: false })
    expect(NOTIFICATIONS_UPDATE_PREFS_SCHEMA.safeParse({ prefs: [{ kind: 'comment', batchMinutes: -1 }] })).toMatchObject({ success: false })
    expect(NOTIFICATIONS_UPDATE_PREFS_SCHEMA.safeParse({ prefs: [{ kind: 'comment', unknown: 1 }] })).toMatchObject({ success: false })
  })

  it('keeps the notify command types in the catalogue', () => {
    const catalogue = registry()
    for (const type of NOTIFY_COMMAND_TYPES) expect(catalogue.get(type)).toMatchObject({ module: 'notify', authority: 'workspace', verb: 'write' })
    expect(NOTIFY_COMMAND_TYPES.every(type => catalogue.has(type))).toBe(true)
  })
})