import { describe, expect, it } from 'bun:test'
import * as Y from 'yjs'
import { actorOrigin, CanvasDoc, createUndoManager, validateObject } from '@rox/canvas-core'
import { resizeRotated } from '../geometry'
import {
  isTinyStroke, lineFromEndpoints, localToAbs, readPoints, sampleStroke, scaleLocalPoints, strokeBounds,
  toPolylineAttr, toSmoothPath,
} from '../ink-path'

const me = actorOrigin('user', 'line-ink')

describe('ink-path sampling', () => {
  it('keeps the first point and drops near duplicates', () => {
    expect(sampleStroke([], 0, 0)).toEqual([0, 0])
    expect(sampleStroke([0, 0], 0.5, 0)).toBeNull()
    expect(sampleStroke([0, 0], 3, 4)).toEqual([0, 0, 3, 4])
  })
  it('builds a local AABB and polyline attr', () => {
    const b = strokeBounds([10, 20, 30, 40], 1)
    expect(b).toEqual({ x: 9, y: 19, w: 22, h: 22, points: [1, 1, 21, 21] })
    expect(toPolylineAttr(b.points, b.x, b.y)).toBe('10,20 30,40')
  })
  it('lineFromEndpoints is a two-point stroke', () => {
    const b = lineFromEndpoints(0, 0, 100, 0, 1)
    expect(b.points).toEqual([1, 1, 101, 1])
    expect(b.w).toBe(102)
    expect(b.h).toBe(2)
  })
  it('scales local points with the box', () => {
    const from = { x: 0, y: 0, w: 10, h: 10 }
    const to = { x: 0, y: 0, w: 20, h: 5 }
    expect(scaleLocalPoints([0, 0, 10, 10], from, to)).toEqual([0, 0, 20, 5])
  })
  it('smooth path covers multi-point strokes', () => {
    expect(toSmoothPath([0, 0], 0, 0)).toBe('M 0 0')
    expect(toSmoothPath([0, 0, 10, 0], 0, 0)).toBe('M 0 0 L 10 0')
    expect(toSmoothPath([0, 0, 10, 0, 20, 10], 0, 0)).toContain('Q')
  })
  it('rejects tiny strokes', () => {
    expect(isTinyStroke({ x: 0, y: 0, w: 1, h: 1 }, 2)).toBe(true)
    expect(isTinyStroke({ x: 0, y: 0, w: 2, h: 2 }, 2)).toBe(true)
    expect(isTinyStroke({ x: 0, y: 0, w: 40, h: 1 }, 2)).toBe(false)
  })
})

describe('schema line/ink props', () => {
  it('accepts even point lists and rejects odd', () => {
    const ok = validateObject({ id: 'l1', type: 'line', parentId: null, index: 'a0', x: 0, y: 0, w: 10, h: 2, props: { points: [0, 0, 10, 0] } })
    expect(ok.ok).toBe(true)
    const ink = validateObject({ id: 'i1', type: 'ink', parentId: null, index: 'a0', x: 0, y: 0, w: 10, h: 10, props: { points: [0, 0, 5, 5, 10, 2], pressure: [0.5, 0.6, 0.4] } })
    expect(ink.ok).toBe(true)
    const bad = validateObject({ id: 'bad', type: 'line', parentId: null, index: 'a0', x: 0, y: 0, w: 1, h: 1, props: { points: [1, 2, 3] } })
    expect(bad.ok).toBe(false)
  })
})

describe('board line/ink lifecycle', () => {
  it('add → update points → delete; undo restores points', () => {
    const doc = new Y.Doc()
    const board = new CanvasDoc(doc)
    const undo = createUndoManager(board, me, 0)
    const b = lineFromEndpoints(0, 0, 80, 40)
    const [id] = board.add([{ type: 'line', x: b.x, y: b.y, w: b.w, h: b.h, props: { points: b.points } }], me)
    expect(readPoints(board.get(id!)!.props).length).toBe(4)

    const inkAbs = [0, 0, 10, 5, 20, 0, 30, 8]
    const ib = strokeBounds(inkAbs)
    const [inkId] = board.add([{ type: 'ink', x: ib.x, y: ib.y, w: ib.w, h: ib.h, props: { points: ib.points } }], me)
    undo.stopCapturing()

    const grown = lineFromEndpoints(0, 0, 120, 40)
    board.update(id!, { x: grown.x, y: grown.y, w: grown.w, h: grown.h, props: { points: grown.points } }, me)
    undo.stopCapturing()
    expect(readPoints(board.get(id!)!.props)).toEqual(grown.points)

    board.delete([id!], me)
    undo.stopCapturing()
    expect(board.get(id!)).toBeUndefined()

    undo.undo() // restore line
    expect(board.get(id!)).toBeDefined()
    expect(readPoints(board.get(id!)!.props)).toEqual(grown.points)

    undo.undo() // revert point update
    expect(readPoints(board.get(id!)!.props)).toEqual(b.points)

    // ink still present
    expect(readPoints(board.get(inkId!)!.props)).toEqual(ib.points)
    const abs = localToAbs(readPoints(board.get(inkId!)!.props), board.get(inkId!)!.x, board.get(inkId!)!.y)
    expect(abs[0]).toBeCloseTo(0, 5)
  })

  it('resize scales stroke points while pinning the opposite corner', () => {
    const board = new CanvasDoc()
    const b = strokeBounds([0, 0, 100, 0, 100, 50], 0)
    const [id] = board.add([{ type: 'ink', x: b.x, y: b.y, w: b.w, h: b.h, props: { points: b.points } }], me)
    const o = board.get(id!)!
    const box = { x: o.x, y: o.y, w: o.w, h: o.h }
    const next = resizeRotated(box, 0, 'se', 50, 25, 1)
    const scaled = scaleLocalPoints(readPoints(o.props), box, next)
    board.update(id!, { ...next, props: { points: scaled } }, me)
    const after = board.get(id!)!
    expect(after.w).toBeCloseTo(150, 5)
    expect(after.h).toBeCloseTo(75, 5)
    expect(readPoints(after.props)[2]).toBeCloseTo(150, 5)
  })
})

describe('tiny stroke rollback', () => {
  it('rolls back a discarded tiny stroke via undo stack', () => {
    const board = new CanvasDoc()
    const undo = createUndoManager(board, me, 0)
    const before = undo.undoStack.length
    const b = lineFromEndpoints(5, 5, 5, 5) // zero-length → tiny after pad
    const [id] = board.add([{ type: 'line', x: b.x, y: b.y, w: b.w, h: b.h, props: { points: b.points } }], me)
    undo.stopCapturing()
    expect(board.get(id!)).toBeDefined()
    expect(isTinyStroke(board.get(id!)!, readPoints(board.get(id!)!.props).length / 2)).toBe(true)
    while (undo.undoStack.length > before) undo.undo()
    expect(board.get(id!)).toBeUndefined()
    expect(undo.undoStack.length).toBe(before)
  })
})
