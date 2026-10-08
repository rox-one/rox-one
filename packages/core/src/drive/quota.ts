/**
 * W1-14 (#1511) — Drive quota contract (TECH-SPEC §16.3, DATA-MODEL §5.15,
 * PRD ADR-U17 / D-v2-8).
 *
 * One personal Drive per account, 1 TiB by default, maintained from a storage
 * ledger. The arithmetic is deliberately boring and lives here once:
 *
 * - **admission**: `used + reserved + size ≤ quota`, else
 *   `QUOTA_EXCEEDED {used, limit, needed}`;
 * - **versions and trash count**: every stored version is charged, and a
 *   trashed file keeps its bytes until it is purged;
 * - **shared files count only against the owner** (Google Drive semantics), so
 *   a chat attachment is charged to the **uploader** and a meeting recording to
 *   the **organiser**;
 * - `over_quota` blocks new uploads but never reads or deletes (§16.3).
 */

/** 1 TiB in bytes. The DDL default and the number shown as «1 ТБ» in RU. */
export const TIB_BYTES = 1_099_511_627_776

export const GIB_BYTES = 1_073_741_824
export const MIB_BYTES = 1_048_576

/** `drive.quota_bytes` default by workspace setting (§16.3 `default_drive_quota`). */
export const DEFAULT_DRIVE_QUOTA_BYTES = TIB_BYTES

/** `drive.state` (`16-drive-quota.sql`). */
export const DRIVE_STATES = ['active', 'over_quota', 'frozen'] as const
export type DriveState = (typeof DRIVE_STATES)[number]

/** Notification thresholds (§16.3): one `quota_warning` per threshold per 7 days. */
export const QUOTA_NOTIFICATION_THRESHOLDS = [80, 90, 100] as const

/** Quota-warning notifications are silenced for 7 days per threshold. */
export const QUOTA_WARNING_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000

/** The storage page meter turns amber at 80% and red at 95% (UI-SPEC §20.7). */
export const QUOTA_METER_WARNING_PERCENT = 80
export const QUOTA_METER_CRITICAL_PERCENT = 95

/** The quota counters of one `drive` row. */
export interface DriveQuota {
  quotaBytes: number
  /** Σ `storage_ledger.delta_bytes`. */
  usedBytes: number
  /** Bytes held by open upload sessions; not yet `used`, but not free either. */
  reservedBytes: number
  /** Bytes of trashed files; already inside `usedBytes`, shown separately. */
  trashBytes: number
  state: DriveState
}

export interface QuotaUsage {
  used: number
  reserved: number
  trash: number
  limit: number
  /** `limit - used - reserved`: what another upload may still reserve. */
  free: number
  percent: number
  severity: 'ok' | 'warning' | 'critical'
  state: DriveState
}

/** `{used, limit, needed, free}` — the detail of a `QUOTA_EXCEEDED` rejection. */
export interface QuotaExceededDetail {
  used: number
  limit: number
  /** Bytes the rejected operation asked for. */
  needed: number
  /** `limit - used - reserved` at rejection time. */
  free: number
}

/**
 * The counters after a ledger entry (or a reservation move). `used` never goes
 * below zero; a purge of an already-purged file is a no-op, not a credit.
 */
export function quotaSnapshot(quota: Pick<DriveQuota, 'quotaBytes' | 'usedBytes' | 'reservedBytes' | 'trashBytes' | 'state'>): QuotaUsage {
  const used = Math.max(0, quota.usedBytes)
  const reserved = Math.max(0, quota.reservedBytes)
  const limit = Math.max(0, quota.quotaBytes)
  const free = Math.max(0, limit - used - reserved)
  const percent = limit === 0 ? 100 : Math.min(100, Math.round(((used + reserved) / limit) * 1000) / 10)
  const severity = percent >= QUOTA_METER_CRITICAL_PERCENT ? 'critical' : percent >= QUOTA_METER_WARNING_PERCENT ? 'warning' : 'ok'
  return { used, reserved, trash: Math.max(0, quota.trashBytes), limit, free, percent, severity, state: quota.state }
}

export type QuotaAdmission = { ok: true; reservedBytes: number } | { ok: false; error: 'QUOTA_EXCEEDED'; detail: QuotaExceededDetail }

