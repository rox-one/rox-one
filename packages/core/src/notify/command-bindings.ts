/**
 * W1-09 (#1506) — `notifications.*` command bindings (TECH-SPEC §4.11).
 *
 * The catalogue (W1-03 `commands/catalogue/notify.ts`) defines the three
 * commands with a placeholder schema. The notify module owns them, so it
 * binds the real payload schemas and the handlers here — the same shape as
 * `system.ping`: a structural schema in dependency-free `@rox/core` plus a zod
 * twin in `@rox/shared/notify/schemas` for untrusted input.
 *
 * PAYLOAD CONTRACT — `packages/shared/src/domain/notify/schema.ts`
 * (`NOTIFY_COMMAND_SCHEMAS`; TECH-SPEC §4.14 / DATA-MODEL §5.13) is the source
 * of truth for what these three commands accept. The domain module binds it
 * (`DOMAIN_SCHEMA_COMMAND_MODULE` → `bindDomainSchemas`), but a notify-host
 * process binds this module *after* it (last-wins: `COMMAND_MODULES` in
 * `server-core/src/commands/registry.ts`), so this structural schema is what
 * the workspace service really validates with. It re-issues the domain
 * contract by hand because `@rox/core` is dependency-free by contract and may
 * not import `@rox/shared` (which in turn imports `@rox/core/notify`).
 *
 * That hand copy is exactly what drifted: the gateway used to reject the
 * documented `{ notificationIds }` payload with `Unknown notifications.mark_read
 * field`. The mirrored field names now live in `NOTIFY_DOMAIN_FIELDS`, and
 * `packages/server-core/src/work/__tests__/notify-contract-drift.test.ts`
 * compares that list with the domain zod schema — adding a field to the domain
 * schema without adding it here fails CI instead of silently rejecting the
 * documented payload.
 *
 * The legacy, non-domain spellings this gateway accepted before it followed the
 * contract (`{ ids }`, `{ kind }`, `{ prefs: [{ kind, … }] }`) stay accepted so
 * existing callers keep working; the canonical spelling is preferred. Each
 * schema documents which is which.
 *
 * The handlers run on the workspace authority and delegate to the host
 * (workspace-service `modules/notify`), which owns the store and the realtime
 * push. Without a host the commands stay unbound (`not_bound`, honest
 * capability discovery): the Electron main process has no notification store.
 */

import type { CommandHandlerContext, CommandRegistry, SchemaLike } from '../commands/registry.ts'
import { CommandRejection } from '../commands/errors.ts'
import { isNotificationChannel, isNotificationKind, type NotificationKind, type NotificationPrefRow } from './types.ts'
import type { NotificationPrefUpdate } from './prefs.ts'

export const NOTIFY_COMMAND_TYPES = [
  'notifications.mark_read',
  'notifications.mark_all_read',
  'notifications.update_prefs',
] as const

export type NotifyCommandType = (typeof NOTIFY_COMMAND_TYPES)[number]

/**
 * Canonical top-level payload fields per command, mirrored from
 * `packages/shared/src/domain/notify/schema.ts` (the source of truth).
 * `work/__tests__/notify-contract-drift.test.ts` compares this with the domain
 * zod schema's `shape`, so a field added there and forgotten here fails CI.
 */
export const NOTIFY_DOMAIN_FIELDS: Readonly<Record<NotifyCommandType, readonly string[]>> = {
  'notifications.mark_read': ['notificationIds'],
  'notifications.mark_all_read': ['before'],
  'notifications.update_prefs': ['prefs', 'quietHours'],
}

/**
 * Highest number of notifications one mark-read command may address.
 *
 * The domain number wins: the contract is
 * `z.array(idSchema).min(1).max(500)`, and a payload the documented schema
 * accepts must not be rejected here — that mismatch was the bug. 256 was a
 * divergent re-implementation. The notify HTTP/zod twin
 * (`@rox/shared/notify/schemas.ts`) reads this constant, so both boundaries
 * move together. The domain schema lets ids repeat; this gateway collapses
 * duplicates instead of rejecting them (marking one row read twice is
 * idempotent), while the legacy `{ ids }` spelling keeps rejecting duplicates
 * so its zod twin keeps agreeing with it.
 */
