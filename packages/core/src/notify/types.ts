/**
 * W1-09 (#1506) — Activity and notification contracts (DATA-MODEL §9, TECH-SPEC §4.11).
 *
 * Dependency-free (like the rest of `@rox/core`): zod schemas live in
 * `@rox/shared/notify`. The kind vocabulary, the channel list and the row
 * shapes mirror the W1-05 DDL (`506-notify.sql`: `notification`,
 * `notification_pref`, `notification_email_batch`) column for column, so a
 * server store can persist these records without a translation layer.
 *
 * The kind table is the single source for fan-out (who gets notified) and for
 * the Inbox/Review surfaces (which tab a notification lands in).
 */

import type { EntityRef } from '../entities/refs.ts'

/**
 * Notification kinds — DATA-MODEL §9.2, exactly the 28 values of the
 * `notification.kind` CHECK constraint in `506-notify.sql` (v1 kinds, the v2
 * kinds, and the v2.1 `reminder_due`).
 */
export const NOTIFICATION_KINDS = [
  // v1 (DATA-MODEL §9.2)
  'mention',
  'assignment',
  'comment',
  'check_in_due',
  'check_in_submitted',
  'check_in_acknowledged',
  'retrospective',
  'task_due',
  'task_overdue',
  'milestone_due',
  'kpi_update_due',
  'doc_shared',
  'access_request',
  'chat_invite',
  'space_invite',
  'event_invite',
  'event_reminder',
  'im_message',
  'meeting_started',
  // v2
  'approval_request',
  'agent_report',
  'suggestion',
  'comment_reply',
  'thread_resolved',
  'invite_pending',
  'quota_warning',
  'rule_failed',
  // v2.1
  'reminder_due',
] as const

export type NotificationKind = (typeof NOTIFICATION_KINDS)[number]

const NOTIFICATION_KIND_FLAGS: Readonly<Record<string, true>> = Object.fromEntries(
  NOTIFICATION_KINDS.map(kind => [kind, true]),
)

export function isNotificationKind(value: unknown): value is NotificationKind {
  return typeof value === 'string' && NOTIFICATION_KIND_FLAGS[value] === true
}

/** Where a notification is delivered (`notification_pref.channels`). */
export const NOTIFICATION_CHANNELS = [
  'inbox',
  'os',
  'review',
  'assistant_card',
  'agent_dm',
  'calendar',
  'email_instant',
  'email_digest',
  'email_daily',
] as const

export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number]

const NOTIFICATION_CHANNEL_FLAGS: Readonly<Record<string, true>> = Object.fromEntries(
  NOTIFICATION_CHANNELS.map(channel => [channel, true]),
)

export function isNotificationChannel(value: unknown): value is NotificationChannel {
  return typeof value === 'string' && NOTIFICATION_CHANNEL_FLAGS[value] === true
}

/** `notification.email_state` (506-notify.sql). */
export const NOTIFICATION_EMAIL_STATES = ['held', 'queued', 'sent', 'skipped'] as const
export type NotificationEmailState = (typeof NOTIFICATION_EMAIL_STATES)[number]

/** `notification_email_batch.status` (506-notify.sql). */
export const NOTIFICATION_BATCH_STATUSES = ['pending', 'sending', 'sent', 'failed'] as const
export type NotificationBatchStatus = (typeof NOTIFICATION_BATCH_STATUSES)[number]

/** Which Review group a kind lands in (UI-SPEC §12). */
export const REVIEW_GROUPS = ['needs_approval', 'due_soon', 'needs_review', 'upcoming'] as const
export type ReviewGroup = (typeof REVIEW_GROUPS)[number]

/** The primary action of a Review row (UI-SPEC §12: «Чек-ин · Подтвердить · Открыть · Обновить»). */
export const REVIEW_ACTIONS = ['check_in', 'acknowledge', 'log_update', 'approve'] as const
export type ReviewAction = (typeof REVIEW_ACTIONS)[number]

export type NotificationSpecVersion = 'v1' | 'v2' | 'v2.1'

/** Propagated audience sources (see `audience.ts` for the per-kind rules). */
export type AudienceSource =
  | 'mentioned'
  | 'assignees'
  | 'champion'
  | 'reviewer'
  | 'subscribers'
  | 'allSubscribers'
  | 'threadParticipants'
  | 'owner'
  | 'invitee'
  | 'attendees'
  | 'members'
  | 'participants'
  | 'targets'

export interface NotificationKindDescriptor {
  kind: NotificationKind
  /** When the contract row landed (DATA-MODEL §9.2 markers). */
  specVersion: NotificationSpecVersion
  /** DATA-MODEL §9.2 "Trigger" column, kept verbatim for the contract doc. */
  trigger: string
  /** DATA-MODEL §9.2 "Audience" resolution (see `resolveAudience`). */
  audience: readonly AudienceSource[]
  /** DATA-MODEL §9.2 "Channels" column, mapped onto `NotificationChannel`. */
  channels: readonly NotificationChannel[]
  /** Review group when the kind surfaces in Inbox → Review. */
  reviewGroup?: ReviewGroup
  /** Primary Review row action. */
  primaryAction?: ReviewAction
}

