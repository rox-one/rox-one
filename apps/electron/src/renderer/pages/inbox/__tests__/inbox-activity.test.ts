/**
 * W1-09 (#1506) — Inbox activity surfaces: the new kinds, their per-module
 * gating and the notification → surface mapping.
 *
 * With every module flag off the aggregation output must be exactly what it
 * was before this package (the existing `inbox-model.test.ts` pins that);
 * these tests pin the gating side: a notification for a surface whose module
 * is off is not built at all.
 */
import { describe, expect, it } from 'bun:test'
import type { NotificationKind } from '@rox/core/notify'
import {
  ACTIVITY_KINDS,
  ALL_KINDS,
  EVERY_KIND,
  INBOX_KIND_FLAGS,
  buildInboxItems,
  enabledInboxKinds,
  inboxCounts,
  inboxKindForNotification,
  type InboxNotificationLike,
  type InboxSources,
} from '../inbox-model'

const NOW = new Date(2026, 9, 8, 15, 0).getTime()

function notification(overrides: Partial<InboxNotificationLike> = {}): InboxNotificationLike {
  return {
    id: 'notification-1',
    kind: 'check_in_submitted',
    at: NOW - 1000,
    entity: { kind: 'goal', id: 'goal-1' },
    actorId: 'principal-1',
    ...overrides,
  }
}

function sources(notifications: readonly InboxNotificationLike[], enabled: readonly string[]): InboxSources {
  return {
    sessions: [],
    permissions: new Map(),
    credentials: new Map(),
    notifications,
    enabledKinds: enabledInboxKinds(new Set(enabled)),
    now: NOW,
  }
}

describe('inbox activity surfaces', () => {
  it('adds nothing while every module flag is off, even with notifications at hand', () => {
    const items = buildInboxItems(sources([notification()], []))
    expect(items).toEqual([])
    const baseline = buildInboxItems({ sessions: [], permissions: new Map(), credentials: new Map(), now: NOW })
    expect(buildInboxItems(sources([notification({ kind: 'mention' })], [])).length).toBe(baseline.length)
  })

  it('maps each notification kind onto its Inbox tab', () => {
    const expected: ReadonlyArray<readonly [NotificationKind, string]> = [
      ['mention', 'mention'],
      ['assignment', 'assignment'],
      ['check_in_submitted', 'review'],
      ['check_in_due', 'review'],
      ['retrospective', 'review'],
      ['approval_request', 'review'],
      ['task_due', 'review'],
      ['task_overdue', 'review'],
      ['milestone_due', 'review'],
      ['kpi_update_due', 'review'],
      ['comment', 'notification'],
      ['doc_shared', 'notification'],
      ['reminder_due', 'notification'],
    ]
    for (const [kind, surface] of expected) expect(inboxKindForNotification(kind)).toBe(surface)
  })

  it('builds a row only for the enabled surface', () => {
    const notifications = [
      notification({ id: 'n-review', kind: 'check_in_submitted' }),
      notification({ id: 'n-mention', kind: 'mention' }),
      notification({ id: 'n-assignment', kind: 'assignment' }),
      notification({ id: 'n-note', kind: 'comment' }),
    ]
    const onlyMentions = buildInboxItems(sources(notifications, [INBOX_KIND_FLAGS.mention]))
    expect(onlyMentions.map((item) => item.id)).toEqual(['notif:n-mention'])

    const all = buildInboxItems(sources(notifications, Object.values(INBOX_KIND_FLAGS)))
    expect(all.map((item) => `${item.kind}:${item.id}`).sort()).toEqual([
      'assignment:notif:n-assignment',
      'mention:notif:n-mention',
      'notification:notif:n-note',
      'review:notif:n-review',
    ])
  })

  it('keeps ids only: the row title is the entity ref until the resolver fills it in', () => {
    const [item] = buildInboxItems(sources([notification({ entity: { kind: 'goal', id: 'goal-1' } })], [INBOX_KIND_FLAGS.review]))
    expect(item).toMatchObject({
      id: 'notif:notification-1',
      kind: 'review',
      title: 'goal:goal-1',
      source: 'goal',
      entity: { kind: 'goal', id: 'goal-1' },
      reviewGroup: 'needs_review',
    })
    const [unknown] = buildInboxItems(sources([notification({ entity: { kind: 'not-a-kind', id: 'x' } })], [INBOX_KIND_FLAGS.review]))
    expect(unknown).toMatchObject({ title: 'check_in_submitted', source: 'check_in_submitted' })
    expect(unknown && 'entity' in unknown).toBe(false)
  })

  it('groups review rows as decisions, marks only approval requests blocking, and flags the review group', () => {
    const items = buildInboxItems(sources([
      notification({ id: 'a', kind: 'approval_request' }),
      notification({ id: 'b', kind: 'check_in_submitted' }),
      notification({ id: 'c', kind: 'mention' }),
    ], Object.values(INBOX_KIND_FLAGS)))
    const byId = Object.fromEntries(items.map((item) => [item.id, item]))
    expect(byId['notif:a']).toMatchObject({ group: 'decision', blocking: true, reviewGroup: 'needs_approval' })
    expect(byId['notif:b']).toMatchObject({ group: 'decision', blocking: false, reviewGroup: 'needs_review' })
    expect(byId['notif:c']).toMatchObject({ group: 'message', blocking: false })
    expect(byId['notif:c'] && 'reviewGroup' in byId['notif:c']).toBe(false)
    // Blocking rows lead the sort (oldest wait first), then newest-first.
    expect(items.slice(0, 3).map((item) => item.id)).toEqual(['notif:a', 'notif:b', 'notif:c'])
  })

  it('counts every activity surface separately in the sidebar badge data', () => {
    const items = buildInboxItems(sources([
      notification({ id: 'a', kind: 'check_in_submitted' }),
      notification({ id: 'b', kind: 'mention' }),
      notification({ id: 'c', kind: 'mention' }),
    ], Object.values(INBOX_KIND_FLAGS)))
    const counts = inboxCounts(items, { done: {}, snoozed: {} }, NOW)
    expect(counts.byKind.review).toBe(1)
    expect(counts.byKind.mention).toBe(2)
    expect(counts.byKind.assignment).toBe(0)
    expect(counts.byKind.notification).toBe(0)
    expect(counts.decisions).toBe(1)
    expect(counts.messages).toBe(2)
  })

  it('keeps the pre-W1-09 kind lists intact and the flag table complete', () => {
    expect(ALL_KINDS).toEqual(['permission', 'credential', 'plan', 'memory', 'skill', 'sender', 'reply', 'error', 'mail', 'team-recipient'])
    expect(ACTIVITY_KINDS).toEqual(['review', 'mention', 'assignment', 'notification'])
    expect(EVERY_KIND).toEqual([...ALL_KINDS, ...ACTIVITY_KINDS])
    expect(Object.keys(INBOX_KIND_FLAGS).sort()).toEqual([...ACTIVITY_KINDS].sort())
    expect(INBOX_KIND_FLAGS).toEqual({
      review: 'goals.checkins.v1',
      mention: 'entities.links.v1',
      assignment: 'tasks.shared.v1',
      notification: 'notify.inbox.v1',
    })
    expect([...enabledInboxKinds(new Set(['notify.inbox.v1']))]).toEqual(['notification'])
    expect([...enabledInboxKinds(new Set())]).toEqual([])
  })
})