export const MAX_MARK_READ_IDS = 500
/**
 * Highest number of pref rows one update may carry — same reconciliation as
 * `MAX_MARK_READ_IDS`: the domain contract is `.min(1).max(500)`, so 500 wins
 * over the old 64 (a smaller gateway bound would reject documented payloads).
 */
export const MAX_PREF_UPDATES = 500

/** Canonical `notifications.update_prefs` channel (`notificationChannelSchema`). */
export type DomainNotificationChannel = 'in_app' | 'email' | 'push' | 'desktop'

/** Canonical `notifications.update_prefs` row (DATA-MODEL §5.13 `notification_pref`). */
export interface DomainNotificationPrefUpdate {
  eventType: string
  channel: DomainNotificationChannel
  enabled: boolean
}

/** Canonical quiet-hours window (`{ start, end }` as `HH:MM`). */
export interface DomainQuietHours {
  start: string
  end: string
}

export interface NotificationsMarkReadPayload {
  /** Canonical `notificationIds`, normalised onto the host port's `ids`. */
  ids: readonly string[]
}

export interface NotificationsMarkAllReadPayload {
  /** Legacy kind filter: mark only that kind read (the Notifications tab chips). */
  kind?: NotificationKind
  /** Canonical `before`: the read marker's cut-off instant. */
  before?: string
}

export interface NotificationsUpdatePrefsPayload {
  /**
   * `NotificationPrefUpdate` rows (the `notification_pref` model — `kind`,
   * `channels`, `batchMinutes`) or canonical domain rows
   * (`{ eventType, channel, enabled }`). See `prefUpdatesForHost`.
   */
  prefs: readonly (NotificationPrefUpdate | DomainNotificationPrefUpdate)[]
  /** Canonical quiet-hours window (`null` clears it). */
  quietHours?: DomainQuietHours | null
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

function failure(message: string): { success: false; error: Error } {
  return { success: false, error: new Error(message) }
}

/** Mirrors `idSchema` (`packages/shared/src/domain/common.ts`). */
// eslint-disable-next-line no-control-regex -- intentionally rejects C0 controls and DEL in domain ids
const DOMAIN_ID_CONTROL_RE = /[\u0000-\u001f\u007f]/
function isDomainId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 256 && !DOMAIN_ID_CONTROL_RE.test(value)
}

/** Legacy `{ ids }`: 1…MAX unique non-empty strings — the `@rox/shared/notify/schemas` twin's rule. */
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

/** Canonical `notificationIds`: the domain `z.array(idSchema).min(1).max(500)`, duplicates collapsed. */
function canonicalIdList(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_MARK_READ_IDS) return null
  const ids: string[] = []
  const seen = new Set<string>()
  for (const entry of value) {
    if (!isDomainId(entry)) return null
    if (seen.has(entry)) continue
    seen.add(entry)
    ids.push(entry)
  }
  return ids
}

/** Mirrors `isoDateTimeSchema` (`z.iso.datetime({ offset: true })`). */
const ISO_DATE_TIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/
function isIsoDateTime(value: unknown): value is string {
  return typeof value === 'string' && ISO_DATE_TIME_RE.test(value) && !Number.isNaN(Date.parse(value))
}

/** Mirrors `notificationChannelSchema` (`packages/shared/src/domain/notify/schema.ts`). */
const DOMAIN_NOTIFICATION_CHANNELS: Readonly<Record<string, true>> = { in_app: true, email: true, push: true, desktop: true }
function isDomainNotificationChannel(value: unknown): value is DomainNotificationChannel {
  return typeof value === 'string' && DOMAIN_NOTIFICATION_CHANNELS[value] === true
}

/** `quietHours.start` / `.end` (`HH:MM`). */
const QUIET_HOURS_RE = /^\d{2}:\d{2}$/

