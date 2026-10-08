/**
 * W1-09 (#1506) — Audience rules, table-driven per event type.
 *
 * One context with every source filled; the expected recipients per kind come
 * from DATA-MODEL §9.2. The second table drives `planNotifications` with a
 * real event per trigger row, so a new trigger cannot ship without an audience
 * expectation.
 */
import { describe, expect, it } from 'bun:test'
import type { DomainEvent, DomainEventType } from '../../events/index.ts'
import {
  NOTIFICATION_TRIGGERS,
  notificationTriggerFor,
  planNotifications,
  resolveAudience,
  type AudienceContext,
  type NotificationKind,
} from '../index.ts'

const ACTOR = 'principal-actor'

const CONTEXT: AudienceContext = {
  actorId: ACTOR,
  mentioned: ['principal-mentioned', ACTOR],
  assignees: ['principal-assignee'],
  champion: 'principal-champion',
  reviewer: 'principal-reviewer',
  subscribers: ['principal-subscriber', ACTOR],
  allSubscribers: ['principal-everyone'],
  threadParticipants: ['principal-thread', ACTOR],
  owner: 'principal-owner',
  invitee: 'principal-invitee',
  attendees: ['principal-attendee'],
  members: ['principal-member', ACTOR],
  participants: ['principal-participant'],
  targets: ['principal-target'],
}

const EXPECTED: ReadonlyArray<readonly [NotificationKind, readonly string[]]> = [
  ['mention', ['principal-mentioned']],
  ['assignment', ['principal-assignee']],
  ['comment', ['principal-subscriber']],
  ['check_in_due', ['principal-champion']],
  ['check_in_submitted', ['principal-reviewer', 'principal-everyone']],
  ['check_in_acknowledged', ['principal-champion']],
  ['retrospective', ['principal-reviewer', 'principal-subscriber']],
  ['task_due', ['principal-assignee']],
  ['task_overdue', ['principal-assignee']],
  ['milestone_due', ['principal-champion']],
  ['kpi_update_due', ['principal-champion']],
  ['doc_shared', ['principal-target']],
  ['access_request', ['principal-target']],
  ['chat_invite', ['principal-invitee']],
  ['space_invite', ['principal-invitee']],
  ['event_invite', ['principal-attendee']],
  ['event_reminder', ['principal-attendee']],
  ['im_message', ['principal-member']],
  ['meeting_started', ['principal-participant']],
  ['approval_request', ['principal-owner']],
  ['agent_report', ['principal-owner']],
  ['suggestion', ['principal-owner', 'principal-mentioned']],
  ['comment_reply', ['principal-thread']],
  ['thread_resolved', ['principal-thread']],
  ['invite_pending', ['principal-owner']],
  ['quota_warning', ['principal-owner']],
  ['rule_failed', ['principal-owner', 'principal-target']],
  ['reminder_due', ['principal-owner']],
]

function event(type: string, payload: unknown = {}, subject?: { kind: 'goal'; id: string }): DomainEvent {
  return {
    eventId: `event-${type}`,
    workspaceId: 'workspace-1',
    type: type as DomainEventType,
    actorId: ACTOR,
    aggregateRevision: 1,
    payload,
    createdAt: '2026-10-08T10:00:00.000Z',
    ...(subject ? { subject } : {}),
  }
}

describe('audience rules per notification kind', () => {
  for (const [kind, expected] of EXPECTED) {
    it(`${kind} → ${expected.join(', ') || 'nobody'}`, () => {
      expect(resolveAudience(kind, CONTEXT).recipients).toEqual([...expected])
    })
  }

  it('never notifies the actor, even when the actor is the only source member', () => {
    expect(resolveAudience('comment', { actorId: 'a', subscribers: ['a'] })).toMatchObject({ recipients: [] })
    expect(resolveAudience('comment', { actorId: 'a', subscribers: ['a'] }, { includeActor: true }).recipients).toEqual(['a'])
  })

  it('drops muted principals and duplicates', () => {
    const audience = resolveAudience('check_in_submitted', { reviewer: 'r1', allSubscribers: ['r1', 'r2'] }, { exclude: ['r2'] })
    expect(audience.recipients).toEqual(['r1'])
    expect(audience.sources).toEqual(['reviewer', 'allSubscribers'])
  })

  it('ignores empty and non-string ids instead of notifying them', () => {
    const audience = resolveAudience('assignment', { assignees: ['', 'x', undefined as unknown as string] })
    expect(audience.recipients).toEqual(['x'])
  })

  it('covers every kind in the table', () => {
    const covered = EXPECTED.map(([kind]) => kind).sort()
    expect(covered).toEqual([...new Set(EXPECTED.map(([kind]) => kind))].sort())
    expect(covered.length).toBe(28)
  })
})

describe('event type → notification kind (table-driven)', () => {
  for (const trigger of NOTIFICATION_TRIGGERS) {
    it(`${trigger.type} notifies ${trigger.kind}`, () => {
      const plan = planNotifications({ event: event(trigger.type, { notify: 'everyone' }, { kind: 'goal', id: 'goal-1' }), audience: CONTEXT })
      expect(plan.kind).toBe(trigger.kind)
      const expected = EXPECTED.find(([kind]) => kind === trigger.kind)![1]
      expect(plan.notifications.map(notification => notification.principalId)).toEqual([...expected])
    })
  }

  it('does not fan out activity that the spec keeps quiet', () => {
    // DATA-MODEL §9.1: `collab.doc_viewed` is explicitly "not fanned out".
    expect(notificationTriggerFor('collab.doc_viewed')).toBeUndefined()
    expect(planNotifications({ event: event('collab.doc_viewed'), audience: CONTEXT })).toMatchObject({ notifications: [], skipped: 'unmapped_event' })
    // Scheduler kinds have no domain-event trigger.
    expect(notificationTriggerFor('goals.goal_due')).toBeUndefined()
  })

  it('keeps a check-in with notify: none silent', () => {
    const plan = planNotifications({ event: event('goals.goal_check_in', { notify: 'none' }), audience: CONTEXT })
    expect(plan).toMatchObject({ kind: 'check_in_submitted', skipped: 'silent_event', notifications: [] })
    const published = planNotifications({ event: event('goals.goal_check_in', { notify: 'everyone' }), audience: CONTEXT })
    expect(published.notifications.map(entry => entry.principalId)).toEqual(['principal-reviewer', 'principal-everyone'])
  })

  it('returns no notifications when the audience is empty', () => {
    const plan = planNotifications({ event: event('goals.goal_check_in', { notify: 'everyone' }), audience: {} })
    expect(plan).toMatchObject({ kind: 'check_in_submitted', skipped: 'no_audience', notifications: [] })
  })

  it('carries the subject ref, the actor and an ids-only payload per recipient', () => {
    const plan = planNotifications({
      event: event('goals.goal_check_in', { notify: 'everyone', refs: [{ kind: 'goal', id: 'goal-1' }], title: 'Restricted goal' }, { kind: 'goal', id: 'goal-1' }),
      audience: { reviewer: 'principal-reviewer', actorId: ACTOR },
    })
    expect(plan.notifications).toHaveLength(1)
    expect(plan.notifications[0]).toMatchObject({
      principalId: 'principal-reviewer',
      kind: 'check_in_submitted',
      subject: { kind: 'goal', id: 'goal-1' },
      actorId: ACTOR,
      payload: { refs: [{ kind: 'goal', id: 'goal-1' }] },
    })
    expect(JSON.stringify(plan.notifications[0]?.payload)).not.toContain('Restricted')
  })
})