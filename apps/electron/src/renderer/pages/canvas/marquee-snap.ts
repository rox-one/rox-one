/**
 * «Доска» marquee hit-test + snapping / smart guides (pure helpers; clean-room).
 *
 * Modifier notes (intentional):
 * - Shift / Meta / Ctrl on click: additive toggle (existing). Shift on marquee: add hits
 *   to the current selection (replace without Shift).
 * - Alt while move/resize: disable snapping. Shift is NOT used for snap-disable because
 *   it already means 15° rotation quantize and additive selection.
 */
export interface Rect { x: number; y: number; w: number; h: number }
export interface Aabb { minX: number; minY: number; maxX: number; maxY: number }

/** Screen-space snap threshold in CSS pixels (converted to world via / zoom). */
export const SNAP_THRESHOLD_PX = 6

export type Guide =
  | { axis: 'x'; world: number; from: number; to: number }
  | { axis: 'y'; world: number; from: number; to: number }

/** Axis-aligned bounding box of a (possibly rotated) rect. Rotation in degrees about centre. */
export function aabbOf(o: Rect, rotationDeg = 0): Aabb {
  const { x, y, w, h } = o
  if (!rotationDeg) return { minX: x, minY: y, maxX: x + w, maxY: y + h }
  const cx = x + w / 2, cy = y + h / 2
  const r = (rotationDeg * Math.PI) / 180
  const hw = (Math.abs(Math.cos(r)) * w + Math.abs(Math.sin(r)) * h) / 2
  const hh = (Math.abs(Math.sin(r)) * w + Math.abs(Math.cos(r)) * h) / 2
  return { minX: cx - hw, minY: cy - hh, maxX: cx + hw, maxY: cy + hh }
}

/** Normalize a drag rubber-band (any corner origin) to a positive AABB. */
export function marqueeAabb(x0: number, y0: number, x1: number, y1: number): Aabb {
  return {
    minX: Math.min(x0, x1),
    minY: Math.min(y0, y1),
    maxX: Math.max(x0, x1),
    maxY: Math.max(y0, y1),
  }
}

export function aabbsIntersect(a: Aabb, b: Aabb): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY
}

export interface MarqueeObject {
  id: string
  x: number
  y: number
  w: number
  h: number
  rotation?: number
  hidden?: boolean
}

/**
 * Ids whose AABB intersects the marquee (world coords). Hidden objects are skipped.
 * Order follows `objects` (caller typically passes z-order list).
 */
export function hitMarquee(objects: readonly MarqueeObject[], marquee: Aabb): string[] {
  const out: string[] = []
  for (const o of objects) {
    if (o.hidden) continue
    if (!(o.w >= 0 && o.h >= 0) || ![o.x, o.y, o.w, o.h].every(Number.isFinite)) continue
    if (aabbsIntersect(marquee, aabbOf(o, o.rotation ?? 0))) out.push(o.id)
  }
  return out
}

/** Merge marquee hits into selection: replace, or with `additive` add (no toggle of already-selected). */
export function applyMarqueeSelection(prev: readonly string[], hits: readonly string[], additive: boolean): string[] {
  if (!additive) return [...hits]
  if (hits.length === 0) return [...prev]
  const set = new Set(prev)
  for (const id of hits) set.add(id)
  return [...set]
}

export interface SnapTarget {
  /** Vertical guide (constant x) or horizontal (constant y). */
  axis: 'x' | 'y'
  world: number
  /** Extent of the source object along the other axis (for drawing the guide segment). */
  from: number
  to: number
}

/** Edges + centres of an AABB as snap targets. */
export function targetsFromAabb(box: Aabb): SnapTarget[] {
  const midX = (box.minX + box.maxX) / 2
  const midY = (box.minY + box.maxY) / 2
  return [
    { axis: 'x', world: box.minX, from: box.minY, to: box.maxY },
    { axis: 'x', world: midX, from: box.minY, to: box.maxY },
    { axis: 'x', world: box.maxX, from: box.minY, to: box.maxY },
    { axis: 'y', world: box.minY, from: box.minX, to: box.maxX },
    { axis: 'y', world: midY, from: box.minX, to: box.maxX },
    { axis: 'y', world: box.maxY, from: box.minX, to: box.maxX },
  ]
}

/** Canvas origin crosshair (0,0) as optional snap anchors. */
export function originTargets(): SnapTarget[] {
  return [
    { axis: 'x', world: 0, from: -1e6, to: 1e6 },
    { axis: 'y', world: 0, from: -1e6, to: 1e6 },
  ]
}

/** Collect snap targets from other objects (skip ids in `exclude`, skip hidden). */
export function collectSnapTargets(
  objects: readonly MarqueeObject[],
  exclude: ReadonlySet<string>,
  includeOrigin = true,
): SnapTarget[] {
  const out: SnapTarget[] = includeOrigin ? originTargets() : []
  for (const o of objects) {
    if (exclude.has(o.id) || o.hidden) continue
    if (![o.x, o.y, o.w, o.h].every(Number.isFinite)) continue
    out.push(...targetsFromAabb(aabbOf(o, o.rotation ?? 0)))
  }
  return out
}