/**
 * DATA-MODEL §9.2, one row per kind. `channels` is the *default* subscription;
 * a `notification_pref` row can mute or extend it per principal.
 */
export const NOTIFICATION_KIND_TABLE: readonly NotificationKindDescriptor[] = [
  {
    kind: 'mention',
    specVersion: 'v1',
    trigger: 'entities.mentioned_people, IM @mention',
    audience: ['mentioned'],
    channels: ['inbox', 'os', 'email_instant'],
  },
  {
    kind: 'assignment',
    specVersion: 'v1',
    trigger: 'task assignee added; champion/reviewer set; contributor added',
    audience: ['assignees'],
    channels: ['inbox', 'os', 'email_digest'],
  },
  {
    kind: 'comment',
    specVersion: 'v1',
    trigger: 'comment on a subscribed entity',
    audience: ['subscribers'],
    channels: ['inbox', 'email_digest'],
  },
  {
    kind: 'check_in_due',
    specVersion: 'v1',
    trigger: 'scheduler: next check-in due / overdue',
    audience: ['champion'],
    channels: ['review', 'assistant_card', 'email_daily'],
    reviewGroup: 'due_soon',
    primaryAction: 'check_in',
  },
  {
    kind: 'check_in_submitted',
    specVersion: 'v1',
    trigger: 'check-in published',
    audience: ['reviewer', 'allSubscribers'],
    channels: ['inbox', 'review', 'assistant_card'],
    reviewGroup: 'needs_review',
    primaryAction: 'acknowledge',
  },
  {
    kind: 'check_in_acknowledged',
    specVersion: 'v1',
    trigger: 'check-in acknowledged',
    audience: ['champion'],
    channels: ['inbox'],
  },
  {
    kind: 'retrospective',
    specVersion: 'v1',
    trigger: 'goal / project closed',
    audience: ['reviewer', 'subscribers'],
    channels: ['review', 'email_daily'],
    reviewGroup: 'needs_review',
    primaryAction: 'acknowledge',
  },
  {
    kind: 'task_due',
    specVersion: 'v1',
    trigger: 'reminder: task due',
    audience: ['assignees'],
    channels: ['os', 'review'],
    reviewGroup: 'due_soon',
  },
  {
    kind: 'task_overdue',
    specVersion: 'v1',
    trigger: 'reminder: task overdue',
    audience: ['assignees'],
    channels: ['os', 'review'],
    reviewGroup: 'due_soon',
  },
  {
    kind: 'milestone_due',
    specVersion: 'v1',
    trigger: 'scheduler: milestone due',
    audience: ['champion'],
    channels: ['review'],
    reviewGroup: 'due_soon',
  },
  {
    kind: 'kpi_update_due',
    specVersion: 'v1',
    trigger: 'cadence: KPI update due',
    audience: ['champion'],
    channels: ['review'],
    reviewGroup: 'due_soon',
    primaryAction: 'log_update',
  },
  {
    kind: 'doc_shared',
    specVersion: 'v1',
    trigger: 'ACL change: entity shared',
    audience: ['targets'],
    channels: ['inbox'],
  },
  {
    kind: 'access_request',
    specVersion: 'v1',
    trigger: 'ACL change: access requested',
    audience: ['targets'],
    channels: ['inbox'],
  },
  {
    kind: 'chat_invite',
    specVersion: 'v1',
    trigger: 'membership: added to a chat',
    audience: ['invitee'],
    channels: ['inbox', 'os'],
  },
  {
    kind: 'space_invite',
    specVersion: 'v1',
    trigger: 'membership: added to a space',
    audience: ['invitee'],
    channels: ['inbox', 'os'],
  },
  {
    kind: 'event_invite',
    specVersion: 'v1',
    trigger: 'calendar: invitation',
    audience: ['attendees'],
    channels: ['os', 'calendar'],
  },
  {
    kind: 'event_reminder',
    specVersion: 'v1',
    trigger: 'calendar: reminder',
    audience: ['attendees'],
    channels: ['os', 'calendar'],
  },
  {
    kind: 'im_message',
    specVersion: 'v1',
    trigger: 'new message',
    audience: ['members'],
    channels: ['os'],
  },
  {
    kind: 'meeting_started',
    specVersion: 'v1',
    trigger: 'VC: meeting started',
    audience: ['participants'],
    channels: ['os'],
  },
  {
    kind: 'approval_request',
    specVersion: 'v2',
    trigger: 'agent proposes a consequential action',
    audience: ['owner'],
    channels: ['inbox', 'review', 'os', 'agent_dm'],
    reviewGroup: 'needs_approval',
    primaryAction: 'approve',
  },
  {
    kind: 'agent_report',
    specVersion: 'v2',
    trigger: 'agent finished an approved / autonomous action',
    audience: ['owner'],
    channels: ['agent_dm'],
  },
  {
    kind: 'suggestion',
    specVersion: 'v2',
    trigger: 'suggestion on a doc you own / are mentioned in',
    audience: ['owner', 'mentioned'],
    channels: ['inbox', 'email_digest'],
  },
  {
    kind: 'comment_reply',
    specVersion: 'v2',
    trigger: 'reply in a thread you participate in',
    audience: ['threadParticipants'],
    channels: ['inbox'],
  },
  {
    kind: 'thread_resolved',
    specVersion: 'v2',
    trigger: 'resolution of a thread you participate in',
    audience: ['threadParticipants'],
    channels: ['inbox'],
  },
  {
    kind: 'invite_pending',
    specVersion: 'v2',
    trigger: 'your invitation not accepted after 3 / 7 / 25 days',
    audience: ['owner'],
    channels: ['inbox'],
  },
  {
    kind: 'quota_warning',
    specVersion: 'v2',
    trigger: 'drive quota 80 / 90 / 100% used',
    audience: ['owner'],
    channels: ['inbox', 'os'],
  },
  {
    kind: 'rule_failed',
    specVersion: 'v2',
    trigger: 'rule execution failed after retries',
    audience: ['owner', 'targets'],
    channels: ['agent_dm'],
  },
  {
    kind: 'reminder_due',
    specVersion: 'v2.1',
    trigger: 'a personal reminder on any entity fires (X-16)',
    audience: ['owner'],
    channels: ['inbox', 'os'],
  },
]

