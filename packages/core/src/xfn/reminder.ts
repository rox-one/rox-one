/**
 * W1-15 (#1512) — `reminder.subjectRef`: reminders on any entity (X-16,
 * DATA-MODEL §5.18).
 *
 * The existing `reminder` kind (18, local authority) pointed only at what the
 * local scheduler already knew. X-16 makes a reminder attachable to **any**
 * entity, so the record gains `subjectRef: EntityRef`, and at fire time it
 * emits the notification kind `reminder_due` (added to DATA-MODEL §9.2 by
 * W1-09 #1506 — `NotificationKind` already carries it).
 *
 * W1-06 (#1503) owns the persisted zod schemas for domain records and does not
 * exist yet, so the field is declared here in an isolated module: when #1503
 * lands, `subjectRefSchema` is imported straight into the reminder record
 * schema and this file keeps only the scheduling helpers.
 */

import type { EntityRef } from '../entities/refs.ts'
import { entityRefKey } from '../entities/refs.ts'
import { NOTIFICATION_KINDS, type NotificationChannel, type NotificationKind } from '../notify/types.ts'

/** The notification kind a fired reminder emits (§9.2, v2.1). */
export const REMINDER_DUE_KIND = 'reminder_due' satisfies NotificationKind

/** Channels a fired reminder may use (§9.2: Inbox + OS). */
export const REMINDER_DUE_CHANNELS: readonly NotificationChannel[] = ['inbox', 'os']

/** Reminder record version; `subjectRef` is the v2.1 addition. */
export const REMINDER_SCHEMA_VERSION = 2

/**
 * The `reminder` record (local kind 18) with the X-16 subject.
 * `subjectRef` is optional at the type level so pre-v2.1 rows still parse; a
 * reminder created by `reminders.create` always carries one.
 */
export interface ReminderRecord {
  id: string
  workspaceId: string | null
  principalId: string
  /** The entity the reminder points at (X-16). */
  subjectRef?: EntityRef
  /** Title snapshot for the OS banner; the entity title is resolved at render time. */
  title?: string
  /** ISO-8601 instant the reminder fires at. */
  at: string
  /** IANA zone the wall-clock time was picked in (mirrors personal tasks). */
  timeZone?: string
  note?: string
  channels: readonly NotificationChannel[]
  /** Set once the `reminder_due` notification was emitted (idempotency). */
  firedAt?: string
  cancelledAt?: string
  schemaVersion: number
  createdAt: string
  updatedAt: string
}

/** True when the record was created with a subject and has not fired or been cancelled. */
export function isPendingReminder(record: ReminderRecord, now: Date = new Date()): boolean {
  if (record.firedAt || record.cancelledAt) return false
  const at = Date.parse(record.at)
  return Number.isFinite(at) && at <= now.getTime()
}

/** Reminders due for `principalId` at `now`, oldest first; a reminder without a subject is skipped. */
export function dueReminders(records: readonly ReminderRecord[], principalId: string, now: Date = new Date()): ReminderRecord[] {
  return records
    .filter((record) => record.principalId === principalId && !!record.subjectRef && isPendingReminder(record, now))
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
}

/** One reminder per `(principal, subject)` pair keeps the «Напомнить…» affordance idempotent. */
export function reminderSubjectKey(record: Pick<ReminderRecord, 'principalId' | 'subjectRef'>): string | null {
  return record.subjectRef ? `${record.principalId}\0${entityRefKey(record.subjectRef)}` : null
}

/** The notification payload a fired reminder carries (ids only, DATA-MODEL §9.2). */
export function reminderDueNotification(record: ReminderRecord, now: Date = new Date()): {
  kind: NotificationKind
  subject: EntityRef
  payload: { refs: EntityRef[]; dueAt: string; ids: Record<string, string> }
  at: string
} | null {
  if (!record.subjectRef) return null
  return {
    kind: REMINDER_DUE_KIND,
    subject: record.subjectRef,
    payload: { refs: [record.subjectRef], dueAt: record.at, ids: { reminderId: record.id } },
    at: now.toISOString(),
  }
}

/** Every notification kind the reminder path may emit (asserted against W1-09's table). */
export const REMINDER_NOTIFICATION_KINDS: readonly NotificationKind[] = NOTIFICATION_KINDS.filter((kind) => kind === REMINDER_DUE_KIND)