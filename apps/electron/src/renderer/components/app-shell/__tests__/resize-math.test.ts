import { describe, expect, it } from 'bun:test'
import { equalSplit, solveSplit } from '../resize-math'
import { createResizeController } from '../resize-controller'
import { inlineSashGeometry, PANEL_GAP, PANEL_EDGE_INSET, PANEL_SASH_HIT_WIDTH, PANEL_SASH_HIT_WIDTH_COARSE, PANEL_SASH_LINE_WIDTH, PANEL_STACK_TOP_INSET } from '../panel-constants'

describe('solveSplit (ZS-05)', () => {
  it('clamps A=500 B=500 min=440 delta=200 to A=560 B=440', () => {
    const result = solveSplit({
      total: 1000,
      sizeA: 500,
      minA: 440,
      maxA: Number.POSITIVE_INFINITY,
      minB: 440,
      maxB: Number.POSITIVE_INFINITY,
      delta: 200,
    })
    expect(result.feasible).toBe(true)
    expect(result.sizeA).toBe(560)
    expect(result.sizeB).toBe(440)
  })

  it('returns infeasible instead of negative widths when T=800 and both mins are 440', () => {
    const result = solveSplit({
      total: 800,
      sizeA: 400,
      minA: 440,
      maxA: Number.POSITIVE_INFINITY,
      minB: 440,
      maxB: Number.POSITIVE_INFINITY,
      delta: 0,
    })
    expect(result.feasible).toBe(false)
    expect(result.sizeA).toBeGreaterThanOrEqual(0)
    expect(result.sizeB).toBe(800 - 400)
  })

  it('rejects non-finite input', () => {
    expect(solveSplit({
      total: Number.NaN,
      sizeA: 200,
      minA: 180,
      maxA: 360,
      minB: 440,
      maxB: 1000,
    }).feasible).toBe(false)
  })

  it('equal split respects mins', () => {
    const result = equalSplit(1000, 440, 800, 440, 800)
    expect(result.feasible).toBe(true)
    expect(result.sizeA).toBe(500)
    expect(result.sizeB).toBe(500)
  })

  it('snaps a raw position that lands exactly on the 50 % target', () => {
    const result = solveSplit({
      total: 1000,
      sizeA: 500,
      minA: 180,
      maxA: 1000,
      minB: 180,
      maxB: 1000,
      delta: 0,
      snap: {},
    })
    expect(result.snapped).toBe(true)
    expect(result.snapPercent).toBe(50)
    expect(result.sizeA).toBe(500)
    expect(result.sizeB).toBe(500)
  })

  it('snaps from just below and just above a target (threshold both sides)', () => {
    const common = { total: 1000, sizeA: 500, minA: 180, maxA: 1000, minB: 180, maxB: 1000, snap: {} }
    const below = solveSplit({ ...common, delta: -11 })
    expect(below.sizeA).toBe(500)
    expect(below.snapped).toBe(true)
    expect(below.snapPercent).toBe(50)
    const above = solveSplit({ ...common, delta: 11 })
    expect(above.sizeA).toBe(500)
    expect(above.snapped).toBe(true)
    expect(above.snapPercent).toBe(50)
  })

  it('keeps the exact clamped position outside the threshold', () => {
    const result = solveSplit({
      total: 1000,
      sizeA: 500,
      minA: 180,
      maxA: 1000,
      minB: 180,
      maxB: 1000,
      delta: -20,
      snap: {},
    })
    expect(result.snapped).toBe(false)
    expect(result.snapPercent).toBeUndefined()
    expect(result.sizeA).toBe(480)
  })

  it('honours an explicit threshold over the token default', () => {
    const common = { total: 1000, sizeA: 500, minA: 180, maxA: 1000, minB: 180, maxB: 1000, delta: -11 }
    const tight = solveSplit({ ...common, snap: { threshold: 4 } })
    expect(tight.snapped).toBe(false)
    expect(tight.sizeA).toBe(489)
    const loose = solveSplit({ ...common, snap: { threshold: 40 } })
    expect(loose.snapped).toBe(true)
    expect(loose.sizeA).toBe(500)
  })

  it('snaps to the nearest reachable target (quarter percent)', () => {
    const result = solveSplit({
      total: 1000,
      sizeA: 500,
      minA: 180,
      maxA: 1000,
      minB: 180,
      maxB: 1000,
      delta: -246,
      snap: {},
    })
    expect(result.snapped).toBe(true)
    expect(result.snapPercent).toBe(25)
    expect(result.sizeA).toBe(250)
  })

  it('ignores a target outside the feasible range', () => {
    // maxB 400 → lower = max(minA, 1000-400) = 600, so the 500 px target is
    // unreachable and the raw position clamps to 600 instead.
    const result = solveSplit({
      total: 1000,
      sizeA: 620,
      minA: 180,
      maxA: 1000,
      minB: 180,
      maxB: 400,
      delta: -120,
      snap: {},
    })
    expect(result.snapped).toBe(false)
    expect(result.sizeA).toBe(600)
  })

  it('stays infeasible when the pair cannot hold both minimums', () => {
    const result = solveSplit({
      total: 800,
      sizeA: 400,
      minA: 440,
      maxA: 1000,
      minB: 440,
      maxB: 1000,
      delta: 0,
      snap: {},
    })
    expect(result.feasible).toBe(false)
  })
})