/** Candidate values on a moving AABB that can snap (edges + centre). */
function movingCandidates(box: Aabb, axis: 'x' | 'y'): number[] {
  if (axis === 'x') return [box.minX, (box.minX + box.maxX) / 2, box.maxX]
  return [box.minY, (box.minY + box.maxY) / 2, box.maxY]
}

export interface SnapResult {
  /** Adjusted top-left (or proposed box origin) after snap. */
  x: number
  y: number
  guides: Guide[]
}

/**
 * Snap a proposed AABB (world) to the nearest targets within `threshold` (world units).
 * Returns the snapped top-left of the box and temporary guide lines.
 * When `enabled` is false (Alt held), returns the input unchanged with no guides.
 */
export function snapAabb(
  proposed: Rect,
  targets: readonly SnapTarget[],
  threshold: number,
  enabled: boolean,
): SnapResult {
  const x0 = proposed.x, y0 = proposed.y
  if (!enabled || threshold < 0 || !Number.isFinite(threshold)) {
    return { x: x0, y: y0, guides: [] }
  }
  const box = aabbOf(proposed, 0)
  let bestDx = 0, bestDy = 0
  let bestAbsX = threshold + 1, bestAbsY = threshold + 1
  let guideX: Guide | null = null, guideY: Guide | null = null

  for (const t of targets) {
    if (t.axis === 'x') {
      for (const c of movingCandidates(box, 'x')) {
        const d = t.world - c
        const a = Math.abs(d)
        if (a <= threshold && a < bestAbsX) {
          bestAbsX = a
          bestDx = d
          guideX = {
            axis: 'x',
            world: t.world,
            from: Math.min(t.from, box.minY, box.maxY),
            to: Math.max(t.to, box.minY, box.maxY),
          }
        }
      }
    } else {
      for (const c of movingCandidates(box, 'y')) {
        const d = t.world - c
        const a = Math.abs(d)
        if (a <= threshold && a < bestAbsY) {
          bestAbsY = a
          bestDy = d
          guideY = {
            axis: 'y',
            world: t.world,
            from: Math.min(t.from, box.minX, box.maxX),
            to: Math.max(t.to, box.minX, box.maxX),
          }
        }
      }
    }
  }

  const guides: Guide[] = []
  if (guideX) guides.push(guideX)
  if (guideY) guides.push(guideY)
  return { x: x0 + bestDx, y: y0 + bestDy, guides }
}

/**
 * Snap a resize result: only the edges that moved (vs `original`) are candidates.
 * Keeps the opposite edges fixed; returns adjusted box + guides.
 */
export function snapResizeBox(
  original: Rect,
  proposed: Rect,
  targets: readonly SnapTarget[],
  threshold: number,
  enabled: boolean,
): { box: Rect; guides: Guide[] } {
  if (!enabled || threshold < 0) return { box: proposed, guides: [] }
  let { x, y, w, h } = proposed
  const guides: Guide[] = []
  const leftMoved = Math.abs(proposed.x - original.x) > 1e-9
  const topMoved = Math.abs(proposed.y - original.y) > 1e-9
  const rightMoved = Math.abs(proposed.x + proposed.w - (original.x + original.w)) > 1e-9
  const bottomMoved = Math.abs(proposed.y + proposed.h - (original.y + original.h)) > 1e-9

  const snapEdge = (axis: 'x' | 'y', value: number): { value: number; guide: Guide | null } => {
    let best = value, bestAbs = threshold + 1
    let guide: Guide | null = null
    for (const t of targets) {
      if (t.axis !== axis) continue
      const d = t.world - value
      const a = Math.abs(d)
      if (a <= threshold && a < bestAbs) {
        bestAbs = a
        best = t.world
        guide = {
          axis,
          world: t.world,
          from: t.from,
          to: t.to,
        }
      }
    }
    return { value: best, guide }
  }

  if (leftMoved) {
    const r = snapEdge('x', x)
    const dx = r.value - x
    x = r.value
    w = Math.max(1, w - dx)
    if (r.guide) guides.push({ ...r.guide, from: Math.min(r.guide.from, y, y + h), to: Math.max(r.guide.to, y, y + h) })
  }
  if (rightMoved) {
    const r = snapEdge('x', x + w)
    w = Math.max(1, r.value - x)
    if (r.guide) guides.push({ ...r.guide, from: Math.min(r.guide.from, y, y + h), to: Math.max(r.guide.to, y, y + h) })
  }
  if (topMoved) {
    const r = snapEdge('y', y)
    const dy = r.value - y
    y = r.value
    h = Math.max(1, h - dy)
    if (r.guide) guides.push({ ...r.guide, from: Math.min(r.guide.from, x, x + w), to: Math.max(r.guide.to, x, x + w) })
  }
  if (bottomMoved) {
    const r = snapEdge('y', y + h)
    h = Math.max(1, r.value - y)
    if (r.guide) guides.push({ ...r.guide, from: Math.min(r.guide.from, x, x + w), to: Math.max(r.guide.to, x, x + w) })
  }
  return { box: { x, y, w, h }, guides }
}
