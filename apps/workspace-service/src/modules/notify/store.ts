/**
 * W1-09 (#1506) — Notification repository port and the in-memory store.
 *
 * STUB(#1502): `506-notify.sql` (W1-05) defines `notification`,
 * `notification_pref` and `notification_email_batch`. This module mirrors
 * those columns exactly and keeps the DDL's listing order
 * (`principal_id, created_at DESC`, unread served by the partial index), so
 * swapping in a DDL-bound Postgres store is a one-line change in
 * `createNotifyService` — no caller sees a different record shape.
 */

import type {
  NotificationEmailBatchRow,
  NotificationEmailState,
  NotificationKind,
  NotificationPrefRow,
  NotificationRow,
} from '@rox/core/notify'

export interface NotificationPageOptions {
  limit: number
  /** Notification id of the last row of the previous page (exclusive). */
  cursor?: string | undefined
}

export interface NotificationPage {
  notifications: readonly NotificationRow[]
  nextCursor?: string
}

export interface NotificationStore {
  /** Insert records; an existing `notificationId` is left alone (idempotent fan-out). */
  insert(records: readonly NotificationRow[]): Promise<readonly NotificationRow[]>
  list(workspaceId: string, principalId: string, options: NotificationPageOptions): Promise<NotificationPage>
  /** Mark the named rows read; returns the ids that changed. */
  markRead(workspaceId: string, principalId: string, ids: readonly string[], readAt: string): Promise<string[]>
  markAllRead(workspaceId: string, principalId: string, kind: NotificationKind | undefined, readAt: string): Promise<string[]>
  unreadCount(workspaceId: string, principalId: string): Promise<number>
  prefs(workspaceId: string, principalId: string): Promise<readonly NotificationPrefRow[]>
  savePrefs(rows: readonly NotificationPrefRow[]): Promise<void>
  /** Newest `pending` batch for a principal and window length, if any. */
  openBatch(workspaceId: string, principalId: string, windowMinutes: number): Promise<NotificationEmailBatchRow | undefined>
  saveBatch(row: NotificationEmailBatchRow): Promise<void>
  /** `pending` batches whose window closed (`send_at <= now`), oldest first. */
  dueBatches(now: string): Promise<readonly NotificationEmailBatchRow[]>
  /** Ids of `held` notifications for a principal created at or before `before`. */
  heldNotifications(workspaceId: string, principalId: string, before: string): Promise<readonly string[]>
  setEmailState(ids: readonly string[], state: NotificationEmailState): Promise<number>
}

function compareNewestFirst(a: NotificationRow, b: NotificationRow): number {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1
  return a.notificationId < b.notificationId ? 1 : a.notificationId > b.notificationId ? -1 : 0
}

export class InMemoryNotificationStore implements NotificationStore {
  private readonly rows = new Map<string, NotificationRow>()
  private readonly prefRows = new Map<string, NotificationPrefRow>()
  private readonly batchRows = new Map<string, NotificationEmailBatchRow>()

  async insert(records: readonly NotificationRow[]): Promise<readonly NotificationRow[]> {
    const inserted: NotificationRow[] = []
    for (const record of records) {
      if (this.rows.has(record.notificationId)) continue
      this.rows.set(record.notificationId, record)
      inserted.push(record)
    }
    return inserted
  }

  async list(workspaceId: string, principalId: string, options: NotificationPageOptions): Promise<NotificationPage> {
    const all = [...this.rows.values()].filter(row => row.workspaceId === workspaceId && row.principalId === principalId).sort(compareNewestFirst)
    const start = options.cursor === undefined ? 0 : all.findIndex(row => row.notificationId === options.cursor) + 1
    const page = all.slice(start, start + options.limit)
    const page_: NotificationPage = { notifications: page }
    if (page.length === options.limit && start + options.limit < all.length) {
      page_.nextCursor = page[page.length - 1]!.notificationId
    }
    return page_
  }

  async markRead(workspaceId: string, principalId: string, ids: readonly string[], readAt: string): Promise<string[]> {
    const changed: string[] = []
    for (const id of ids) {
      const row = this.rows.get(id)
      if (!row || row.workspaceId !== workspaceId || row.principalId !== principalId || row.readAt !== undefined) continue
      this.rows.set(id, { ...row, readAt })
      changed.push(id)
    }
    return changed
  }

  async markAllRead(workspaceId: string, principalId: string, kind: NotificationKind | undefined, readAt: string): Promise<string[]> {
    const changed: string[] = []
    for (const row of this.rows.values()) {
      if (row.workspaceId !== workspaceId || row.principalId !== principalId || row.readAt !== undefined) continue
      if (kind !== undefined && row.kind !== kind) continue
      this.rows.set(row.notificationId, { ...row, readAt })
      changed.push(row.notificationId)
    }
    return changed
  }

  async unreadCount(workspaceId: string, principalId: string): Promise<number> {
    let count = 0
    for (const row of this.rows.values()) {
      if (row.workspaceId === workspaceId && row.principalId === principalId && row.readAt === undefined) count += 1
    }
    return count
  }

  async prefs(workspaceId: string, principalId: string): Promise<readonly NotificationPrefRow[]> {
    return [...this.prefRows.values()].filter(row => row.workspaceId === workspaceId && row.principalId === principalId)
  }

  async savePrefs(rows: readonly NotificationPrefRow[]): Promise<void> {
    for (const row of rows) this.prefRows.set(`${row.workspaceId}\u0000${row.principalId}\u0000${row.kind}`, row)
  }

  async openBatch(workspaceId: string, principalId: string, windowMinutes: number): Promise<NotificationEmailBatchRow | undefined> {
    return [...this.batchRows.values()]
      .filter(batch => batch.workspaceId === workspaceId && batch.principalId === principalId && batch.windowMinutes === windowMinutes && batch.status === 'pending')
      .sort((a, b) => (a.windowStartedAt < b.windowStartedAt ? 1 : -1))[0]
  }

  async saveBatch(row: NotificationEmailBatchRow): Promise<void> {
    this.batchRows.set(row.batchId, row)
  }

  async dueBatches(now: string): Promise<readonly NotificationEmailBatchRow[]> {
    return [...this.batchRows.values()]
      .filter(batch => batch.status === 'pending' && batch.sendAt <= now)
      .sort((a, b) => (a.sendAt === b.sendAt ? (a.batchId < b.batchId ? -1 : 1) : a.sendAt < b.sendAt ? -1 : 1))
  }

  async heldNotifications(workspaceId: string, principalId: string, before: string): Promise<readonly string[]> {
    return [...this.rows.values()]
      .filter(row => row.workspaceId === workspaceId && row.principalId === principalId && row.emailState === 'held' && row.createdAt <= before)
      .map(row => row.notificationId)
  }

  async setEmailState(ids: readonly string[], state: NotificationEmailState): Promise<number> {
    let changed = 0
    for (const id of ids) {
      const row = this.rows.get(id)
      if (!row || row.emailState === state) continue
      this.rows.set(id, { ...row, emailState: state })
      changed += 1
    }
    return changed
  }

  /** Test/diagnostic snapshot of every stored row. */
  all(workspaceId?: string, principalId?: string): readonly NotificationRow[] {
    return [...this.rows.values()].filter(row =>
      (workspaceId === undefined || row.workspaceId === workspaceId) && (principalId === undefined || row.principalId === principalId))
  }

  batches(): readonly NotificationEmailBatchRow[] {
    return [...this.batchRows.values()]
  }
}