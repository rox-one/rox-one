/**
 * W1-09 (#1506) — `notification_pref` resolution (DATA-MODEL §9.2, 506-notify.sql).
 *
 * A pref row is `(workspace, principal, kind) → { enabled, channels,
 * batch_minutes }`. Absence means "use the kind's defaults": every delivery
 * channel the kind table lists, except instant email, which is opt-in
 * ("instant email (if enabled)", DATA-MODEL §9.2).
 *
 * `enabled: false` is the mute: the fan-out writes no notification row at all.
 */

import {
  DEFAULT_EMAIL_BATCH_WINDOW_MINUTES,
  NOTIFICATION_CHANNELS,
  notificationKindDescriptor,
  type NotificationChannel,
  type NotificationKind,
  type NotificationPrefRow,
} from './types.ts'

const CHANNEL_FLAGS: Readonly<Record<string, true>> = Object.fromEntries(
  NOTIFICATION_CHANNELS.map(channel => [channel, true]),
)

export function isNotificationChannelList(value: unknown): value is readonly NotificationChannel[] {
  return Array.isArray(value) && value.every(channel => typeof channel === 'string' && CHANNEL_FLAGS[channel] === true)
}

/** Default channels for a kind: the kind table minus opt-in instant email. */
export function defaultChannelsFor(kind: NotificationKind): readonly NotificationChannel[] {
  return notificationKindDescriptor(kind).channels.filter(channel => channel !== 'email_instant')
}

export function notificationPrefKey(principalId: string, kind: NotificationKind): string {
  return `${principalId}\u0000${kind}`
}

export interface ResolvedNotificationPref {
  enabled: boolean
  channels: readonly NotificationChannel[]
  batchMinutes: number
  /** The stored row, when the principal customised this kind. */
  row?: NotificationPrefRow
}

/** Index pref rows for lookup (`notificationPrefKey`). */
export function indexNotificationPrefs(rows: readonly NotificationPrefRow[]): Readonly<Record<string, NotificationPrefRow | undefined>> {
  const index: Record<string, NotificationPrefRow | undefined> = {}
  for (const row of rows) index[notificationPrefKey(row.principalId, row.kind)] = row
  return index
}

export function resolveNotificationPref(
  index: Readonly<Record<string, NotificationPrefRow | undefined>>,
  principalId: string,
  kind: NotificationKind,
): ResolvedNotificationPref {
  const row = index[notificationPrefKey(principalId, kind)]
  if (!row) return { enabled: true, channels: defaultChannelsFor(kind), batchMinutes: DEFAULT_EMAIL_BATCH_WINDOW_MINUTES }
  return {
    enabled: row.enabled,
    channels: row.enabled ? row.channels : [],
    batchMinutes: row.batchMinutes,
    row,
  }
}

/** Muted principals for one kind — excluded from the audience before fan-out. */
export function mutedPrincipalsFor(
  index: Readonly<Record<string, NotificationPrefRow | undefined>>,
  principalIds: readonly string[],
  kind: NotificationKind,
): string[] {
  return principalIds.filter(principalId => !resolveNotificationPref(index, principalId, kind).enabled)
}

export interface NotificationPrefUpdate {
  kind: NotificationKind
  enabled?: boolean
  channels?: readonly NotificationChannel[]
  batchMinutes?: number
}

export interface NotificationPrefDefaults {
  workspaceId: string
  principalId: string
  now: string
}

/** Pure upsert: the new row for an update, based on the current one (or the defaults). */
export function applyNotificationPrefUpdate(
  current: NotificationPrefRow | undefined,
  update: NotificationPrefUpdate,
  defaults: NotificationPrefDefaults,
): NotificationPrefRow {
  const base: NotificationPrefRow = current ?? {
    workspaceId: defaults.workspaceId,
    principalId: defaults.principalId,
    kind: update.kind,
    enabled: true,
    channels: defaultChannelsFor(update.kind),
    batchMinutes: DEFAULT_EMAIL_BATCH_WINDOW_MINUTES,
    createdAt: defaults.now,
    updatedAt: defaults.now,
  }
  return {
    ...base,
    enabled: update.enabled ?? base.enabled,
    channels: update.channels ?? base.channels,
    batchMinutes: update.batchMinutes ?? base.batchMinutes,
    updatedAt: defaults.now,
  }
}