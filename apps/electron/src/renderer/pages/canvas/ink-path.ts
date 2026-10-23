/**
 * Freehand / line stroke helpers for «Доска» (clean-room; no HyCanvas code).
 * Points are stored as flat [x,y,…] pairs in the object's local frame (relative
 * to the object's top-left). The object's x/y/w/h is the axis-aligned bounds.
 */

export interface StrokeBox { x: number; y: number; w: number; h: number }

/** Minimum distance (world units) between successive ink samples. */
export const INK_MIN_DIST = 1.5

/** Tiny strokes shorter than this are discarded on pointer-up. */
export const STROKE_MIN_SPAN = 2

/**
 * Hard cap on flat ink coordinates (pairs = length/2). Stops O(n²) main-thread
 * work and unbounded Yjs payloads from a stuck pointer or hostile peer data.
 */
export const INK_MAX_COORDS = 8000

/** Keep `x,y` only when it moved at least `minDist` from the last sample (or is first). */
export function sampleStroke(prev: readonly number[], x: number, y: number, minDist = INK_MIN_DIST): number[] | null {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null
  if (prev.length < 2) return [x, y]
  if (prev.length >= INK_MAX_COORDS) return null
  const lx = prev[prev.length - 2]!, ly = prev[prev.length - 1]!
  const dx = x - lx, dy = y - ly
  if (dx * dx + dy * dy < minDist * minDist) return null
  return [...prev, x, y]
}

/**
 * Mutating sampler for live ink gestures. Avoids O(n) copies per pointermove.
 * Returns true when a sample was appended.
 */
export function pushStrokeSample(prev: number[], x: number, y: number, minDist = INK_MIN_DIST): boolean {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false
  if (prev.length >= INK_MAX_COORDS) return false
  if (prev.length < 2) { prev.push(x, y); return true }
  const lx = prev[prev.length - 2]!, ly = prev[prev.length - 1]!
  const dx = x - lx, dy = y - ly
  if (dx * dx + dy * dy < minDist * minDist) return false
  prev.push(x, y)
  return true
}

/** Absolute flat points → local points + AABB (pad expands the box for hit/stroke width). */
export function strokeBounds(abs: readonly number[], pad = 1): StrokeBox & { points: number[] } {
  if (abs.length < 2) return { x: 0, y: 0, w: 0, h: 0, points: [] }
  let minX = abs[0]!, maxX = abs[0]!, minY = abs[1]!, maxY = abs[1]!
  for (let i = 2; i + 1 < abs.length; i += 2) {
    const x = abs[i]!, y = abs[i + 1]!
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  const x = minX - pad, y = minY - pad
  const w = Math.max(0, maxX - minX + pad * 2), h = Math.max(0, maxY - minY + pad * 2)
  const points: number[] = []
  for (let i = 0; i + 1 < abs.length; i += 2) {
    points.push(abs[i]! - x, abs[i + 1]! - y)
  }
  return { x, y, w, h, points }
}

/** Two-point line in world space → local points + AABB. */
export function lineFromEndpoints(x0: number, y0: number, x1: number, y1: number, pad = 1): StrokeBox & { points: number[] } {
  return strokeBounds([x0, y0, x1, y1], pad)
}

/** Scale local points so they fill `to` the same way they filled `from`. */
export function scaleLocalPoints(points: readonly number[], from: StrokeBox, to: StrokeBox): number[] {
  const sx = from.w > 0 ? to.w / from.w : 1
  const sy = from.h > 0 ? to.h / from.h : 1
  const out: number[] = []
  for (let i = 0; i + 1 < points.length; i += 2) {
    out.push(points[i]! * sx, points[i + 1]! * sy)
  }
  return out
}

/** Local → absolute flat list (for appending ink samples mid-gesture). */
export function localToAbs(local: readonly number[], ox: number, oy: number): number[] {
  const out: number[] = []
  for (let i = 0; i + 1 < local.length; i += 2) out.push(local[i]! + ox, local[i + 1]! + oy)
  return out
}

/** SVG polyline `points` attribute from local coords. */
export function toPolylineAttr(local: readonly number[], ox: number, oy: number): string {
  const parts: string[] = []
  for (let i = 0; i + 1 < local.length; i += 2) parts.push(`${local[i]! + ox},${local[i + 1]! + oy}`)
  return parts.join(' ')
}

/**
 * Smooth SVG path through local samples (midpoint quadratic segments).
 * Clean-room; not a port of any third-party freehand library.
 */
export function toSmoothPath(local: readonly number[], ox: number, oy: number): string {
  if (local.length < 2) return ''
  const pts: Array<{ x: number; y: number }> = []
  for (let i = 0; i + 1 < local.length; i += 2) pts.push({ x: local[i]! + ox, y: local[i + 1]! + oy })
  if (pts.length === 1) return `M ${pts[0]!.x} ${pts[0]!.y}`
  if (pts.length === 2) return `M ${pts[0]!.x} ${pts[0]!.y} L ${pts[1]!.x} ${pts[1]!.y}`
  let d = `M ${pts[0]!.x} ${pts[0]!.y}`
  for (let i = 1; i < pts.length - 1; i++) {
    const midX = (pts[i]!.x + pts[i + 1]!.x) / 2
    const midY = (pts[i]!.y + pts[i + 1]!.y) / 2
    d += ` Q ${pts[i]!.x} ${pts[i]!.y} ${midX} ${midY}`
  }
  const last = pts[pts.length - 1]!
  d += ` L ${last.x} ${last.y}`
  return d
}

/** True when the stroke is too short to keep (click without a drag). */
export function isTinyStroke(box: StrokeBox, pointCount: number): boolean {
  if (pointCount < 2) return true
  return box.w <= STROKE_MIN_SPAN && box.h <= STROKE_MIN_SPAN
}

/** Read a flat number[] from object props; empty if missing/odd/non-finite. Caps length. */
export function readPoints(props: Record<string, unknown> | undefined): number[] {
  const p = props?.points
  if (!Array.isArray(p) || p.length < 2 || p.length % 2 !== 0) return []
  if (!p.every(n => typeof n === 'number' && Number.isFinite(n))) return []
  return p.length > INK_MAX_COORDS ? (p as number[]).slice(0, INK_MAX_COORDS) : (p as number[])
}
