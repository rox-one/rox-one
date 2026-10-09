/**
 * W1-09 (#1506) — No restricted content in payloads, and the activity read
 * model over `domain_event`.
 *
 * The fan-out always projects an event payload through
 * `restrictNotificationPayload`, and the activity read model stores refs
 * only. Both are tested with a payload that carries entity text, so a leak
 * would be caught here rather than in a recipient's Inbox.
 */
import { describe, expect, it } from 'bun:test'
import type { DomainEvent, DomainEventType } from '../../events/index.ts'
import {
  MAX_ACTIVITY_ITEMS,
  activityByDay,
  activityDayKey,
  activityItemFromEvent,
  collectEntityRefs,
  createActivityState,
  moduleOfEventType,
  reduceActivity,
  restrictNotificationPayload,
} from '../index.ts'

const RESTRICTED = 'Confidential: 2026 acquisition plan'

function event(index: number, overrides: Partial<DomainEvent> = {}): DomainEvent {
  return {
    eventId: `event-${index}`,
    sequence: index,
    workspaceId: 'workspace-1',
    type: 'goals.goal_check_in' as DomainEventType,
    actorId: 'principal-1',
    subject: { kind: 'goal', id: `goal-${index}` },
    aggregateRevision: index,
    payload: {
      title: RESTRICTED,
      body: `${RESTRICTED} — board deck`,
      message: RESTRICTED,
      refs: [{ kind: 'goal', id: `goal-${index}` }, { kind: 'space', id: 'space-1' }],
      ids: { spaceId: 'space-1', checkInId: `check-in-${index}` },
      revision: index,
    },
    createdAt: `2026-10-08T10:0${index}:00.000Z`,
    ...overrides,
  }
}

describe('notification payload projection', () => {
  it('keeps refs, revision, due instant and id fields — and nothing else', () => {
    const payload = restrictNotificationPayload({
      title: RESTRICTED,
      body: RESTRICTED,
      message: RESTRICTED,
      html: `<b>${RESTRICTED}</b>`,
      refs: [{ kind: 'goal', id: 'goal-1' }, { kind: 'task', id: 'task-9' }],
      ids: { spaceId: 'space-1' },
      revision: 7,
      dueAt: '2026-10-09T09:00:00.000Z',
    })
    expect(Object.keys(payload).sort()).toEqual(['dueAt', 'ids', 'refs', 'revision'])
    expect(JSON.stringify(payload)).not.toContain('Confidential')
    expect(JSON.stringify(payload)).not.toContain('board deck')
  })

  it('drops unknown refs, deep values and non-id scalars', () => {
    expect(restrictNotificationPayload({ refs: [{ kind: 'not-a-kind', id: 'x' }, { kind: 'goal' }, 'goal:1'] }).refs).toBeUndefined()
    expect(restrictNotificationPayload({ revision: -1, dueAt: 1, ids: { a: 1, b: 'ok' } })).toEqual({ ids: { b: 'ok' } })
    expect(restrictNotificationPayload(undefined)).toEqual({})
    expect(restrictNotificationPayload([1, 2])).toEqual({})
  })

  it('collects nested refs up to the cap', () => {
    const refs = collectEntityRefs({ a: { b: [{ kind: 'goal', id: 'g1' }, { kind: 'goal', id: 'g1' }] }, c: { kind: 'note', id: 'n1' } })
    expect(refs).toEqual([{ kind: 'goal', id: 'g1' }, { kind: 'note', id: 'n1' }])
    const many = collectEntityRefs({ list: Array.from({ length: 60 }, (_, index) => ({ kind: 'task', id: `t${index}` })) })
    expect(many).toHaveLength(32)
  })

  it('never copies text into the activity read model', () => {
    const item = activityItemFromEvent(event(1))
    expect(item).toMatchObject({ id: 'event-1', module: 'goals', type: 'goals.goal_check_in', revision: 1 })
    expect(item.refs.map(ref => `${ref.kind}:${ref.id}`)).toEqual(['goal:goal-1', 'space:space-1'])
    expect(JSON.stringify(item)).not.toContain('Confidential')
  })

  it('names the module of an event type', () => {
    expect(moduleOfEventType('goals.goal_check_in')).toBe('goals')
    expect(moduleOfEventType('im.message.receive_v1')).toBe('im')
    expect(moduleOfEventType('system')).toBe('system')
  })
})

describe('activity read model', () => {
  it('is newest-first by store sequence and ignores redelivered events', () => {
    let state = createActivityState()
    state = reduceActivity(state, [event(1), event(2)])
    expect(state.items.map(item => item.id)).toEqual(['event-2', 'event-1'])
    expect(state.lastSequence).toBe(2)
    state = reduceActivity(state, [event(2), event(3)])
    expect(state.items.map(item => item.id)).toEqual(['event-3', 'event-2', 'event-1'])
    expect(state.lastSequence).toBe(3)
  })

  it('orders by timestamp when events carry no sequence (local push batch)', () => {
    const state = reduceActivity(createActivityState(), [
      { ...event(1), sequence: undefined },
      { ...event(2), sequence: undefined },
    ])
    expect(state.items.map(item => item.id)).toEqual(['event-2', 'event-1'])
    expect(state.lastSequence).toBe(0)
  })

  it('caps the read model and counts what it dropped', () => {
    const state = reduceActivity(createActivityState(), Array.from({ length: MAX_ACTIVITY_ITEMS + 12 }, (_, index) => event(index)))
    expect(state.items).toHaveLength(MAX_ACTIVITY_ITEMS)
    expect(state.dropped).toBe(12)
    expect(state.items[0]?.id).toBe(`event-${MAX_ACTIVITY_ITEMS + 11}`)
  })

  it('returns the same state for an empty batch', () => {
    const state = createActivityState()
    expect(reduceActivity(state, [])).toBe(state)
  })

  it('groups items by local day, newest day first', () => {
    const items = [
      activityItemFromEvent({ ...event(1), createdAt: '2026-10-08T09:00:00.000Z' }),
      activityItemFromEvent({ ...event(2), createdAt: '2026-10-08T23:30:00.000Z' }),
      activityItemFromEvent({ ...event(3), createdAt: '2026-10-07T12:00:00.000Z' }),
    ]
    const groups = activityByDay(items, 'Europe/Moscow')
    expect(groups.map(group => group.day)).toEqual(['2026-10-09', '2026-10-08', '2026-10-07'])
    // 23:30 UTC is already the next day in Moscow — the grouping honours the zone it is given.
    expect(groups[0]?.items.map(item => item.id)).toEqual(['event-2'])
    expect(groups[1]?.items.map(item => item.id)).toEqual(['event-1'])
    // The same instant is a different day in UTC — the grouping honours the zone it is given.
    expect(activityDayKey('2026-10-08T23:30:00.000Z', 'UTC')).toBe('2026-10-08')
    expect(activityDayKey('2026-10-08T23:30:00.000Z', 'Europe/Moscow')).toBe('2026-10-09')
    expect(activityDayKey('not-a-date', 'UTC')).toBe('not-a-date')
  })
})