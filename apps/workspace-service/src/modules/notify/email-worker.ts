/**
 * W1-09 (#1506) — Email batching worker (skeleton until outbound mail is configured).
 *
 * The fan-out records email-worthy notifications as `held` and opens one
 * `notification_email_batch` per principal and window. This worker closes the
 * windows that are due: it hands the principal's held notifications to the
 * transport and marks them `sent`, or — with no transport configured, which is
 * the current state — marks them `skipped` so nothing is silently left held.
 *
 * There is no timer here: the host decides when `runOnce` runs (tests drive it
 * with an explicit clock), so the module stays inert unless it is started.
 */

import type { NotificationStore } from './store.ts'

export interface NotificationEmailMessage {
  workspaceId: string
  principalId: string
  windowMinutes: number
  notificationIds: readonly string[]
}

/** Outbound mail port. Absent → in-app only (nothing leaves the machine). */
export interface NotificationEmailTransport {
  send(message: NotificationEmailMessage): Promise<void>
}

export interface NotifyEmailWorkerOptions {
  store: NotificationStore
  transport?: NotificationEmailTransport | null
  now?: () => Date
}

export interface EmailWorkerSummary {
  /** Batches whose window had closed. */
  due: number
  sent: number
  skipped: number
  failed: number
  /** Notifications whose email state changed. */
  notifications: number
}

export class NotifyEmailWorker {
  private readonly store: NotificationStore
  private readonly transport: NotificationEmailTransport | null
  private readonly now: () => Date

  constructor(options: NotifyEmailWorkerOptions) {
    this.store = options.store
    this.transport = options.transport ?? null
    this.now = options.now ?? (() => new Date())
  }

  outboundConfigured(): boolean {
    return this.transport !== null
  }

  /** Close every window that is due at `at` (default: now). */
  async runOnce(at: Date = this.now()): Promise<EmailWorkerSummary> {
    const clock = at.toISOString()
    const due = await this.store.dueBatches(clock)
    const summary: EmailWorkerSummary = { due: due.length, sent: 0, skipped: 0, failed: 0, notifications: 0 }
    for (const batch of due) {
      const ids = await this.store.heldNotifications(batch.workspaceId, batch.principalId, batch.sendAt)
      if (ids.length === 0) {
        await this.store.saveBatch({ ...batch, status: 'sent', sentAt: clock })
        summary.sent += 1
        continue
      }
      if (!this.transport) {
        summary.notifications += await this.store.setEmailState(ids, 'skipped')
        await this.store.saveBatch({ ...batch, status: 'failed', error: 'outbound-disabled', sentAt: clock })
        summary.skipped += 1
        continue
      }
      await this.store.saveBatch({ ...batch, status: 'sending', error: undefined })
      try {
        await this.transport.send({ workspaceId: batch.workspaceId, principalId: batch.principalId, windowMinutes: batch.windowMinutes, notificationIds: ids })
        summary.notifications += await this.store.setEmailState(ids, 'sent')
        await this.store.saveBatch({ ...batch, status: 'sent', sentAt: clock, error: undefined })
        summary.sent += 1
      } catch (error) {
        // The rows stay `held` and the batch stays `pending`, so the next run
        // (`dueBatches` selects `pending` with `send_at <= now`) retries the same window.
        await this.store.saveBatch({ ...batch, status: 'pending', error: describeError(error) })
        summary.failed += 1
      }
    }
    return summary
  }

}

function describeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.length > 512 ? message.slice(0, 512) : message
}