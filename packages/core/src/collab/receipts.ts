/**
 * W1-14 (#1511) — Read receipts and doc views (TECH-SPEC §11.7, DATA-MODEL §5.17).
 *
 * Receipts are **derived**, never stored per message (ADR-U18, alternative
 * rejected: a row per message does not scale for groups):
 * - messages: `im.mark_read {chatId, seq}` raises `chat_member.last_read_seq`
 *   monotonically and emits `read.changed` on `channel:{id}`; "Read by" is
 *   computed on demand from the member rows, capped at 500 members;
 * - docs: `docs.record_view {docId}` upserts one `doc_view` row per
 *   principal, debounced to one write per 10 min;
 * - tasks have no receipts — the assignee's "seen" is
 *   `work_item_user_state.seen_at`.
 */

export const CHAT_KINDS = ['dm', 'group', 'channel'] as const
export type ChatKind = (typeof CHAT_KINDS)[number]

/** `read.changed` is throttled to one event per 2 s per member. */
export const READ_RECEIPT_THROTTLE_MS = 2_000

/** Above this member count a group shows no receipts at all (Lark rule, §18.8). */
export const READ_RECEIPT_MEMBER_CAP = 500

/** `im.mark_read {chatId, seq}` — the chat is the envelope target. */
export interface MarkReadPayload {
  seq: number
}

/** One `chat_member` row, as much of it as receipts need. */
export interface ChatMemberRead {
  principalId: string
  lastReadSeq: number
  /** ISO-8601 of the last `im.mark_read` that moved `lastReadSeq`. */
  readAt?: string
}

/** The monotonic rule: a receipt never moves backwards (§11.7). */
export function nextLastReadSeq(current: number | null | undefined, seq: number): number {
  return Math.max(current ?? 0, seq)
}

export interface ReadBy {
  /** `false` for a chat above the cap: the UI shows no receipts at all. */
  shown: boolean
  /** Members whose `last_read_seq ≥ seq`, sorted by principal id. */
  read: string[]
  unread: string[]
  /** Per-member read time, for the popover. */
  readAt: Record<string, string>
}

/**
 * "Read by" for message `seq`, computed on demand over the chat's members.
 * `cap` is the §11.7 ceiling; a chat above it reports `shown: false`.
 */
export function readBy(members: readonly ChatMemberRead[], seq: number, cap: number = READ_RECEIPT_MEMBER_CAP): ReadBy {
  if (members.length > cap) return { shown: false, read: [], unread: [], readAt: {} }
  const read: string[] = []
  const unread: string[] = []
  const readAt: Record<string, string> = {}
  for (const member of [...members].sort((a, b) => (a.principalId < b.principalId ? -1 : a.principalId > b.principalId ? 1 : 0))) {
    if (member.lastReadSeq >= seq) {
      read.push(member.principalId)
      if (member.readAt) readAt[member.principalId] = member.readAt
    } else {
      unread.push(member.principalId)
    }
  }
  return { shown: true, read, unread, readAt }
}

/**
 * `read.changed` throttling. The caller stores the timestamp of the last event
 * it emitted for this member.
 */
export function readChangedAllowed(previousEmittedAt: number | null, now: number): boolean {
  return previousEmittedAt === null || now - previousEmittedAt >= READ_RECEIPT_THROTTLE_MS
}

export interface ReadReceiptPrivacy {
  principalId: string
  shareReadReceipts: boolean
}

/**
 * Whether a `read.changed` may leave the reader at all (§11.7): in a DM both
 * sides must share receipts, otherwise neither sees the other's; a group is
 * not covered by the DM privacy switch.
 */
export function readChangedVisible(kind: ChatKind, reader: ReadReceiptPrivacy, partner: ReadReceiptPrivacy | null): boolean {
  if (kind === 'group') return true
  if (!partner) return false
  return reader.shareReadReceipts && partner.shareReadReceipts
}

/** `docs.record_view` is debounced to one write per 10 min per user. */
export const DOC_VIEW_DEBOUNCE_MS = 10 * 60_000

/** `doc_view` row (`17-collab.sql`). */
export interface DocViewRecord {
  docId: string
  principalId: string
  firstViewedAt: string
  lastViewedAt: string
  viewCount: number
}

/**
 * The row a view writes, or `null` when the view is inside the debounce window
 * (no write at all). `firstViewedAt` is never moved.
 */
export function recordDocView(current: DocViewRecord | null, docId: string, principalId: string, now: string): DocViewRecord | null {
  if (current) {
    if (Date.parse(now) - Date.parse(current.lastViewedAt) < DOC_VIEW_DEBOUNCE_MS) return null
    return { ...current, lastViewedAt: now, viewCount: current.viewCount + 1 }
  }
  return { docId, principalId, firstViewedAt: now, lastViewedAt: now, viewCount: 1 }
}

/** One row of the "Viewed by" list (UI-SPEC §18.8). */
export interface DocViewer {
  principalId: string
  firstViewedAt: string
  lastViewedAt: string
  viewCount: number
}

export function docViewers(views: readonly DocViewRecord[]): DocViewer[] {
  return [...views]
    .sort((a, b) => (a.lastViewedAt === b.lastViewedAt ? (a.principalId < b.principalId ? -1 : 1) : a.lastViewedAt < b.lastViewedAt ? 1 : -1))
    .map(view => ({ principalId: view.principalId, firstViewedAt: view.firstViewedAt, lastViewedAt: view.lastViewedAt, viewCount: view.viewCount }))
}