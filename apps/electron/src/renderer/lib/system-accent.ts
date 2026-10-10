/**
 * DISPATCH B10 — system accent colour (renderer).
 *
 * Electron's `systemPreferences.getAccentColor()` returns the accent as an
 * RGBA hex string (`"aabbccdd"`: r=aa, g=bb, b=cc, a=dd) per the Electron docs.
 * The brief calls this "ARGB→css"; the real byte order is RGBA, and this parser
 * follows the documented order so the four channels are not swapped.
 *
 * The resolved accent is `null` whenever it must not override the brand accent
 * (source is `brand`, or the system colour is unavailable). Callers fall back to
 * the palette's own `--accent`.
 */
import type { SystemAccentSnapshot } from '@rox/shared/protocol'

function byte(value: string): number {
  return parseInt(value, 16)
}

/**
 * Convert an Electron accent hex (RGBA, optionally `#`-prefixed, 6 or 8 digits)
 * into an `rgba(r, g, b, a)` CSS colour. Returns null for anything else.
 */
export function accentHexToCss(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null
  const value = raw.trim().replace(/^#/, '')
  const hex = value.match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})?$/i)
  if (!hex) return null
  const r = byte(hex[1]!)
  const g = byte(hex[2]!)
  const b = byte(hex[3]!)
  const alpha = hex[4] !== undefined ? byte(hex[4]) / 255 : 1
  return `rgba(${r}, ${g}, ${b}, ${Math.round(alpha * 1000) / 1000})`
}

/**
 * Accent to apply for a given source. `system` wins only with a usable colour;
 * every other case returns null so the caller keeps the brand accent.
 */
export function resolveAccentColor(
  source: 'brand' | 'system',
  system: SystemAccentSnapshot | null,
): string | null {
  if (source !== 'system') return null
  if (!system || system.source !== 'system') return null
  return accentHexToCss(system.color)
}

/** RGB triplet ("r, g, b") for the `--accent-rgb` alias, or null. */
export function accentRgbTriplet(css: string | null): string | null {
  if (!css) return null
  const match = css.match(/^rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)/)
  return match ? `${match[1]}, ${match[2]}, ${match[3]}` : null
}