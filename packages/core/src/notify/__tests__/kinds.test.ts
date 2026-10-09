/**
 * W1-09 (#1506) — Notification kind vocabulary.
 *
 * The kind list is a frozen contract: it mirrors DATA-MODEL §9.2 *and* the
 * `notification.kind` CHECK constraint in W1-05 `506-notify.sql`. This test
 * reads the migration so the two can never drift apart.
 */
import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  NOTIFICATION_CHANNELS,
  NOTIFICATION_KINDS,
  NOTIFICATION_KIND_TABLE,
  defaultChannelEnabled,
  isNotificationChannel,
  isNotificationKind,
  notificationKindDescriptor,
  notificationKindsForReviewGroup,
} from '../index.ts'

const MIGRATION = join(import.meta.dir, '../../../../../apps/workspace-service/migrations/506-notify.sql')

const V2_KINDS = ['approval_request', 'agent_report', 'suggestion', 'comment_reply', 'thread_resolved', 'invite_pending', 'quota_warning', 'rule_failed']
const V1_KINDS = [
  'mention', 'assignment', 'comment', 'check_in_due', 'check_in_submitted', 'check_in_acknowledged', 'retrospective',
  'task_due', 'task_overdue', 'milestone_due', 'kpi_update_due', 'doc_shared', 'access_request', 'chat_invite',
  'space_invite', 'event_invite', 'event_reminder', 'im_message', 'meeting_started',
]

function ddlKinds(): string[] {
  const sql = readFileSync(MIGRATION, 'utf-8')
  const block = /kind text NOT NULL CHECK \(kind IN \(([\s\S]*?)\)\)/.exec(sql)
  if (!block?.[1]) throw new Error('notification.kind CHECK not found in 506-notify.sql')
  return [...block[1].matchAll(/'([a-z_]+)'/g)].map(match => match[1]!)
}

describe('notification kind table', () => {
  it('contains the v1, v2 and v2.1 kinds of DATA-MODEL §9.2, each exactly once', () => {
    const kinds = NOTIFICATION_KIND_TABLE.map(descriptor => descriptor.kind)
    expect(new Set(kinds).size).toBe(kinds.length)
    expect(kinds.length).toBe(NOTIFICATION_KINDS.length)
    expect([...kinds].sort()).toEqual([...NOTIFICATION_KINDS].sort())
    for (const kind of V1_KINDS) expect(notificationKindDescriptor(kind as never).specVersion).toBe('v1')
    for (const kind of V2_KINDS) expect(notificationKindDescriptor(kind as never).specVersion).toBe('v2')
    // v2.1 — the kind this package must not forget.
    expect(NOTIFICATION_KINDS).toContain('reminder_due')
    expect(notificationKindDescriptor('reminder_due')).toMatchObject({
      specVersion: 'v2.1',
      audience: ['owner'],
      channels: ['inbox', 'os'],
    })
  })

  it('matches the notification.kind CHECK constraint in 506-notify.sql', () => {
    expect([...ddlKinds()].sort()).toEqual([...NOTIFICATION_KINDS].sort())
  })

  it('declares only known channels, and every channel belongs to at least one kind', () => {
    const used = new Set<string>()
    for (const descriptor of NOTIFICATION_KIND_TABLE) {
      expect(descriptor.channels.length).toBeGreaterThan(0)
      for (const channel of descriptor.channels) {
        expect(isNotificationChannel(channel)).toBe(true)
        used.add(channel)
      }
      expect(descriptor.trigger.length).toBeGreaterThan(0)
      expect(descriptor.audience.length).toBeGreaterThan(0)
    }
    expect([...NOTIFICATION_CHANNELS].filter(channel => !used.has(channel))).toEqual([])
  })

  it('guards kind and channel values', () => {
    expect(isNotificationKind('reminder_due')).toBe(true)
    expect(isNotificationKind('reminder_due_v2')).toBe(false)
    expect(isNotificationKind(undefined)).toBe(false)
    expect(isNotificationChannel('agent_dm')).toBe(true)
    expect(isNotificationChannel('telegram')).toBe(false)
  })

  it('maps Review groups in UI-SPEC §12 order', () => {
    expect(notificationKindsForReviewGroup('needs_approval')).toEqual(['approval_request'])
    expect(notificationKindsForReviewGroup('needs_review')).toEqual(['check_in_submitted', 'retrospective'])
    expect(notificationKindsForReviewGroup('due_soon')).toEqual(['check_in_due', 'task_due', 'task_overdue', 'milestone_due', 'kpi_update_due'])
    expect(notificationKindsForReviewGroup('upcoming')).toEqual([])
    expect(notificationKindDescriptor('check_in_submitted').primaryAction).toBe('acknowledge')
  })

  it('treats instant email as opt-in and the declared channel as the default subscription', () => {
    expect(defaultChannelEnabled('mention', 'email_instant')).toBe(true)
    expect(defaultChannelEnabled('mention', 'agent_dm')).toBe(false)
    expect(defaultChannelEnabled('rule_failed', 'agent_dm')).toBe(true)
  })
})