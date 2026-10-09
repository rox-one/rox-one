/**
 * DISPATCH B10 — accent conversion and source priority.
 *
 * Electron's `getAccentColor()` returns RGBA hex; the parser must not swap the
 * alpha and red channels, and a missing/system-less snapshot must fall back to
 * the brand accent (null override).
 */
import { describe, expect, it } from 'bun:test'
import { accentHexToCss, accentRgbTriplet, resolveAccentColor } from '../system-accent'
import type { SystemAccentSnapshot } from '../../../shared/types'

describe('accentHexToCss (Electron RGBA hex)', () => {
  it('maps the four RGBA channels in order', () => {
    // r=aa g=bb b=cc a=dd — the documented order (not ARGB).
    expect(accentHexToCss('aabbccdd')).toBe('rgba(170, 187, 204, 0.867)')
  })

  it('treats a 6-digit value as fully opaque and accepts a leading #', () => {
    expect(accentHexToCss('#ff8800')).toBe('rgba(255, 136, 0, 1)')
  })

  it('rejects malformed input', () => {
    expect(accentHexToCss(null)).toBeNull()
    expect(accentHexToCss('nope')).toBeNull()
    expect(accentHexToCss('abcd')).toBeNull()
  })
})

describe('resolveAccentColor priority and fallback', () => {
  const system: SystemAccentSnapshot = { source: 'system', color: '3c82f6ff' }

  it('returns the converted system colour when the source is system', () => {
    expect(resolveAccentColor('system', system)).toBe('rgba(60, 130, 246, 1)')
  })

  it('falls back to the brand accent (null) for source=brand', () => {
    expect(resolveAccentColor('brand', system)).toBeNull()
  })

  it('falls back when the snapshot is missing or carries no system colour', () => {
    expect(resolveAccentColor('system', null)).toBeNull()
    expect(resolveAccentColor('system', { source: 'brand', color: null })).toBeNull()
    expect(resolveAccentColor('system', { source: 'system', color: null })).toBeNull()
  })
})

describe('accentRgbTriplet', () => {
  it('extracts the r, g, b triplet without alpha', () => {
    expect(accentRgbTriplet('rgba(170, 187, 204, 0.867)')).toBe('170, 187, 204')
    expect(accentRgbTriplet(null)).toBeNull()
  })
})