/**
 * W1-09 (#1506) — Zod boundary for notifications.
 *
 * The structural schemas live in `@rox/core/notify`; these are the zod twins
 * used on untrusted input (command payloads, notify routes, push frames).
 * They must agree with them: both are checked against the same fixtures and
 * against the 506-notify.sql `notification` row shape.
 */
import { describe, expect, it } from 'bun:test'
import {
  NOTIFICATIONS_MARK_ALL_READ_SCHEMA,
  NOTIFICATIONS_MARK_READ_SCHEMA,
  NOTIFICATIONS_UPDATE_PREFS_SCHEMA,
  type NotificationEmailBatchRow,
  type NotificationPrefRow,
  type NotificationRow,
} from '@rox/core/notify'
import {
  notificationCreatedPushSchema,
  notificationEmailBatchSchema,
  notificationKindSchema,
  notificationListQuerySchema,
  notificationPayloadSchema,
  notificationPrefSchema,
  notificationReadPushSchema,
  notificationsMarkAllReadPayloadSchema,
  notificationsMarkReadPayloadSchema,
  notificationsUpdatePrefsPayloadSchema,
} from '../schemas.ts'

describe('notification schemas', () => {
  it('accepts the kinds and channels of the contract and rejects anything else', () => {
    expect(notificationKindSchema.parse('reminder_due')).toBe('reminder_due')
    expect(notificationKindSchema.safeParse('chat_mention').success).toBe(false)
    expect(notificationPayloadSchema.safeParse({ ids: { spaceId: 'not-a-uuid' } }).success).toBe(true)
    expect(notificationPayloadSchema.safeParse({ refs: [{ kind: 'nope', id: 'x' }] }).success).toBe(false)
    expect(notificationPayloadSchema.safeParse({ body: 'restricted text' }).success).toBe(false)
    expect(notificationPayloadSchema.safeParse({ revision: -1 }).success).toBe(false)
  })

  it('round-trips a 506-notify.sql notification row', () => {
    const row: NotificationRow = {
      notificationId: '4b0c1b0e-0000-4000-8000-000000000001',
      workspaceId: '4b0c1b0e-0000-4000-8000-000000000002',
      principalId: '4b0c1b0e-0000-4000-8000-000000000003',
      kind: 'check_in_submitted',
      subject: { kind: 'goal', id: 'goal-1' },
      actorId: '4b0c1b0e-0000-4000-8000-000000000004',
      payload: { refs: [{ kind: 'goal', id: 'goal-1' }], revision: 4 },
      emailState: 'held',
      schemaVersion: 1,
      createdAt: '2026-10-08T10:00:00.000Z',
    }
    expect(notificationCreatedPushSchema.parse({ notification: row })).toEqual({ notification: row })
    expect(notificationCreatedPushSchema.safeParse({ notification: { ...row, schemaVersion: 0 } }).success).toBe(false)
    expect(notificationCreatedPushSchema.safeParse({ notification: { ...row, emailState: 'sent-by-smtp' } }).success).toBe(false)
    const unread = { ...row, readAt: '2026-10-08T11:00:00.000Z' }
    expect(notificationCreatedPushSchema.parse({ notification: unread }).notification.readAt).toBe('2026-10-08T11:00:00.000Z')
  })

  it('validates pref and batch rows', () => {
    const pref: NotificationPrefRow = {
      workspaceId: 'w', principalId: 'p', kind: 'comment', enabled: true,
      channels: ['inbox', 'email_digest'], batchMinutes: 30,
      createdAt: '2026-10-08T10:00:00.000Z', updatedAt: '2026-10-08T10:00:00.000Z',
    }
    expect(notificationPrefSchema.parse(pref)).toEqual(pref)
    expect(notificationPrefSchema.safeParse({ ...pref, channels: ['telegram'] }).success).toBe(false)
    expect(notificationPrefSchema.safeParse({ ...pref, batchMinutes: -1 }).success).toBe(false)
    const batch: NotificationEmailBatchRow = {
      batchId: 'b', workspaceId: 'w', principalId: 'p', status: 'pending', windowMinutes: 5,
      windowStartedAt: '2026-10-08T10:00:00.000Z', sendAt: '2026-10-08T10:05:00.000Z',
      createdAt: '2026-10-08T10:00:00.000Z',
    }
    expect(notificationEmailBatchSchema.parse(batch)).toEqual(batch)
    expect(notificationEmailBatchSchema.safeParse({ ...batch, status: 'queued', error: 'x' }).success).toBe(false)
  })

  it('agrees with the structural command schemas from @rox/core', () => {
    const fixtures: Array<[string, unknown, unknown]> = [
      ['notifications.mark_read', { ids: ['n1', 'n2'] }, { ids: ['n1', 'n2', 'n1'] }],
      ['notifications.mark_read', { ids: ['n1'] }, { ids: [] }],
      ['notifications.mark_all_read', {}, { kind: 'not-a-kind' }],
      ['notifications.update_prefs', { prefs: [{ kind: 'comment', enabled: false }] }, { prefs: [{ kind: 'comment', batchMinutes: 5000 }] }],
    ]
    const structural = {
      'notifications.mark_read': NOTIFICATIONS_MARK_READ_SCHEMA,
      'notifications.mark_all_read': NOTIFICATIONS_MARK_ALL_READ_SCHEMA,
      'notifications.update_prefs': NOTIFICATIONS_UPDATE_PREFS_SCHEMA,
    } as const
    const zodTwin = {
      'notifications.mark_read': notificationsMarkReadPayloadSchema,
      'notifications.mark_all_read': notificationsMarkAllReadPayloadSchema,
      'notifications.update_prefs': notificationsUpdatePrefsPayloadSchema,
    } as const
    for (const [type, accepted, rejected] of fixtures) {
      expect(zodTwin[type as keyof typeof zodTwin].safeParse(accepted).success).toBe(true)
      expect(structural[type as keyof typeof structural].safeParse(accepted).success).toBe(true)
      expect(zodTwin[type as keyof typeof zodTwin].safeParse(rejected).success).toBe(false)
      expect(structural[type as keyof typeof structural].safeParse(rejected).success).toBe(false)
    }
  })

  it('validates the list query and the read push frame', () => {
    expect(notificationListQuerySchema.safeParse({ limit: 50, cursor: 'cursor-1' }).success).toBe(true)
    expect(notificationListQuerySchema.safeParse({ limit: 0 }).success).toBe(false)
    expect(notificationListQuerySchema.safeParse({ limit: 101 }).success).toBe(false)
    expect(notificationReadPushSchema.parse({ ids: ['n1'], readAt: '2026-10-08T11:00:00.000Z', unread: 0 })).toMatchObject({ unread: 0 })
    expect(notificationReadPushSchema.parse({ all: true, kind: 'comment', readAt: '2026-10-08T11:00:00.000Z', unread: 2 })).toMatchObject({ all: true })
    expect(notificationReadPushSchema.safeParse({ readAt: '2026-10-08T11:00:00.000Z' }).success).toBe(false)
  })
})