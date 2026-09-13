import { describe, expect, it } from 'bun:test'
import { equalSplit, solveSplit } from '../resize-math'
import { createResizeController } from '../resize-controller'
import { PANEL_SASH_HIT_WIDTH, PANEL_SASH_HIT_WIDTH_COARSE, PANEL_SASH_LINE_WIDTH } from '../panel-constants'

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
})

describe('sash geometry (ZS-05)', () => {
  it('uses a 12px hit area and 2px line, 24px on coarse pointers', () => {
    expect(PANEL_SASH_HIT_WIDTH).toBe(12)
    expect(PANEL_SASH_LINE_WIDTH).toBe(2)
    expect(PANEL_SASH_HIT_WIDTH_COARSE).toBe(24)
  })
})
