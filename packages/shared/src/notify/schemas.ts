/**
 * W1-09 (#1506) — Zod validation for notifications (DATA-MODEL §9.2, 506-notify.sql).
 *
 * `@rox/core/notify` holds the types and the structural schemas; this file is
 * the untrusted-input boundary: `notifications.*` command payloads, the notify
 * HTTP routes and the `user:{id}` push payloads. The domain types come from
 * `@rox/core/notify`.
 */

import { z } from 'zod'
import {
  MAX_MARK_READ_IDS,
  MAX_PREF_UPDATES,
  NOTIFICATION_BATCH_STATUSES,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_EMAIL_STATES,
  NOTIFICATION_KINDS,
  isNotificationChannel,
  isNotificationKind,
  type NotificationEmailBatchRow,
  type NotificationKind,
  type NotificationPayload,
  type NotificationPrefRow,
  type NotificationRow,
} from '@rox/core/notify'
import { entityRefSchema } from '../entities/schemas'

/** Ids the store accepts (no NUL / control characters, ≤ 256 chars). */
const idSchema = z.string().min(1).max(256).refine(value => !/[\u0000-\u001f\u007f]/.test(value), { message: 'control characters are not allowed' })

export const notificationKindSchema = z
  .string()
  .refine(isNotificationKind, { message: 'unknown notification kind' })
  .transform(value => value as NotificationKind)

export const notificationChannelSchema = z
  .string()
  .refine(isNotificationChannel, { message: 'unknown notification channel' })
  .transform(value => value as (typeof NOTIFICATION_CHANNELS)[number])

export const notificationKindsSchema = z.array(notificationKindSchema).min(1)

/** Ids-only payload: refs, revision, a due instant and scalar id fields. */
export const notificationPayloadSchema: z.ZodType<NotificationPayload> = z.strictObject({
  refs: z.array(entityRefSchema).max(32).optional(),
  revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
  dueAt: z.string().min(1).max(64).optional(),
  ids: z.record(z.string().min(1).max(64), z.string().min(1).max(256)).optional(),
})

export const notificationSchema: z.ZodType<NotificationRow> = z.strictObject({
  notificationId: idSchema,
  workspaceId: idSchema,
  principalId: idSchema,
  kind: notificationKindSchema,
  subject: entityRefSchema.optional(),
  actorId: idSchema.optional(),
  payload: notificationPayloadSchema,
  emailState: z.enum(NOTIFICATION_EMAIL_STATES).optional(),
  readAt: z.string().min(1).max(64).optional(),
  schemaVersion: z.number().int().positive(),
  createdAt: z.string().min(1).max(64),
})

export const notificationPrefSchema: z.ZodType<NotificationPrefRow> = z.strictObject({
  workspaceId: idSchema,
  principalId: idSchema,
  kind: notificationKindSchema,
  enabled: z.boolean(),
  channels: z.array(notificationChannelSchema).max(NOTIFICATION_CHANNELS.length),
  batchMinutes: z.number().int().min(0).max(1440),
  createdAt: z.string().min(1).max(64),
  updatedAt: z.string().min(1).max(64),
})

export const notificationEmailBatchSchema: z.ZodType<NotificationEmailBatchRow> = z.strictObject({
  batchId: idSchema,
  workspaceId: idSchema,
  principalId: idSchema,
  status: z.enum(NOTIFICATION_BATCH_STATUSES),
  windowMinutes: z.number().int().positive().max(1440),
  windowStartedAt: z.string().min(1).max(64),
  sendAt: z.string().min(1).max(64),
  sentAt: z.string().min(1).max(64).optional(),
  error: z.string().max(512).optional(),
  createdAt: z.string().min(1).max(64),
})

// ---------------------------------------------------------------------------
// Command and query payloads
// ---------------------------------------------------------------------------

/** One pref update (`notifications.update_prefs`). */
export const notificationPrefUpdateSchema = z.strictObject({
  kind: notificationKindSchema,
  enabled: z.boolean().optional(),
  channels: z.array(notificationChannelSchema).max(NOTIFICATION_CHANNELS.length).optional(),
  batchMinutes: z.number().int().min(0).max(1440).optional(),
})

export const notificationsMarkReadPayloadSchema = z.strictObject({
  ids: z.array(idSchema).min(1).max(MAX_MARK_READ_IDS).refine(ids => new Set(ids).size === ids.length, { message: 'ids must be unique' }),
})

export const notificationsMarkAllReadPayloadSchema = z.strictObject({
  kind: notificationKindSchema.optional(),
})

export const notificationsUpdatePrefsPayloadSchema = z.strictObject({
  prefs: z.array(notificationPrefUpdateSchema).min(1).max(MAX_PREF_UPDATES),
})

/** `GET /notifications` response. */
export const notificationListResultSchema = z.strictObject({
  notifications: z.array(notificationSchema),
  nextCursor: idSchema.optional(),
  unread: z.number().int().nonnegative(),
})

/** `POST /notifications/read` response. */
export const notificationReadResultSchema = z.strictObject({
  updated: z.number().int().nonnegative(),
  readAt: z.string().min(1).max(64),
  unread: z.number().int().nonnegative(),
})

/** `POST /notifications/read` body for a mark-all-read (the command takes only `kind`). */
export const notificationsMarkAllReadRequestSchema = z.strictObject({
  all: z.literal(true),
  kind: notificationKindSchema.optional(),
})

/** `POST /notifications/read` body: named ids, or `all: true` (with an optional kind filter). */
export const notificationReadRequestSchema = z.union([notificationsMarkReadPayloadSchema, notificationsMarkAllReadRequestSchema])

/** `GET /notifications` query (`limit` 1…100, opaque uuid cursor — the routing rules). */
export const notificationListQuerySchema = z.strictObject({
  limit: z.number().int().min(1).max(100).optional(),
  cursor: idSchema.optional(),
})

// ---------------------------------------------------------------------------
// `user:{id}` push payloads (TECH-SPEC §5)
// ---------------------------------------------------------------------------

/** `notification.created` — the notification without its body (ids only). */
export const notificationCreatedPushSchema = z.strictObject({
  notification: notificationSchema,
})

/** `notification.read` — ids, or `all: true` for a mark-all-read. */
export const notificationReadPushSchema = z.strictObject({
  ids: z.array(idSchema).max(MAX_MARK_READ_IDS).optional(),
  all: z.literal(true).optional(),
  kind: notificationKindSchema.optional(),
  readAt: z.string().min(1).max(64),
  unread: z.number().int().nonnegative(),
})

export type NotificationsMarkReadPayloadInput = z.infer<typeof notificationsMarkReadPayloadSchema>
export type NotificationsMarkAllReadPayloadInput = z.infer<typeof notificationsMarkAllReadPayloadSchema>
export type NotificationsUpdatePrefsPayloadInput = z.infer<typeof notificationsUpdatePrefsPayloadSchema>
export type NotificationCreatedPush = z.infer<typeof notificationCreatedPushSchema>
export type NotificationReadPush = z.infer<typeof notificationReadPushSchema>
export type NotificationReadRequest = z.infer<typeof notificationReadRequestSchema>
export type NotificationListResultPayload = z.infer<typeof notificationListResultSchema>
export type NotificationReadResultPayload = z.infer<typeof notificationReadResultSchema>
