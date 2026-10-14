import { describe, expect, it } from 'bun:test'
import { oppositeCornerWorld, resizeBox, resizeRotated, type Corner } from '../geometry'

const o = { x: 100, y: 50, w: 200, h: 100 }
const close = (a: { x: number; y: number }, b: { x: number; y: number }) => { expect(a.x).toBeCloseTo(b.x, 6); expect(a.y).toBeCloseTo(b.y, 6) }

describe('resize under rotation (review 6 #3)', () => {
  it('rotation 0 equals the plain resize', () => {
    expect(resizeRotated(o, 0, 'se', 10, 20)).toEqual(resizeBox(o, 'se', 10, 20))
  })
  for (const deg of [30, 90, 135, -60]) for (const c of ['nw', 'ne', 'sw', 'se'] as Corner[]) {
    it(`keeps the opposite corner fixed in world space (${deg}°, ${c})`, () => {
      const before = oppositeCornerWorld(o, deg, c)
      const after = resizeRotated(o, deg, c, 37, -12)
      close(oppositeCornerWorld(after, deg, c), before)
    })
  }
  it('rotates the pointer delta by -rotation (90°: world +y grows width on se)', () => {
    const r = resizeRotated(o, 90, 'se', 0, 30)
    expect(r.w).toBeCloseTo(230, 6)
    expect(r.h).toBeCloseTo(100, 6)
  })
  it('clamps to the minimum size and still pins the anchor', () => {
    const r = resizeRotated(o, 45, 'nw', 0, 1000 * Math.SQRT2)
    expect(r.w).toBe(20); expect(r.h).toBe(20)
    close(oppositeCornerWorld(r, 45, 'nw'), oppositeCornerWorld(o, 45, 'nw'))
  })
})
