/**
 * W1-09 (#1506) — `notifications.*` command bindings (TECH-SPEC §4.11).
 *
 * The catalogue (W1-03 `commands/catalogue/notify.ts`) defines the three
 * commands with a placeholder schema. The notify module owns them, so it
 * binds the real payload schemas and the handlers here — the same shape as
 * `system.ping`: a structural schema in dependency-free `@rox/core` plus a zod
 * twin in `@rox/shared/notify/schemas` for untrusted input.
 *
 * The handlers run on the workspace authority and delegate to the host
 * (workspace-service `modules/notify`), which owns the store and the realtime
 * push. Without a host the commands stay unbound (`not_bound`, honest
 * capability discovery): the Electron main process has no notification store.
 */

import type { CommandHandlerContext, CommandRegistry, SchemaLike } from '../commands/registry.ts'
import { CommandRejection } from '../commands/errors.ts'
import type { NotificationChannel, NotificationKind, NotificationPrefRow } from './types.ts'
import type { NotificationPrefUpdate } from './prefs.ts'

export const NOTIFY_COMMAND_TYPES = [
  'notifications.mark_read',
  'notifications.mark_all_read',
  'notifications.update_prefs',
] as const

export type NotifyCommandType = (typeof NOTIFY_COMMAND_TYPES)[number]

/** Highest number of notifications one mark-read command may address. */
export const MAX_MARK_READ_IDS = 256
/** Highest number of pref rows one update may carry. */
export const MAX_PREF_UPDATES = 64

export interface NotificationsMarkReadPayload {
  ids: readonly string[]
}

export interface NotificationsMarkAllReadPayload {
  /** Optional kind filter: mark only that kind read (the Notifications tab chips). */
  kind?: NotificationKind
}

export interface NotificationsUpdatePrefsPayload {
  prefs: readonly NotificationPrefUpdate[]
}

export interface NotifyCommandResult {
  updated: number
  readAt?: string
  /** Pref rows as stored (empty for the read commands). */
  prefs?: readonly NotificationPrefRow[]
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

function idList(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_MARK_READ_IDS) return null
  const ids: string[] = []
  const seen = new Set<string>()
  for (const entry of value) {
    if (typeof entry !== 'string' || entry.length === 0 || entry.length > 256 || seen.has(entry)) return null
    seen.add(entry)
    ids.push(entry)
  }
  return ids
}

/** Structural strict schema; `@rox/shared/notify/schemas` has the zod twin. */
export const NOTIFICATIONS_MARK_READ_SCHEMA: SchemaLike<NotificationsMarkReadPayload> = {
  safeParse(value: unknown) {
    if (!isPlainObject(value)) return { success: false, error: new Error('notifications.mark_read payload must be an object') }
    if (Object.keys(value).some(key => key !== 'ids')) return { success: false, error: new Error('Unknown notifications.mark_read field') }
    const ids = idList(value.ids)
    if (!ids) return { success: false, error: new Error(`ids must be 1…${MAX_MARK_READ_IDS} unique non-empty strings`) }
    return { success: true, data: { ids } }
  },
}

export const NOTIFICATIONS_MARK_ALL_READ_SCHEMA: SchemaLike<NotificationsMarkAllReadPayload> = {
  safeParse(value: unknown) {
    if (!isPlainObject(value)) return { success: false, error: new Error('notifications.mark_all_read payload must be an object') }
    const keys = Object.keys(value)
    if (keys.some(key => key !== 'kind')) return { success: false, error: new Error('Unknown notifications.mark_all_read field') }
    const kind = value.kind
    if (kind !== undefined && typeof kind !== 'string') return { success: false, error: new Error('kind must be a notification kind') }
    return { success: true, data: kind === undefined ? {} : { kind: kind as NotificationKind } }
  },
}