const BY_KIND: Readonly<Record<string, NotificationKindDescriptor | undefined>> = Object.fromEntries(
  NOTIFICATION_KIND_TABLE.map(descriptor => [descriptor.kind, descriptor]),
)

/** Total lookup: throws only for a value that is not a notification kind. */
export function notificationKindDescriptor(kind: NotificationKind): NotificationKindDescriptor {
  const descriptor = BY_KIND[kind]
  if (!descriptor) throw new Error(`Unknown notification kind: ${String(kind)}`)
  return descriptor
}

export function tryNotificationKindDescriptor(kind: string): NotificationKindDescriptor | undefined {
  return BY_KIND[kind]
}

/** True when delivery on `channel` is part of the kind's default subscription. */
export function defaultChannelEnabled(kind: NotificationKind, channel: NotificationChannel): boolean {
  return notificationKindDescriptor(kind).channels.includes(channel)
}

/** Kinds that surface in Review, grouped (UI-SPEC §12). */
export function notificationKindsForReviewGroup(group: ReviewGroup): NotificationKind[] {
  return NOTIFICATION_KIND_TABLE.filter(descriptor => descriptor.reviewGroup === group).map(descriptor => descriptor.kind)
}

// ---------------------------------------------------------------------------
// Rows (506-notify.sql)
// ---------------------------------------------------------------------------

/** Ids-only payload: refs and scalars the renderer needs; never entity content. */
export interface NotificationPayload {
  refs?: readonly EntityRef[]
  revision?: number
  dueAt?: string
  /** Extra scalar id fields (`spaceId`, `projectId`, `taskListId`, …). */
  ids?: Readonly<Record<string, string>>
}

export const NOTIFICATION_PAYLOAD_KEYS = ['refs', 'revision', 'dueAt', 'ids'] as const

/** `notification` row. */
export interface NotificationRow {
  notificationId: string
  workspaceId: string
  principalId: string
  kind: NotificationKind
  /** `subject_kind` + `subject_id` (`null` → the notification has no single subject). */
  subject?: EntityRef
  /** `actor_id` — the principal whose action caused it (never the recipient). */
  actorId?: string
  payload: NotificationPayload
  emailState?: NotificationEmailState
  /** `read_at`; absent → unread. */
  readAt?: string
  schemaVersion: number
  createdAt: string
}

/** `notification_pref` row. */
export interface NotificationPrefRow {
  workspaceId: string
  principalId: string
  kind: NotificationKind
  enabled: boolean
  channels: readonly NotificationChannel[]
  batchMinutes: number
  createdAt: string
  updatedAt: string
}

/** `notification_email_batch` row. */
export interface NotificationEmailBatchRow {
  batchId: string
  workspaceId: string
  principalId: string
  status: NotificationBatchStatus
  windowMinutes: number
  windowStartedAt: string
  sendAt: string
  sentAt?: string
  error?: string
  createdAt: string
}

/** Bump when a persisted notification shape changes. */
export const NOTIFICATION_SCHEMA_VERSION = 1

/** Window length when neither the pref nor the kind table sets one. */
export const DEFAULT_EMAIL_BATCH_WINDOW_MINUTES = 5