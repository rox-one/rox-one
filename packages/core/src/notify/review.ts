/**
 * W1-09 (#1506) — Review model (TECH-SPEC §4.11, UI-SPEC §12).
 *
 * The Review tab merges two sources: the local entities that are due
 * (personal tasks, local goals / milestones / KPIs — `source: 'local'`) and
 * the server's `review.get` groups (`source: 'server'`). Both reduce to
 * `ReviewItem`: ref + ids-only payload, never titles.
 *
 * Groups, in the order UI-SPEC §12 shows them:
 *   1. `needs_approval` — «Нужно ваше подтверждение» (agent approval requests; v2)
 *   2. `due_soon`       — «Скоро срок / просрочено» (my check-ins, tasks, milestones, KPIs)
 *   3. `needs_review`   — «Ждёт вашего ревью» (check-ins and retrospectives awaiting acknowledgement)
 *   4. `upcoming`       — «Моя предстоящая работа»
 */

import type { EntityRef } from '../entities/refs.ts'
import {
  NOTIFICATION_KIND_TABLE,
  REVIEW_GROUPS,
  type NotificationKind,
  type ReviewAction,
  type ReviewGroup,
} from './types.ts'

export const REVIEW_GROUP_ORDER: readonly ReviewGroup[] = ['needs_approval', 'due_soon', 'needs_review', 'upcoming']

export type ReviewSource = 'local' | 'server'

export interface ReviewItem {
  /** Stable identity for done/snooze state and for the merge (`notification:<id>` or `<kind>:<ref>`). */
  id: string
  group: ReviewGroup
  source: ReviewSource
  /** Entity the row points at; the title is resolved from it at render time. */
  subject?: EntityRef
  /** Notification kind when the row comes from the notification pipeline. */
  kind?: NotificationKind
  /** `notification.notification_id` for server rows. */
  notificationId?: string
  /** Epoch ms when the row is due (drives the red «overdue» marker). */
  dueAt?: number
  /** Epoch ms the row was produced. */
  at: number
  /** Primary action (UI-SPEC §12: Чек-ин · Подтвердить · Открыть · Обновить). */
  action?: ReviewAction
}

/** A Review row is overdue when its due instant has passed. */
export function isReviewOverdue(item: ReviewItem, now: number): boolean {
  return item.dueAt !== undefined && item.dueAt < now
}

/**
 * Merge the local and server sources. Server rows win on identity collision
 * (they carry the acknowledged `notification_id`); the result is deduped and
 * ordered newest-first, with due rows ahead of the rest inside their group.
 */
export function mergeReviewItems(local: readonly ReviewItem[], server: readonly ReviewItem[]): ReviewItem[] {
  const merged = new Map<string, ReviewItem>()
  for (const item of local) merged.set(item.id, item)
  for (const item of server) merged.set(item.id, item)
  return [...merged.values()].sort(compareReviewItems)
}

function rankOf(item: ReviewItem): number {
  return REVIEW_GROUP_ORDER.indexOf(item.group)
}

function compareReviewItems(a: ReviewItem, b: ReviewItem): number {
  const rank = rankOf(a) - rankOf(b)
  if (rank !== 0) return rank
  if (a.group === 'due_soon') {
    if (a.dueAt !== undefined && b.dueAt !== undefined && a.dueAt !== b.dueAt) return a.dueAt - b.dueAt
    if (a.dueAt !== undefined && b.dueAt === undefined) return -1
    if (a.dueAt === undefined && b.dueAt !== undefined) return 1
  }
  if (a.at !== b.at) return b.at - a.at
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

export interface ReviewGroupView {
  group: ReviewGroup
  items: readonly ReviewItem[]
  /** Rows in this group (badge count). */
  count: number
  /** Rows whose due instant passed. */
  overdue: number
}

export interface GroupReviewOptions {
  now: number
  /** Restrict the output to these groups (default: every group, in `REVIEW_GROUP_ORDER`). */
  groups?: readonly ReviewGroup[] | undefined
  /** Drop these item ids (done / snoozed in the Inbox state). */
  excluded?: ReadonlySet<string> | undefined
}

/** The Review view: non-empty groups in UI-SPEC order. */
export function groupReviewItems(items: readonly ReviewItem[], options: GroupReviewOptions): ReviewGroupView[] {
  const allowed = options.groups ?? REVIEW_GROUP_ORDER
  const views: ReviewGroupView[] = []
  for (const group of REVIEW_GROUP_ORDER) {
    if (!allowed.includes(group)) continue
    const grouped = items
      .filter(item => item.group === group && !options.excluded?.has(item.id))
      .sort(compareReviewItems)
    if (grouped.length === 0) continue
    views.push({
      group,
      items: grouped,
      count: grouped.length,
      overdue: grouped.filter(item => isReviewOverdue(item, options.now)).length,
    })
  }
  return views
}

export interface ReviewCounts {
  total: number
  overdue: number
  byGroup: Record<ReviewGroup, number>
}

export function reviewCounts(items: readonly ReviewItem[], now: number): ReviewCounts {
  const byGroup = Object.fromEntries(REVIEW_GROUPS.map(group => [group, 0])) as Record<ReviewGroup, number>
  let overdue = 0
  for (const item of items) {
    byGroup[item.group] += 1
    if (isReviewOverdue(item, now)) overdue += 1
  }
  return { total: items.length, overdue, byGroup }
}

/** Review rows a notification kind produces (`undefined` → the kind is not a Review row). */
export function reviewGroupForKind(kind: NotificationKind): ReviewGroup | undefined {
  return NOTIFICATION_KIND_TABLE.find(descriptor => descriptor.kind === kind)?.reviewGroup
}