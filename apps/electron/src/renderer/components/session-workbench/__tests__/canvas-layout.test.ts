import { describe, expect, test } from 'bun:test'
import {
  alignBoxes,
  canvasNodeStatus,
  canvasStatusClass,
  distributeBoxes,
  guidesFromBoxes,
  keyboardConnectTarget,
  magneticPorts,
  snapPosition,
  tileBoxes,
  withinPerformanceBudget,
} from '../canvas-layout'

const boxes = [
  { id: 'a', x: 0, y: 10, width: 100, height: 40 },
  { id: 'b', x: 80, y: 90, width: 100, height: 40 },
  { id: 'c', x: 240, y: 40, width: 80, height: 40 },
]

describe('session canvas layout', () => {
  test('align / distribute / tile keep node ids', () => {
    expect(alignBoxes(boxes, 'left').every((box) => box.x === 0)).toBe(true)
    expect(alignBoxes(boxes, 'top').every((box) => box.y === 10)).toBe(true)
    const distributed = distributeBoxes(boxes, 'horizontal')
    expect(distributed.map((box) => box.id)).toEqual(['a', 'b', 'c'])
    expect(distributed[1]!.x).toBe(120)
    expect(tileBoxes(boxes, { cols: 2, origin: { x: 10, y: 10 } })[2]!.y).toBeGreaterThan(10)
  })

  test('smart guides, magnetic arrows and keyboard connection', () => {
    const snapped = snapPosition({ x: 82, y: 88 }, guidesFromBoxes(boxes, 'a'))
    expect(snapped.x).toBe(80)
    expect(magneticPorts(boxes[0]!, boxes[2]!)).toEqual({ fromSide: 'right', toSide: 'left' })
    expect(keyboardConnectTarget('a', 'right', boxes)).toBe('b')
    expect(keyboardConnectTarget('a', 'left', boxes)).toBe(null)
  })

  test('run/wait/error/selected baselines stay within the performance budget', () => {
    expect(canvasNodeStatus({ toolStatus: 'pending' })).toBe('waiting')
    expect(canvasNodeStatus({ streaming: true })).toBe('running')
    expect(canvasNodeStatus({ toolStatus: 'error' })).toBe('error')
    expect(canvasNodeStatus({ selected: true })).toBe('selected')
    expect(canvasStatusClass('running', 'light')).toBe('rox-canvas-node is-running theme-light')
    expect(canvasStatusClass('idle', 'dark')).toContain('theme-dark')
    expect(withinPerformanceBudget(12)).toBe(true)
    expect(withinPerformanceBudget(401)).toBe(false)
  })
})