/**
 * Admission for one upload of `size` bytes (§16.3): the reservation is taken
 * at `open_upload`, so two concurrent uploads cannot both fit in the last
 * free byte.
 */
export function admitUpload(quota: Pick<DriveQuota, 'quotaBytes' | 'usedBytes' | 'reservedBytes' | 'state'>, size: number): QuotaAdmission {
  const usage = quotaSnapshot({ ...quota, trashBytes: 0 })
  if (quota.state !== 'active') {
    return { ok: false, error: 'QUOTA_EXCEEDED', detail: { used: usage.used, limit: usage.limit, needed: size, free: usage.free } }
  }
  if (!Number.isFinite(size) || size < 0 || usage.used + usage.reserved + size > usage.limit) {
    return { ok: false, error: 'QUOTA_EXCEEDED', detail: { used: usage.used, limit: usage.limit, needed: size, free: usage.free } }
  }
  return { ok: true, reservedBytes: usage.reserved + size }
}

/** `drive.state` follows the counters: over the limit blocks new uploads. */
export function driveStateFor(used: number, limit: number, current: DriveState): DriveState {
  if (current === 'frozen') return 'frozen'
  return used > limit ? 'over_quota' : 'active'
}

/** `reserved_bytes` after a release (abort, expiry, completion): never negative. */
export function creditReservation(reservedBytes: number, releasedBytes: number): number {
  return Math.max(0, reservedBytes - Math.max(0, releasedBytes))
}

/** The thresholds crossed by this percentage, in ascending order. */
export function crossedQuotaThresholds(percent: number): number[] {
  return QUOTA_NOTIFICATION_THRESHOLDS.filter(threshold => percent >= threshold)
}

/** One `quota_warning` per threshold per 7 days (§16.3). */
export function quotaWarningAllowed(lastSentAt: number | null, now: number): boolean {
  return lastSentAt === null || now - lastSentAt >= QUOTA_WARNING_COOLDOWN_MS
}

/**
 * Unit labels per locale. RU is the default UI language, and D-v2-8 fixes its
 * spelling («1 ТБ»); the others follow the common local convention (fr uses
 * octets, ru uses Б/КБ, everyone else the SI-style B/KB).
 */
const SIZE_UNITS: Readonly<Record<string, readonly [string, string, string, string, string]>> = {
  ar: ['B', 'KB', 'MB', 'GB', 'TB'],
  de: ['B', 'KB', 'MB', 'GB', 'TB'],
  en: ['B', 'KB', 'MB', 'GB', 'TB'],
  es: ['B', 'KB', 'MB', 'GB', 'TB'],
  fr: ['o', 'Ko', 'Mo', 'Go', 'To'],
  hu: ['B', 'KB', 'MB', 'GB', 'TB'],
  ja: ['B', 'KB', 'MB', 'GB', 'TB'],
  ko: ['B', 'KB', 'MB', 'GB', 'TB'],
  pl: ['B', 'KB', 'MB', 'GB', 'TB'],
  ru: ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ'],
  'zh-Hans': ['B', 'KB', 'MB', 'GB', 'TB'],
  'zh-Hant': ['B', 'KB', 'MB', 'GB', 'TB'],
}

/** Default UI language of the product. */
export const DEFAULT_SIZE_LOCALE = 'ru'

/**
 * A byte count as a human string: `1 ТБ` (ru), `1 TB` (en), `512 МБ` (ru).
 * Pure and locale-keyed so the renderer, the CLI and the server all print the
 * same thing without a React/i18n dependency.
 */
export function formatDriveSize(bytes: number, locale: string = DEFAULT_SIZE_LOCALE): string {
  const units = SIZE_UNITS[locale] ?? SIZE_UNITS[DEFAULT_SIZE_LOCALE]!
  const negative = bytes < 0
  let value = Math.abs(bytes)
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  const rounded = unit === 0 ? String(Math.round(value)) : trimTrailingZero(value)
  const formatted = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(Number(rounded))
  return `${negative ? '-' : ''}${formatted} ${units[unit]}`
}

function trimTrailingZero(value: number): string {
  return value >= 100 ? String(Math.round(value)) : String(Math.round(value * 10) / 10)
}