export const NOTIFICATIONS_UPDATE_PREFS_SCHEMA: SchemaLike<NotificationsUpdatePrefsPayload> = {
  safeParse(value: unknown) {
    if (!isPlainObject(value)) return { success: false, error: new Error('notifications.update_prefs payload must be an object') }
    if (Object.keys(value).some(key => key !== 'prefs')) return { success: false, error: new Error('Unknown notifications.update_prefs field') }
    const rows = value.prefs
    if (!Array.isArray(rows) || rows.length === 0 || rows.length > MAX_PREF_UPDATES) {
      return { success: false, error: new Error(`prefs must be 1…${MAX_PREF_UPDATES} entries`) }
    }
    const prefs: NotificationPrefUpdate[] = []
    for (const row of rows) {
      if (!isPlainObject(row)) return { success: false, error: new Error('Each pref must be an object') }
      if (Object.keys(row).some(key => !['kind', 'enabled', 'channels', 'batchMinutes'].includes(key))) {
        return { success: false, error: new Error('Unknown notification pref field') }
      }
      if (typeof row.kind !== 'string' || row.kind.length === 0) return { success: false, error: new Error('pref.kind is required') }
      if (row.enabled !== undefined && typeof row.enabled !== 'boolean') return { success: false, error: new Error('pref.enabled must be a boolean') }
      if (row.channels !== undefined) {
        if (!Array.isArray(row.channels) || row.channels.some(channel => typeof channel !== 'string')) {
          return { success: false, error: new Error('pref.channels must be a list of channel names') }
        }
      }
      if (row.batchMinutes !== undefined && (typeof row.batchMinutes !== 'number' || !Number.isInteger(row.batchMinutes) || row.batchMinutes < 0 || row.batchMinutes > 1440)) {
        return { success: false, error: new Error('pref.batchMinutes must be an integer 0…1440') }
      }
      const update: NotificationPrefUpdate = { kind: row.kind as NotificationKind }
      if (row.enabled !== undefined) update.enabled = row.enabled
      if (row.channels !== undefined) update.channels = row.channels as readonly NotificationChannel[]
      if (row.batchMinutes !== undefined) update.batchMinutes = row.batchMinutes
      prefs.push(update)
    }
    return { success: true, data: { prefs } }
  },
}

// ---------------------------------------------------------------------------
// Host port
// ---------------------------------------------------------------------------

/**
 * Everything a notify handler needs from the host: who the actor is, which
 * workspace, the store transaction (Postgres handlers run inside the command
 * transaction) and the conflict escape hatch.
 */
export interface NotifyCommandContext {
  workspaceId: string
  principalId: string
  transaction?: unknown
  conflict(currentRevision: number, current?: unknown): never
}

export interface NotifyCommandHost {
  markRead(input: { ids: readonly string[]; context: NotifyCommandContext }): Promise<NotifyCommandResult>
  markAllRead(input: { kind?: NotificationKind; context: NotifyCommandContext }): Promise<NotifyCommandResult>
  updatePrefs(input: { updates: readonly NotificationPrefUpdate[]; context: NotifyCommandContext }): Promise<NotifyCommandResult>
}

let host: NotifyCommandHost | null = null

/** Install (or clear) the process-wide notify host. */
export function setNotifyCommandHost(next: NotifyCommandHost | null): void {
  host = next
}

export function getNotifyCommandHost(): NotifyCommandHost | null {
  return host
}

function contextOf(ctx: CommandHandlerContext): NotifyCommandContext {
  const context: NotifyCommandContext = {
    workspaceId: ctx.workspaceId,
    principalId: ctx.actor.principalId,
    conflict: (currentRevision, current) => ctx.conflict(currentRevision, current),
  }
  if (ctx.transaction !== undefined) context.transaction = ctx.transaction
  return context
}

function requireHost(): NotifyCommandHost {
  const current = getNotifyCommandHost()
  if (!current) throw new CommandRejection('NOT_BOUND', 'Notification store is not available in this process')
  return current
}

/**
 * Bind the `notifications.*` handlers and payload schemas. Idempotent; binds
 * nothing while no host is installed, so the commands stay `not_bound` instead
 * of advertising a capability that would always fail.
 */
export function bindNotifyCommands(registry: CommandRegistry): void {
  if (!getNotifyCommandHost()) return
  registry.bindSchema('notifications.mark_read', NOTIFICATIONS_MARK_READ_SCHEMA, { riskClass: () => 'routine' })
  registry.bindSchema('notifications.mark_all_read', NOTIFICATIONS_MARK_ALL_READ_SCHEMA, { riskClass: () => 'routine' })
  registry.bindSchema('notifications.update_prefs', NOTIFICATIONS_UPDATE_PREFS_SCHEMA, { riskClass: () => 'routine' })
  if (!registry.handler('notifications.mark_read')) {
    registry.bind<NotificationsMarkReadPayload, NotifyCommandResult>('notifications.mark_read', async ctx => ({
      result: await requireHost().markRead({ ids: ctx.payload.ids, context: contextOf(ctx) }),
    }))
  }
  if (!registry.handler('notifications.mark_all_read')) {
    registry.bind<NotificationsMarkAllReadPayload, NotifyCommandResult>('notifications.mark_all_read', async ctx => ({
      result: await requireHost().markAllRead({ ...(ctx.payload.kind ? { kind: ctx.payload.kind } : {}), context: contextOf(ctx) }),
    }))
  }
  if (!registry.handler('notifications.update_prefs')) {
    registry.bind<NotificationsUpdatePrefsPayload, NotifyCommandResult>('notifications.update_prefs', async ctx => ({
      result: await requireHost().updatePrefs({ updates: ctx.payload.prefs, context: contextOf(ctx) }),
    }))
  }
}