/** Legacy pref row: the `notification_pref` model (`kind`, `channels`, `batchMinutes`). */
function legacyPrefRow(row: Record<string, unknown>): NotificationPrefUpdate | string {
  if (Object.keys(row).some(key => !['kind', 'enabled', 'channels', 'batchMinutes'].includes(key))) return 'Unknown notification pref field'
  if (!isNotificationKind(row.kind)) return 'pref.kind must be a notification kind'
  if (row.enabled !== undefined && typeof row.enabled !== 'boolean') return 'pref.enabled must be a boolean'
  if (row.channels !== undefined) {
    if (!Array.isArray(row.channels) || row.channels.some(channel => !isNotificationChannel(channel))) {
      return 'pref.channels must be a list of known channel names'
    }
  }
  if (row.batchMinutes !== undefined && (typeof row.batchMinutes !== 'number' || !Number.isInteger(row.batchMinutes) || row.batchMinutes < 0 || row.batchMinutes > 1440)) {
    return 'pref.batchMinutes must be an integer 0…1440'
  }
  const update: NotificationPrefUpdate = { kind: row.kind }
  if (row.enabled !== undefined) update.enabled = row.enabled
  if (row.channels !== undefined) update.channels = row.channels
  if (row.batchMinutes !== undefined) update.batchMinutes = row.batchMinutes
  return update
}

/** Canonical row: `{ eventType, channel, enabled }` — DATA-MODEL §5.13, exactly as the domain schema. */
function domainPrefRow(row: Record<string, unknown>): DomainNotificationPrefUpdate | string {
  if (Object.keys(row).some(key => !['eventType', 'channel', 'enabled'].includes(key))) return 'Unknown notification pref field'
  if (typeof row.eventType !== 'string' || row.eventType.length === 0 || row.eventType.length > 128) return 'pref.eventType must be 1…128 characters'
  if (!isDomainNotificationChannel(row.channel)) return 'pref.channel must be in_app, email, push or desktop'
  if (typeof row.enabled !== 'boolean') return 'pref.enabled must be a boolean'
  return { eventType: row.eventType, channel: row.channel, enabled: row.enabled }
}

/**
 * Structural strict schema; `@rox/shared/notify/schemas` has the zod twin.
 *
 * Accepts the canonical `{ notificationIds }` (`NOTIFY_DOMAIN_FIELDS`) and the
 * legacy `{ ids }`, normalising both onto the host port's `{ ids }`.
 */
export const NOTIFICATIONS_MARK_READ_SCHEMA: SchemaLike<NotificationsMarkReadPayload> = {
  safeParse(value: unknown) {
    if (!isPlainObject(value)) return failure('notifications.mark_read payload must be an object')
    if (Object.keys(value).some(key => key !== 'notificationIds' && key !== 'ids')) return failure('Unknown notifications.mark_read field')
    const canonical = 'notificationIds' in value
    if (canonical && 'ids' in value) return failure('notifications.mark_read takes notificationIds (canonical) or ids (legacy), not both')
    const ids = canonical ? canonicalIdList(value.notificationIds) : idList(value.ids)
    if (!ids) return failure(`ids must be 1…${MAX_MARK_READ_IDS} non-empty strings`)
    return { success: true, data: { ids } }
  },
}

/**
 * Structural strict schema; `@rox/shared/notify/schemas` has the zod twin.
 *
 * Both filters are served because they are genuinely different cuts and
 * neither may be dropped silently: `before` is the canonical
 * `notifications.mark_all_read` payload, `kind` is the legacy chip filter the
 * Notifications tab and the workspace-service host use (callers that depend on
 * it: `apps/workspace-service/test/notify.test.ts` "mark_all_read with a kind
 * only touches that kind", `apps/workspace-service/src/modules/notify/service.ts`
 * `markAllRead({ kind, context })`, `review-renderers.test.ts`).
 */
export const NOTIFICATIONS_MARK_ALL_READ_SCHEMA: SchemaLike<NotificationsMarkAllReadPayload> = {
  safeParse(value: unknown) {
    if (!isPlainObject(value)) return failure('notifications.mark_all_read payload must be an object')
    if (Object.keys(value).some(key => key !== 'kind' && key !== 'before')) return failure('Unknown notifications.mark_all_read field')
    const data: NotificationsMarkAllReadPayload = {}
    if (value.kind !== undefined) {
      if (!isNotificationKind(value.kind)) return failure('kind must be a notification kind')
      data.kind = value.kind
    }
    if (value.before !== undefined) {
      if (!isIsoDateTime(value.before)) return failure('before must be an ISO-8601 instant')
      data.before = value.before
    }
    return { success: true, data }
  },
}

/**
 * Structural strict schema; `@rox/shared/notify/schemas` has the zod twin.
 *
 * Top level is the domain shape (`{ prefs, quietHours? }`). A row is either the
 * canonical domain row (`{ eventType, channel, enabled }`) or the legacy
 * `NotificationPrefUpdate` (`kind` + `enabled` / `channels` / `batchMinutes`).
 * The two are different axes and are NOT translated into each other — see
 * `prefUpdatesForHost`.
 */
