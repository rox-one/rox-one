import { describe, expect, it } from 'bun:test'
import {
  BADGE_HEIGHT_POINTS,
  BADGE_RED,
  badgeLabel,
  compositeBadge,
  formatElapsed,
  labelCells,
  layoutBadge,
  renderRecordingDot,
  TRAY_ICON_POINTS,
  type Bitmap,
} from '../tray-badge'

function solidIcon(scale: number, rgba: [number, number, number, number]): Bitmap {
  const size = TRAY_ICON_POINTS * scale
  const data = new Uint8Array(size * size * 4)
  for (let i = 0; i < data.length; i += 4) data.set(rgba, i)
  return { width: size, height: size, data }
}

const px = (bmp: Bitmap, x: number, y: number) => Array.from(bmp.data.slice((y * bmp.width + x) * 4, (y * bmp.width + x) * 4 + 4))

describe('badge count logic', () => {
  it('hides at zero and for garbage, caps at 99+', () => {
    expect(badgeLabel(0)).toBeNull()
    expect(badgeLabel(-1)).toBeNull()
    expect(badgeLabel(Number.NaN)).toBeNull()
    expect(badgeLabel(Number.POSITIVE_INFINITY)).toBeNull()
    expect(badgeLabel(1)).toBe('1')
    expect(badgeLabel(24.9)).toBe('24')
    expect(badgeLabel(99)).toBe('99')
    expect(badgeLabel(100)).toBe('99+')
  })

  it('returns the icon untouched when hidden', () => {
    const icon = solidIcon(1, [0, 0, 0, 255])
    expect(compositeBadge(icon, 0, 1)).toBe(icon)
  })
})

describe('badge layout', () => {
  it('is a circle for one digit and a pill for more, scaled for Retina', () => {
    const one = layoutBadge('5', 1)
    expect(one.pill.h).toBe(BADGE_HEIGHT_POINTS)
    expect(one.pill.w).toBe(BADGE_HEIGHT_POINTS)
    const two = layoutBadge('24', 1)
    expect(two.pill.w).toBeGreaterThanOrEqual(labelCells('24') + 4)
    const retina = layoutBadge('24', 2)
    expect(retina.pill.h).toBe(BADGE_HEIGHT_POINTS * 2)
    expect(retina.pill.w).toBe(two.pill.w * 2)
    expect(retina.iconSize).toBe(TRAY_ICON_POINTS * 2)
  })

  it('anchors bottom-right, overhangs the icon and keeps room for the shadow', () => {
    const l = layoutBadge('24', 2)
    expect(l.pill.y + l.pill.h).toBe(l.iconSize)
    expect(l.pill.x + l.pill.w).toBeGreaterThan(l.iconSize)
    expect(l.width).toBeGreaterThan(l.pill.x + l.pill.w)
    expect(l.height).toBeGreaterThan(l.iconSize)
    const wide = layoutBadge('99+', 1)
    expect(wide.pill.x).toBeGreaterThanOrEqual(0)
  })
})

describe('badge compositing', () => {
  for (const scale of [1, 2]) {
    it(`draws a red pill with white digits over the icon at @${scale}x`, () => {
      const icon = solidIcon(scale, [10, 20, 30, 255])
      const out = compositeBadge(icon, 24, scale, 'rgba')
      const l = layoutBadge('24', scale)
      expect(out.width).toBe(l.width)
      expect(out.height).toBe(l.height)
      // Icon untouched far from the badge.
      expect(px(out, 1, 1)).toEqual([10, 20, 30, 255])
      // Pill edge (inside, away from digits) is opaque system red.
      const edge = px(out, l.pill.x + Math.floor(l.pill.w / 2), l.pill.y + scale)
      expect(edge).toEqual([...BADGE_RED, 255])
      // Some pure-white digit pixels exist inside the pill.
      let white = 0
      for (let y = l.pill.y; y < l.pill.y + l.pill.h; y++) {
        for (let x = l.pill.x; x < l.pill.x + l.pill.w; x++) {
          const [r, g, b, a] = px(out, x, y)
          if (r === 255 && g === 255 && b === 255 && a === 255) white++
        }
      }
      expect(white).toBeGreaterThan(10 * scale * scale)
      // Soft shadow: semi-transparent dark pixels just below the pill.
      const below = px(out, l.pill.x + Math.floor(l.pill.w / 2), l.pill.y + l.pill.h + Math.max(0, scale - 1))
      expect(below[3]).toBeGreaterThan(0)
      expect(below[3]).toBeLessThan(255)
      expect(below[0]).toBeLessThan(40)
    })
  }

  it('knocks a transparent ring out of the icon around the pill', () => {
    const icon = solidIcon(2, [200, 200, 200, 255])
    const out = compositeBadge(icon, 7, 2, 'rgba')
    const l = layoutBadge('7', 2)
    // Just above the pill's top centre, on the icon: cleared (shadow sits below, not above).
    const ring = px(out, l.pill.x + Math.floor(l.pill.w / 2), l.pill.y - 1)
    expect(ring[3]).toBeLessThan(80)
  })

  it('swaps red/blue for native BGRA order', () => {
    const out = compositeBadge(solidIcon(1, [0, 0, 0, 0]), 3, 1, 'bgra')
    const l = layoutBadge('3', 1)
    const [b, g, r, a] = px(out, l.pill.x + Math.floor(l.pill.w / 2), l.pill.y + 1)
    expect([r, g, b, a]).toEqual([...BADGE_RED, 255])
  })

  it('keeps premultiplied alpha (no channel above alpha)', () => {
    const out = compositeBadge(solidIcon(2, [0, 0, 0, 0]), 99, 2, 'rgba')
    for (let i = 0; i < out.data.length; i += 4) {
      const a = out.data[i + 3]!
      expect(Math.max(out.data[i]!, out.data[i + 1]!, out.data[i + 2]!)).toBeLessThanOrEqual(a)
    }
  })
})

describe('recording indicator', () => {
  it('renders a centred red dot at both scales', () => {
    for (const scale of [1, 2]) {
      const dot = renderRecordingDot(scale, 'rgba')
      expect(dot.width).toBe(16 * scale)
      expect(px(dot, 8 * scale, 8 * scale)).toEqual([...BADGE_RED, 255])
      expect(px(dot, 0, 0)[3]).toBe(0)
    }
  })

  it('formats elapsed time', () => {
    expect(formatElapsed(0)).toBe('0:00')
    expect(formatElapsed(-5)).toBe('0:00')
    expect(formatElapsed(42_000)).toBe('0:42')
    expect(formatElapsed(61_999)).toBe('1:01')
    expect(formatElapsed(3_723_000)).toBe('1:02:03')
  })
})
