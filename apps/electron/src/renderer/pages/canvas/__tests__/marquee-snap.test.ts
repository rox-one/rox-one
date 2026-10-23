import { describe, expect, it } from 'bun:test'
import {
  aabbOf,
  aabbsIntersect,
  applyMarqueeSelection,
  collectSnapTargets,
  hitMarquee,
  marqueeAabb,
  SNAP_THRESHOLD_PX,
  snapAabb,
  snapResizeBox,
  targetsFromAabb,
} from '../marquee-snap'

describe('marquee AABB', () => {
  it('normalizes any drag corner order', () => {
    expect(marqueeAabb(10, 20, 5, 8)).toEqual({ minX: 5, minY: 8, maxX: 10, maxY: 20 })
  })
  it('aabbOf matches unrotated box', () => {
    expect(aabbOf({ x: 1, y: 2, w: 3, h: 4 })).toEqual({ minX: 1, minY: 2, maxX: 4, maxY: 6 })
  })
  it('aabbOf expands under 90° rotation about centre', () => {
    // 100×50 box → after 90° AABB is 50×100 centred the same
    const b = aabbOf({ x: 0, y: 0, w: 100, h: 50 }, 90)
    expect(b.minX).toBeCloseTo(25, 6)
    expect(b.maxX).toBeCloseTo(75, 6)
    expect(b.minY).toBeCloseTo(-25, 6)
    expect(b.maxY).toBeCloseTo(75, 6)
  })
  it('intersects when overlapping, not when only touching outside', () => {
    const a = { minX: 0, minY: 0, maxX: 10, maxY: 10 }
    expect(aabbsIntersect(a, { minX: 10, minY: 0, maxX: 20, maxY: 10 })).toBe(true) // edge touch counts
    expect(aabbsIntersect(a, { minX: 10.1, minY: 0, maxX: 20, maxY: 10 })).toBe(false)
  })
})

describe('hitMarquee', () => {
  const objs = [
    { id: 'a', x: 0, y: 0, w: 100, h: 50 },
    { id: 'b', x: 200, y: 200, w: 40, h: 40 },
    { id: 'c', x: 50, y: 20, w: 10, h: 10, hidden: true },
    { id: 'd', x: 0, y: 0, w: 100, h: 20, rotation: 90 }, // AABB ≈ x 40..60, y -40..60
  ]
  it('returns objects intersecting the rubber-band', () => {
    expect(hitMarquee(objs, marqueeAabb(0, 0, 80, 40))).toEqual(['a', 'd'])
  })
  it('skips hidden', () => {
    expect(hitMarquee(objs, marqueeAabb(45, 15, 60, 30))).toEqual(['a', 'd']) // c hidden
  })
  it('includes rotated via AABB', () => {
    // marquee only over the rotated AABB of d (right of unrotated a top)
    expect(hitMarquee(objs, marqueeAabb(45, -30, 55, -10))).toEqual(['d'])
  })
  it('empty marquee hits nothing useful', () => {
    expect(hitMarquee(objs, marqueeAabb(1000, 1000, 1001, 1001))).toEqual([])
  })
})

describe('applyMarqueeSelection', () => {
  it('replaces without additive', () => {
    expect(applyMarqueeSelection(['x'], ['a', 'b'], false)).toEqual(['a', 'b'])
  })
  it('adds with additive without removing prior', () => {
    expect(applyMarqueeSelection(['x', 'a'], ['a', 'b'], true).sort()).toEqual(['a', 'b', 'x'])
  })
  it('additive with empty hits keeps prev', () => {
    expect(applyMarqueeSelection(['x'], [], true)).toEqual(['x'])
  })
})

describe('snapAabb / guides', () => {
  const other = { id: 'o', x: 100, y: 0, w: 50, h: 50 }
  const targets = collectSnapTargets([other], new Set(['me']), true)

  it('includes origin and other edges/centres', () => {
    const xs = targets.filter(t => t.axis === 'x').map(t => t.world)
    expect(xs).toContain(0)
    expect(xs).toContain(100)
    expect(xs).toContain(125)
    expect(xs).toContain(150)
  })

  it('snaps left edge to neighbour left within threshold', () => {
    // Only neighbour left (100) is within 6px of any candidate (left/mid/right).
    const r = snapAabb({ x: 100 + 4, y: 80, w: 10, h: 10 }, targets, 6, true)
    expect(r.x).toBeCloseTo(100, 6)
    expect(r.guides.some(g => g.axis === 'x' && g.world === 100)).toBe(true)
  })

  it('does not snap beyond threshold', () => {
    // far from origin (0) and other (100/125/150)
    const r = snapAabb({ x: 60, y: 80, w: 20, h: 20 }, targets, 6, true)
    expect(r.x).toBe(60)
    expect(r.guides.filter(g => g.axis === 'x')).toEqual([])
  })

  it('Alt (enabled=false) disables snap and guides', () => {
    const r = snapAabb({ x: 102, y: 2, w: 40, h: 40 }, targets, 6, false)
    expect(r).toEqual({ x: 102, y: 2, guides: [] })
  })

  it('snaps centre to origin', () => {
    // centre at (20, 20) → want snap so centre is (0,0) → top-left (-20,-20)
    const r = snapAabb({ x: -20 + 3, y: -20 + 2, w: 40, h: 40 }, targetsFromAabb({ minX: 0, minY: 0, maxX: 0, maxY: 0 }).length ? [
      { axis: 'x' as const, world: 0, from: -1e6, to: 1e6 },
      { axis: 'y' as const, world: 0, from: -1e6, to: 1e6 },
    ] : [], 6, true)
    expect(r.x).toBeCloseTo(-20, 6)
    expect(r.y).toBeCloseTo(-20, 6)
  })

  it('SNAP_THRESHOLD_PX is in the 4–8 CSS px range', () => {
    expect(SNAP_THRESHOLD_PX).toBeGreaterThanOrEqual(4)
    expect(SNAP_THRESHOLD_PX).toBeLessThanOrEqual(8)
  })
})

describe('snapResizeBox', () => {
  const targets = [
    { axis: 'x' as const, world: 200, from: 0, to: 100 },
    { axis: 'y' as const, world: 100, from: 0, to: 200 },
  ]
  const original = { x: 0, y: 0, w: 50, h: 50 }

  it('snaps the moving se corner edges', () => {
    const proposed = { x: 0, y: 0, w: 198, h: 97 } // near 200 / 100
    const { box, guides } = snapResizeBox(original, proposed, targets, 6, true)
    expect(box.w).toBeCloseTo(200, 6)
    expect(box.h).toBeCloseTo(100, 6)
    expect(guides.some(g => g.axis === 'x' && g.world === 200)).toBe(true)
    expect(guides.some(g => g.axis === 'y' && g.world === 100)).toBe(true)
  })

  it('keeps opposite edge when resizing from west', () => {
    const proposed = { x: 2, y: 0, w: 48, h: 50 } // left edge near 0, right stays 50
    const { box } = snapResizeBox(original, proposed, [{ axis: 'x', world: 0, from: 0, to: 50 }], 6, true)
    expect(box.x).toBeCloseTo(0, 6)
    expect(box.x + box.w).toBeCloseTo(50, 6)
  })

  it('disabled leaves box alone', () => {
    const proposed = { x: 0, y: 0, w: 199, h: 50 }
    expect(snapResizeBox(original, proposed, targets, 6, false)).toEqual({ box: proposed, guides: [] })
  })
})
