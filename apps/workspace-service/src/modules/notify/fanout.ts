/**
 * W1-09 (#1506) — `domain_event` → notification fan-out.
 *
 * The consumer runs as a relay sink (W1-03 `DomainEventRelay`): committed
 * events, at-least-once, after commit. At-least-once is safe here because
 * notification ids are derived from `(event_id, principal, kind)`, so a
 * redelivered event writes nothing instead of notifying twice.
 *
 * Per recipient, in order:
 *   1. audience resolution (DATA-MODEL §9.2 rules, actor excluded);
 *   2. ACL — `can(recipient, 'read', subject)`; no access means no notification;
 *   3. preferences — a muted kind is not delivered at all;
 *   4. record + `user:{id}` push (`notification.created`), ids only.
 */

import { createHash } from 'node:crypto'
import { authorize, type Authorizer } from '../../../../../packages/core/src/commands/index.ts'
import { userTopic, type DomainEvent, type RealtimePublication } from '../../../../../packages/core/src/events/index.ts'
import {
  NOTIFICATION_SCHEMA_VERSION,
  coalesceNotificationIntoBatch,
  emailDeliveryFor,
  indexNotificationPrefs,
  planEmailDelivery,
  planNotifications,
  resolveNotificationPref,
  type NotificationEmailState,
  type NotificationKind,
  type NotificationPrefRow,
  type NotificationRow,
} from '../../../../../packages/core/src/notify/index.ts'
import { audienceFromPayload, type AudienceReader } from './audience-adapter.ts'
import type { NotificationStore } from './store.ts'

export type NotifyPush = (workspaceId: string, publications: readonly RealtimePublication[]) => void

export interface NotificationFanoutOptions {
  store: NotificationStore
  /** W1-04 (#1501) ACL; the workspace service passes its `WorkspaceAuthorizer`. */
  authorizer: Authorizer
  /** Defaults to the payload reader (STUB(#1503)). */
  audience?: AudienceReader
  /** Realtime push (`user:{id}`). Absent → notifications are only recorded. */
  push?: NotifyPush
  /** Outbound mail configured? `false` (default) records `skipped` — in-app only. */
  outboundEmail?: boolean
  now?: () => Date
}

export interface FanoutSummary {
  events: number
  /** Notifications the audience rules produced (before ACL / prefs). */
  planned: number
  /** Rows actually written. */
  created: number
  /** Recipients dropped because they cannot read the subject. */
  denied: number
  /** Recipients dropped by a muted preference. */
  muted: number
  /** Rows awaiting the email window. */
  held: number
  /** Rows recorded in-app only (no outbound mail configured). */
  skipped: number
  /** Events whose trigger is silent, unmapped or has nobody to notify. */
  quiet: number
}

/**
 * `(event_id, principal, kind)` → uuid. A relay retry or a restarted consumer
 * re-derives the same id, so the store's insert is idempotent.
 */
export function deterministicNotificationId(eventId: string, principalId: string, kind: NotificationKind): string {
  const hex = createHash('sha256').update(`${eventId}\u0000${principalId}\u0000${kind}`).digest('hex').slice(0, 32).split('')
  hex[12] = '8'
  hex[16] = '8'
  return `${hex.slice(0, 8).join('')}-${hex.slice(8, 12).join('')}-${hex.slice(12, 16).join('')}-${hex.slice(16, 20).join('')}-${hex.slice(20, 32).join('')}`
}

export class NotificationFanout {
  private readonly store: NotificationStore
  private readonly authorizer: Authorizer
  private readonly audience: AudienceReader
  private readonly push: NotifyPush | undefined
  private readonly outboundEmail: boolean
  private readonly now: () => Date

  constructor(options: NotificationFanoutOptions) {
    this.store = options.store
    this.authorizer = options.authorizer
    this.audience = options.audience ?? { async read(event) { return audienceFromPayload(event) } }
    this.push = options.push
    this.outboundEmail = options.outboundEmail ?? false
    this.now = options.now ?? (() => new Date())
  }

