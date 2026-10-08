/**
 * W1-09 (#1506) — The notify application service.
 *
 * One object owns the fan-out, the preferences, mark-read and the `user:{id}`
 * push. The notify HTTP routes call it directly, and `notifyCommandHost` wraps
 * it for the `notifications.*` commands, so both transports run exactly the
 * same code.
 *
 * Reading is always scoped to the authenticated principal: `user:{id}` is the
 * only topic a notification is pushed to, and mark-read ignores ids that
 * belong to somebody else.
 */

import type { AuthenticatedActor } from '../../../../../packages/shared/src/workspace-domain/identity/contracts.ts'
import type { Authorizer } from '../../../../../packages/core/src/commands/index.ts'
import type { DomainEvent } from '../../../../../packages/core/src/events/index.ts'
import {
  applyNotificationPrefUpdate,
  indexNotificationPrefs,
  isNotificationChannelList,
  isNotificationKind,
  notificationPrefKey,
  type NotificationKind,
  type NotificationPrefRow,
  type NotificationRow,
  type NotifyCommandHost,
  type NotificationPrefUpdate,
} from '../../../../../packages/core/src/notify/index.ts'
import { NotificationFanout, type NotifyPush } from './fanout.ts'
import { NotifyEmailWorker, type NotificationEmailTransport } from './email-worker.ts'
import { InMemoryNotificationStore, type NotificationPageOptions, type NotificationStore } from './store.ts'
import type { AudienceReader } from './audience-adapter.ts'

export interface NotifyServiceOptions {
  /** Defaults to the in-memory repository (STUB(#1502): the Postgres one lands with the DDL). */
  store?: NotificationStore
  /** W1-04 (#1501) ACL. Required: the fan-out must not notify someone who cannot read the subject. */
  authorizer: Authorizer
  audience?: AudienceReader
  push?: NotifyPush
  outboundEmail?: boolean
  transport?: NotificationEmailTransport | null
  now?: () => Date
}

export interface NotificationListResult {
  notifications: readonly NotificationRow[]
  nextCursor?: string
  unread: number
}

export interface NotificationReadResult {
  updated: number
  readAt: string
  unread: number
}

export interface NotificationPrefsResult {
  updated: number
  prefs: readonly NotificationPrefRow[]
}

/** Read push payload (`notification.read` on `user:{id}`). */
export interface NotificationReadPush {
  ids?: readonly string[]
  all?: true
  kind?: NotificationKind
  readAt: string
  unread: number
}

export class NotifyService {
  readonly store: NotificationStore
  readonly fanout: NotificationFanout
  readonly worker: NotifyEmailWorker
  private readonly push: NotifyPush | undefined
  private readonly now: () => Date

  constructor(options: NotifyServiceOptions) {
    this.now = options.now ?? (() => new Date())
    this.push = options.push
    this.store = options.store ?? new InMemoryNotificationStore()
    this.fanout = new NotificationFanout({
      store: this.store,
      authorizer: options.authorizer,
      ...(options.audience ? { audience: options.audience } : {}),
      ...(options.push ? { push: options.push } : {}),
      outboundEmail: options.outboundEmail ?? false,
      now: this.now,
    })
    this.worker = new NotifyEmailWorker({
      store: this.store,
      transport: options.transport ?? null,
      now: this.now,
    })
  }

  /** Relay sink: committed domain events → notifications (DATA-MODEL §9.2). */
  ingest(events: readonly DomainEvent[]) {
    return this.fanout.ingest(events)
  }

  async list(workspaceId: string, principalId: string, options: NotificationPageOptions): Promise<NotificationListResult> {
    const { notifications, nextCursor } = await this.store.list(workspaceId, principalId, options)
    const unread = await this.store.unreadCount(workspaceId, principalId)
    return { notifications, ...(nextCursor ? { nextCursor } : {}), unread }
  }