describe('resize controller (ZS-05)', () => {
  it('coalesces 1000 moves into one preview and zero commits until pointerup', () => {
    const frames: Array<() => void> = []
    const previews: number[] = []
    const commits: number[] = []
    const controller = createResizeController({
      onPreview: (a) => previews.push(a),
      onCommit: (a) => commits.push(a),
      onCancel: () => { /* restore */ },
      requestFrame: (cb) => { frames.push(cb); return frames.length },
      cancelFrame: () => { frames.length = 0 },
    })
    expect(controller.start({
      leftId: 'a',
      rightId: 'b',
      total: 1000,
      sizeA: 500,
      minA: 180,
      maxA: 800,
      minB: 180,
      maxB: 800,
    })).toBe(true)
    previews.length = 0
    for (let i = 1; i <= 1000; i++) controller.moveTo(500 + i)
    expect(previews).toEqual([])
    expect(commits).toEqual([])
    expect(frames).toHaveLength(1)
    frames[0]!()
    expect(previews).toHaveLength(1)
    controller.commit()
    expect(commits).toHaveLength(1)
  })

  it('cancel restores the snapshot and ignores a second cleanup', () => {
    const cancelled: number[] = []
    const controller = createResizeController({
      onPreview: () => undefined,
      onCommit: () => undefined,
      onCancel: (a) => cancelled.push(a),
      requestFrame: (cb) => { cb(); return 1 },
      cancelFrame: () => undefined,
    })
    controller.start({
      leftId: 'a',
      rightId: 'b',
      total: 1000,
      sizeA: 220,
      minA: 180,
      maxA: 360,
      minB: 440,
      maxB: Number.POSITIVE_INFINITY,
    })
    controller.moveTo(300)
    controller.cancel()
    controller.cancel()
    expect(cancelled).toEqual([220])
  })

  it('cancels when neighbor ids change', () => {
    const cancelled: number[] = []
    const controller = createResizeController({
      onPreview: () => undefined,
      onCommit: () => undefined,
      onCancel: (a) => cancelled.push(a),
      requestFrame: (cb) => { cb(); return 1 },
      cancelFrame: () => undefined,
    })
    controller.start({
      leftId: 'left-1',
      rightId: 'right-1',
      total: 1000,
      sizeA: 500,
      minA: 440,
      maxA: 800,
      minB: 440,
      maxB: 800,
    })
    controller.neighborChanged('left-2', 'right-1')
    expect(cancelled).toEqual([500])
  })

  it('exposes snapped percent and px width, resetting on commit', () => {
    const controller = createResizeController({
      onPreview: () => undefined,
      onCommit: () => undefined,
      onCancel: () => undefined,
      requestFrame: (cb) => { cb(); return 1 },
      cancelFrame: () => undefined,
    })
    expect(controller.start({
      leftId: 'a',
      rightId: 'b',
      total: 1000,
      sizeA: 500,
      minA: 180,
      maxA: 800,
      minB: 180,
      maxB: 800,
      snap: {},
    })).toBe(true)
    expect(controller.snapState).toEqual({ snapped: true, percent: 50, width: 500 })
    controller.moveTo(510)
    expect(controller.snapState).toEqual({ snapped: true, percent: 50, width: 500 })
    controller.commit()
    expect(controller.snapState).toEqual({ snapped: false, percent: null, width: 0 })
  })
})

describe('sash geometry (ZS-05)', () => {
  it('joins shell panes without gutters', () => {
    expect(PANEL_GAP).toBe(0)
    expect(PANEL_EDGE_INSET).toBe(0)
    expect(PANEL_STACK_TOP_INSET).toBe(0)
  })

  it.each([PANEL_SASH_HIT_WIDTH, PANEL_SASH_HIT_WIDTH_COARSE])('keeps a %ipx hit area centered on a zero-width inline seam', (hitWidth) => {
    const geometry = inlineSashGeometry(hitWidth)
    expect(geometry.width).toBe(hitWidth)
    expect(geometry.flexShrink).toBe(0)
    expect(geometry.width + geometry.marginLeft + geometry.marginRight).toBe(0)
    expect(geometry.marginLeft).toBe(geometry.marginRight)
    expect(geometry.marginLeft).toBe(-hitWidth / 2)
  })

  it('uses the shipped 8px hit area and 1px line, 24px on coarse pointers', () => {
    // The thinner-splitter pass (408b90b83) moved both chrome profiles to an
    // 8px hit area and a 1px line; the coarse-pointer hit area stays 24px.
    expect(PANEL_SASH_HIT_WIDTH).toBe(8)
    expect(PANEL_SASH_LINE_WIDTH).toBe(1)
    expect(PANEL_SASH_HIT_WIDTH_COARSE).toBe(24)
  })
})