  /** Consume a committed batch of domain events (relay sink). */
  async ingest(events: readonly DomainEvent[]): Promise<FanoutSummary> {
    const summary: FanoutSummary = { events: 0, planned: 0, created: 0, denied: 0, muted: 0, held: 0, skipped: 0, quiet: 0 }
    const records: NotificationRow[] = []
    const prefsCache = new Map<string, Readonly<Record<string, NotificationPrefRow | undefined>>>()

    for (const event of events) {
      summary.events += 1
      const plan = planNotifications({ event, audience: await this.audience.read(event) })
      if (plan.notifications.length === 0 || !plan.kind) {
        summary.quiet += 1
        continue
      }
      const createdAt = event.createdAt || this.now().toISOString()
      for (const planned of plan.notifications) {
        summary.planned += 1
        const allowed = await authorize(
          this.authorizer,
          { principalId: planned.principalId, kind: 'user', workspaceId: event.workspaceId },
          'read',
          planned.subject ?? null,
        )
        if (!allowed) {
          summary.denied += 1
          continue
        }
        let index = prefsCache.get(planned.principalId)
        if (!index) {
          index = indexNotificationPrefs(await this.store.prefs(event.workspaceId, planned.principalId))
          prefsCache.set(planned.principalId, index)
        }
        const pref = resolveNotificationPref(index, planned.principalId, planned.kind)
        if (!pref.enabled) {
          summary.muted += 1
          continue
        }
        const emailState = this.emailStateFor(planned.kind)
        if (emailState === 'held') summary.held += 1
        if (emailState === 'skipped') summary.skipped += 1
        const record: NotificationRow = {
          notificationId: deterministicNotificationId(event.eventId, planned.principalId, planned.kind),
          workspaceId: event.workspaceId,
          principalId: planned.principalId,
          kind: planned.kind,
          payload: planned.payload,
          schemaVersion: NOTIFICATION_SCHEMA_VERSION,
          createdAt,
        }
        if (planned.subject) record.subject = planned.subject
        if (planned.actorId) record.actorId = planned.actorId
        if (emailState) record.emailState = emailState
        records.push(record)
        if (emailState === 'held') await this.openBatch(record, pref.batchMinutes)
      }
    }

    const inserted = await this.store.insert(records)
    summary.created = inserted.length
    this.publishCreated(inserted)
    return summary
  }

  private publishCreated(rows: readonly NotificationRow[]): void {
    if (!this.push || rows.length === 0) return
    const byRecipient = new Map<string, { workspaceId: string; publications: RealtimePublication[] }>()
    for (const row of rows) {
      const key = `${row.workspaceId}\u0000${row.principalId}`
      const entry = byRecipient.get(key) ?? { workspaceId: row.workspaceId, publications: [] }
      entry.publications.push({ topic: userTopic(row.principalId), type: 'notification.created', payload: { notification: row } })
      byRecipient.set(key, entry)
    }
    for (const { workspaceId, publications } of byRecipient.values()) this.push(workspaceId, publications)
  }

  private emailStateFor(kind: NotificationKind): NotificationEmailState | undefined {
    if (emailDeliveryFor(kind) === 'none') return undefined
    return this.outboundEmail ? 'held' : 'skipped'
  }

  private async openBatch(record: NotificationRow, prefBatchMinutes: number): Promise<void> {
    const plan = planEmailDelivery(record.kind, prefBatchMinutes)
    if (plan.windowMinutes === 0) return
    const parsed = Date.parse(record.createdAt)
    const existing = await this.store.openBatch(record.workspaceId, record.principalId, plan.windowMinutes)
    const result = coalesceNotificationIntoBatch(existing, {
      batchId: existing?.batchId ?? deterministicNotificationId(record.notificationId, record.principalId, record.kind),
      workspaceId: record.workspaceId,
      principalId: record.principalId,
      at: Number.isFinite(parsed) ? parsed : this.now().getTime(),
      windowMinutes: plan.windowMinutes,
    })
    if (result.created) await this.store.saveBatch(result.batch)
  }
}