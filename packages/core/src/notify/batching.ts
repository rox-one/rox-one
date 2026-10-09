/**
 * W1-09 (#1506) — Email batching windows (DATA-MODEL §5.10, `506-notify.sql`).
 *
 * Outbound mail is not configured yet, so the pipeline stops at the batch row:
 * the worker opens one `notification_email_batch` per principal and window,
 * coalesces every notification that lands inside the window, and — with no
 * transport — marks the batch `skipped` instead of sending. The batching
 * decision itself is real and testable; only the final hop is absent.
 *
 * Windows are table-driven. The delivery class comes from the kind table's
 * channels (instant email / digest / daily summary), the length from
 * `EMAIL_WINDOW_MINUTES`, and a principal's `notification_pref.batch_minutes`
 * overrides the default for batched kinds.
 */

import {
  DEFAULT_EMAIL_BATCH_WINDOW_MINUTES,
  NOTIFICATION_KINDS,
  notificationKindDescriptor,
  type NotificationEmailBatchRow,
  type NotificationKind,
} from './types.ts'

export type EmailDelivery = 'instant' | 'batched' | 'digest' | 'none'

/** Window length per delivery class, in minutes (`instant` sends immediately). */
export const EMAIL_WINDOW_MINUTES: Readonly<Record<EmailDelivery, number>> = {
  instant: 0,
  batched: DEFAULT_EMAIL_BATCH_WINDOW_MINUTES,
  digest: 24 * 60,
  none: 0,
}

/** The delivery class of a kind, from its declared channels. */
export function emailDeliveryFor(kind: NotificationKind): EmailDelivery {
  const channels = notificationKindDescriptor(kind).channels
  if (channels.includes('email_instant')) return 'instant'
  if (channels.includes('email_digest')) return 'batched'
  if (channels.includes('email_daily')) return 'digest'
  return 'none'
}

/** Batched kinds only — the ones the worker must hold until their window closes. */
export const BATCHED_NOTIFICATION_KINDS: readonly NotificationKind[] = NOTIFICATION_KINDS.filter(
  kind => emailDeliveryFor(kind) === 'batched',
)

export interface EmailDeliveryPlan {
  delivery: EmailDelivery
  /** Minutes to hold the notification (0 = send as soon as the transport allows). */
  windowMinutes: number
}

/** Per-kind plan, honouring a `notification_pref.batch_minutes` override. */
export function planEmailDelivery(kind: NotificationKind, prefBatchMinutes?: number): EmailDeliveryPlan {
  const delivery = emailDeliveryFor(kind)
  const fallback = EMAIL_WINDOW_MINUTES[delivery]
  if (delivery !== 'batched' || prefBatchMinutes === undefined) return { delivery, windowMinutes: fallback }
  return { delivery, windowMinutes: prefBatchMinutes > 0 ? prefBatchMinutes : DEFAULT_EMAIL_BATCH_WINDOW_MINUTES }
}

export interface OpenEmailBatchInput {
  batchId: string
  workspaceId: string
  principalId: string
  /** Epoch ms the window opened. */
  at: number
  windowMinutes: number
}

/** Fresh `pending` batch row; `send_at` is the instant the window closes. */
export function openEmailBatch(input: OpenEmailBatchInput): NotificationEmailBatchRow {
  const startedAt = new Date(input.at)
  const sendAt = new Date(input.at + input.windowMinutes * 60_000)
  return {
    batchId: input.batchId,
    workspaceId: input.workspaceId,
    principalId: input.principalId,
    status: 'pending',
    windowMinutes: input.windowMinutes,
    windowStartedAt: startedAt.toISOString(),
    sendAt: sendAt.toISOString(),
    createdAt: startedAt.toISOString(),
  }
}

/**
 * Where a notification lands: inside an open batch (same principal, same
 * window length, window still open) or a new one. `notification_email_batch`
 * has no kind column, so one principal's notifications share a window —
 * a kind with a longer window opens its own batch instead of stretching an
 * open one. `batchId` is supplied by the caller so id generation stays with
 * the host (deterministic in tests).
 */
export interface CoalesceResult {
  batch: NotificationEmailBatchRow
  created: boolean
}

export function coalesceNotificationIntoBatch(
  open: NotificationEmailBatchRow | undefined,
  input: OpenEmailBatchInput,
): CoalesceResult {
  if (
    open
    && open.status === 'pending'
    && open.workspaceId === input.workspaceId
    && open.principalId === input.principalId
    && open.windowMinutes === input.windowMinutes
    && input.at < Date.parse(open.sendAt)
  ) {
    return { batch: open, created: false }
  }
  return { batch: openEmailBatch(input), created: true }
}

/** `pending` batches whose window closed at or before `now`, oldest window first. */
export function dueEmailBatches(
  batches: readonly NotificationEmailBatchRow[],
  now: number,
): NotificationEmailBatchRow[] {
  return batches
    .filter(batch => batch.status === 'pending' && Date.parse(batch.sendAt) <= now)
    .sort((a, b) => Date.parse(a.sendAt) - Date.parse(b.sendAt))
}