export const NOTIFICATIONS_UPDATE_PREFS_SCHEMA: SchemaLike<NotificationsUpdatePrefsPayload> = {
  safeParse(value: unknown) {
    if (!isPlainObject(value)) return failure('notifications.update_prefs payload must be an object')
    if (Object.keys(value).some(key => key !== 'prefs' && key !== 'quietHours')) return failure('Unknown notifications.update_prefs field')
    const rows = value.prefs
    if (!Array.isArray(rows) || rows.length === 0 || rows.length > MAX_PREF_UPDATES) {
      return failure(`prefs must be 1…${MAX_PREF_UPDATES} entries`)
    }
    const prefs: Array<NotificationPrefUpdate | DomainNotificationPrefUpdate> = []
    for (const row of rows) {
      if (!isPlainObject(row)) return failure('Each pref must be an object')
      const parsed = 'eventType' in row ? domainPrefRow(row) : legacyPrefRow(row)
      if (typeof parsed === 'string') return failure(parsed)
      prefs.push(parsed)
    }
    let quietHours: DomainQuietHours | null | undefined
    if (value.quietHours !== undefined) {
      if (value.quietHours === null) quietHours = null
      else {
        if (!isPlainObject(value.quietHours)) return failure('quietHours must be an object or null')
        if (Object.keys(value.quietHours).some(key => key !== 'start' && key !== 'end')) return failure('Unknown notification quiet-hours field')
        const { start, end } = value.quietHours
        if (typeof start !== 'string' || typeof end !== 'string' || !QUIET_HOURS_RE.test(start) || !QUIET_HOURS_RE.test(end)) {
          return failure('quietHours.start and quietHours.end must be HH:MM')
        }
        quietHours = { start, end }
      }
    }
    const data: NotificationsUpdatePrefsPayload = { prefs }
    if (quietHours !== undefined) data.quietHours = quietHours
    return { success: true, data }
  },
}

/**
 * The ONE place a validated `notifications.update_prefs` payload meets the host
 * port's `NotificationPrefUpdate` shape.
 *
 * The canonical row is `{ eventType, channel, enabled }` (DATA-MODEL §5.13), the
 * port takes `{ kind, channels, batchMinutes }` (the shipped `506-notify.sql`
 * `notification_pref`). `eventType` is a domain *event* type — many have no
 * notification trigger at all (`./triggers.ts` does not map `task.task_adding`)
 * — and `channel` is one of `in_app|email|push|desktop`, while `kind` is one of
 * the 28 notification kinds and `channels` one of the nine
 * `notification_pref.channels` values. No lossless translation exists, so this
 * does NOT invent one: legacy rows pass through unchanged, and a canonical row
 * has no counterpart on the port, so it is not forwarded (`updated` then counts
 * only what the host really wrote). `quietHours` has no port field either.
 * Making canonical rows effective is a store/port change in the workspace-service
 * notify module — not a translation this gateway may fabricate.
 */
function prefUpdatesForHost(payload: NotificationsUpdatePrefsPayload): readonly NotificationPrefUpdate[] {
  return payload.prefs.filter((row): row is NotificationPrefUpdate => !('eventType' in row))
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
  /**
   * `kind` is the legacy chip filter, `before` the canonical
   * `notifications.mark_all_read` cut-off (`@rox/shared/domain/notify/schema.ts`).
   * Both are optional and independent; a host that cannot honour `before` must
   * reject rather than silently mark everything read.
   */
  markAllRead(input: { kind?: NotificationKind; before?: string; context: NotifyCommandContext }): Promise<NotifyCommandResult>
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
      result: await requireHost().markAllRead({
        ...(ctx.payload.kind ? { kind: ctx.payload.kind } : {}),
        ...(ctx.payload.before ? { before: ctx.payload.before } : {}),
        context: contextOf(ctx),
      }),
    }))
  }
  if (!registry.handler('notifications.update_prefs')) {
    registry.bind<NotificationsUpdatePrefsPayload, NotifyCommandResult>('notifications.update_prefs', async ctx => ({
      result: await requireHost().updatePrefs({ updates: prefUpdatesForHost(ctx.payload), context: contextOf(ctx) }),
    }))
  }
}