  /** Mark rows read. Returns how many changed; unknown / foreign ids are ignored. */
  async markRead(workspaceId: string, principalId: string, ids: readonly string[], readAt = this.now().toISOString()): Promise<NotificationReadResult> {
    const changed = await this.store.markRead(workspaceId, principalId, ids, readAt)
    const unread = await this.store.unreadCount(workspaceId, principalId)
    if (changed.length > 0) this.publish(principalId, { ids: changed, readAt, unread })
    return { updated: changed.length, readAt, unread }
  }

  async markAllRead(workspaceId: string, principalId: string, kind: NotificationKind | undefined, readAt = this.now().toISOString()): Promise<NotificationReadResult> {
    const changed = await this.store.markAllRead(workspaceId, principalId, kind, readAt)
    const unread = await this.store.unreadCount(workspaceId, principalId)
    if (changed.length > 0) this.publish(principalId, { all: true, ...(kind ? { kind } : {}), readAt, unread })
    return { updated: changed.length, readAt, unread }
  }

  /** Upsert `notification_pref` rows; unknown kinds and channels are dropped, never stored. */
  async updatePrefs(workspaceId: string, principalId: string, updates: readonly NotificationPrefUpdate[]): Promise<NotificationPrefsResult> {
    const index = indexNotificationPrefs(await this.store.prefs(workspaceId, principalId))
    const now = this.now().toISOString()
    const saved: NotificationPrefRow[] = []
    for (const update of updates) {
      if (!isNotificationKind(update.kind)) continue
      if (update.channels !== undefined && !isNotificationChannelList(update.channels)) continue
      const current = index[notificationPrefKey(principalId, update.kind)]
      saved.push(applyNotificationPrefUpdate(current, update, { workspaceId: current?.workspaceId ?? workspaceId, principalId, now }))
    }
    if (saved.length > 0) await this.store.savePrefs(saved)
    return { updated: saved.length, prefs: saved }
  }

  private publish(principalId: string, payload: NotificationReadPush): void {
    this.push?.(principalId, [{ topic: `user:${principalId}`, type: 'notification.read', payload }])
  }
}

/** The `notifications.*` command host over a notify service (workspace-scoped by the envelope). */
export function createNotifyServiceHost(service: NotifyService): NotifyCommandHost {
  return {
    markRead: async ({ ids, context }) => {
      const result = await service.markRead(context.workspaceId, context.principalId, ids)
      return { updated: result.updated, readAt: result.readAt }
    },
    markAllRead: async ({ kind, context }) => {
      const result = await service.markAllRead(context.workspaceId, context.principalId, kind)
      return { updated: result.updated, readAt: result.readAt }
    },
    updatePrefs: async ({ updates, context }) => {
      const result = await service.updatePrefs(context.workspaceId, context.principalId, updates)
      return { updated: result.updated, prefs: result.prefs }
    },
  }
}

/** The HTTP authority over a notify service. Always scoped to the calling principal. */
export function notifyHttpAuthority(service: NotifyService): WorkspaceNotifyHttpAuthority {
  return {
    list: (actor, workspaceId, options) => service.list(workspaceId, actor.principalId, options),
    markRead: (actor, workspaceId, ids) => service.markRead(workspaceId, actor.principalId, ids),
    markAllRead: (actor, workspaceId, kind) => service.markAllRead(workspaceId, actor.principalId, kind as NotificationKind | undefined),
  }
}

/** The authority behind `GET /notifications` and `POST /notifications/read`. */
export interface WorkspaceNotifyHttpAuthority {
  list(actor: AuthenticatedActor, workspaceId: string, options: NotificationPageOptions): Promise<NotificationListResult>
  markRead(actor: AuthenticatedActor, workspaceId: string, ids: readonly string[]): Promise<NotificationReadResult>
  markAllRead(actor: AuthenticatedActor, workspaceId: string, kind?: string): Promise<NotificationReadResult>
}