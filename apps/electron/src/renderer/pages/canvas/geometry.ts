/** «Доска» box geometry (pure; unit-tested). */
export type Corner = 'nw' | 'ne' | 'sw' | 'se'
export interface Box { x: number; y: number; w: number; h: number }
export const MIN_SIZE = 20

/** New box for a corner drag by (dx, dy) in the box's own (unrotated) frame, clamped to `minSize`. */
export function resizeBox(o: Box, corner: Corner, dx: number, dy: number, minSize = MIN_SIZE): Box {
  let { x, y, w, h } = o
  if (corner.includes('e')) w = Math.max(minSize, o.w + dx)
  if (corner.includes('s')) h = Math.max(minSize, o.h + dy)
  if (corner.includes('w')) { w = Math.max(minSize, o.w - dx); x = o.x + o.w - w }
  if (corner.includes('n')) { h = Math.max(minSize, o.h - dy); y = o.y + o.h - h }
  return { x, y, w, h }
}

const rot = (x: number, y: number, rad: number) => ({ x: x * Math.cos(rad) - y * Math.sin(rad), y: x * Math.sin(rad) + y * Math.cos(rad) })
/** Offset of the corner opposite `corner` from the box centre, in the box frame. */
const oppositeRel = (b: Box, corner: Corner) => ({ x: corner.includes('e') ? -b.w / 2 : b.w / 2, y: corner.includes('s') ? -b.h / 2 : b.h / 2 })

/** World position of the corner opposite `corner` for a box rotated `deg` about its centre. */
export function oppositeCornerWorld(b: Box, deg: number, corner: Corner) {
  const r = rot(oppositeRel(b, corner).x, oppositeRel(b, corner).y, (deg * Math.PI) / 180)
  return { x: b.x + b.w / 2 + r.x, y: b.y + b.h / 2 + r.y }
}

/**
 * Corner resize of a box rotated `deg` about its centre: the world pointer delta
 * is rotated by -rotation into the box frame, and the opposite corner stays fixed
 * in world space (the stored x/y is the unrotated top-left, so it shifts).
 */
export function resizeRotated(o: Box, deg: number, corner: Corner, dxWorld: number, dyWorld: number, minSize = MIN_SIZE): Box {
  if (!deg) return resizeBox(o, corner, dxWorld, dyWorld, minSize)
  const rad = (deg * Math.PI) / 180
  const d = rot(dxWorld, dyWorld, -rad)
  const sized = resizeBox(o, corner, d.x, d.y, minSize)
  const anchor = oppositeCornerWorld(o, deg, corner)
  const rel = rot(oppositeRel(sized, corner).x, oppositeRel(sized, corner).y, rad)
  const cx = anchor.x - rel.x, cy = anchor.y - rel.y
  return { x: cx - sized.w / 2, y: cy - sized.h / 2, w: sized.w, h: sized.h }
}
