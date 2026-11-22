/**
 * Russian money, dates and durations for every surface.
 *
 * Money is always integer cents at the API boundary and is printed with a
 * comma decimal separator and two decimals: `2000` reads as `20,00 $`.
 */

const EMPTY = '—'

export interface MoneyOptions {
  /** Append `/ч`, the hourly rate marker used on prices. */
  perHour?: boolean
}

/** `2000` → `20,00 $`; millions keep narrow groups: `1 234 567` → `12 345,67 $`. */
export function formatCents(cents: number | null | undefined): string {
  if (cents === null || cents === undefined || !Number.isFinite(cents)) return EMPTY
  const rounded = Math.round(cents)
  const sign = rounded < 0 ? '-' : ''
  const abs = Math.abs(rounded)
  const whole = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
  const fraction = String(abs % 100).padStart(2, '0')
  return `${sign}${whole},${fraction} $`
}

/** Money with optional hourly suffix: `formatMoney(3600, { perHour: true })` → `36,00 $/ч`. */
export function formatMoney(cents: number | null | undefined, options: MoneyOptions = {}): string {
  const amount = formatCents(cents)
  if (amount === EMPTY) return amount
  return options.perHour ? `${amount}/ч` : amount
}

/** ISO instant → `22.11.2026, 14:05` in the operator's own time zone. */
export function formatDate(value: string | number | Date | null | undefined): string {
  if (value === null || value === undefined || value === '') return EMPTY
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return EMPTY
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

/** Whole seconds → `45 с`, `12 мин 05 с`, `1 ч 30 мин`. */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds < 0) return EMPTY
  const total = Math.round(seconds)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const rest = total % 60
  if (hours > 0) return `${hours} ч ${String(minutes).padStart(2, '0')} мин`
  if (minutes > 0) return `${minutes} мин ${String(rest).padStart(2, '0')} с`
  return `${rest} с`
}

const ID_PREFIXES = ['sandbox_', 'sbx_', 'tenant_', 'key_', 'req_', 'cred_', 'guest-']

/** A short, stable handle for a long id: `sbx_01J…` → `01J…` cut to `length`. */
export function shortId(id: string | null | undefined, length = 8): string {
  if (id === null || id === undefined || id.length === 0) return EMPTY
  let value = id
  for (const prefix of ID_PREFIXES) {
    if (value.startsWith(prefix)) {
      value = value.slice(prefix.length)
      break
    }
  }
  return value.slice(0, length)
}
