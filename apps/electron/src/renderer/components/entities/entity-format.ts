/**
 * W1-08 (#1505) — small formatting helpers shared by entity components.
 */
import type { TFunction } from 'i18next'
import { kindDescriptor, type EntityKind } from '@rox/core/entities'

/** Localised kind label (`entities.kind.*`), falling back to the server label. */
export function entityKindLabel(t: TFunction, kind: EntityKind, fallback?: string): string {
  const key = kindDescriptor(kind)?.labelKey
  if (key) {
    const value = t(key)
    if (value && value !== key) return value
  }
  return fallback || kind
}

const UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['week', 7 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60],
]

/** "5 minutes ago" style text in `locale`; returns '' for invalid input. */
export function formatRelativeTime(iso: string | undefined, locale: string, now: Date = new Date()): string {
  if (!iso) return ''
  const then = Date.parse(iso)
  if (Number.isNaN(then)) return ''
  const seconds = Math.round((then - now.getTime()) / 1000)
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) return formatter.format(Math.round(seconds / size), unit)
  }
  return formatter.format(0, 'minute')
}
