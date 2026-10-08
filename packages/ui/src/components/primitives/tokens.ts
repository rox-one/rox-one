/**
 * W1-08 (#1505) — shared class tokens for the entity UI primitives.
 *
 * Primitives render through Rox tokens only (UI-SPEC §2, §2.6): no hex
 * colours, no profile checks. Both UI profiles (Rox / super.engineering)
 * override token values, never these class names.
 */

/** Visible keyboard focus (PLAN §1.4: focus-visible on every primary action). */
export const FOCUS_RING =
  'outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-background'

/**
 * Motion: 120 ms hover / appear (UI-SPEC §2.6 `--motion-fast`), collapsed to
 * an instant change under `prefers-reduced-motion: reduce`.
 */
export const MOTION_FAST = 'transition-colors duration-[120ms] ease-out motion-reduce:transition-none'

/** Hover tint for rows and chips (8% accent mix, UI-SPEC §2 table). */
export const HOVER_TINT = 'hover:bg-[color-mix(in_oklch,var(--accent)_8%,transparent)]'

/** Selected tint (14% accent mix). */
export const SELECTED_TINT = 'bg-[color-mix(in_oklch,var(--accent)_14%,transparent)]'

/** Popover surface shared by hover cards, pickers and menus. */
export const POPOVER_SURFACE =
  'rounded-[8px] bg-background text-foreground shadow-[0_6px_20px_rgba(0,0,0,0.2),0_0_0_1px_color-mix(in_oklch,var(--foreground)_12%,transparent)]'

/** Initials for avatar fallbacks (first letters of up to two words). */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  const first = parts[0]!.charAt(0)
  const second = parts.length > 1 ? parts[parts.length - 1]!.charAt(0) : ''
  return (first + second).toUpperCase()
}

/**
 * Format an instant, or return '' when it is missing or not a valid date
 * (`Intl.DateTimeFormat#format` throws a RangeError on an invalid Date).
 */
export function formatInstant(format: Intl.DateTimeFormat, value: string | number | Date | null | undefined): string {
  if (value === null || value === undefined || value === '') return ''
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? '' : format.format(date)
}
