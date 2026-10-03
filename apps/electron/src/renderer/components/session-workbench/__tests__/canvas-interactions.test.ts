import { describe, expect, test } from 'bun:test'
import { canvasCenter, canvasMenuPosition, centeredNodePosition, menuFocusIndex, nearestFreeNodePosition } from '../canvas-interactions'

describe('canvas creation coordinates', () => {
  test('centers in the canvas after accounting for left navigation and top chrome', () => {
    const client = canvasCenter({ left: 304, top: 112, width: 800, height: 600 })
    expect(client).toEqual({ x: 704, y: 412 })
    // React Flow screenToFlowPosition removes the canvas offset and pan, then zoom.
    const flow = { x: (client.x - 304 - 60) / 0.5, y: (client.y - 112 + 40) / 0.5 }
    const node = centeredNodePosition(flow, { width: 224, height: 120 })
    expect(node).toEqual({ x: 568, y: 620 })
    expect({ x: node.x + 112, y: node.y + 60 }).toEqual(flow)
  })

  test('menu clamping never alters the point where the user requested a node', () => {
    const point = { x: 1098, y: 698 }
    expect(canvasMenuPosition(point, { left: 300, top: 100, width: 800, height: 600 }, { width: 208, height: 320 }))
      .toEqual({ left: 584, top: 272 })
    expect(point).toEqual({ x: 1098, y: 698 })
  })

  test('menus stay anchored inside a viewport smaller than their full contents', () => {
    expect(canvasMenuPosition({ x: 160, y: 190 }, { left: 100, top: 100, width: 100, height: 120 }, { width: 208, height: 320 }))
      .toEqual({ left: 8, top: 8 })
  })
})

describe('toolbar node placement', () => {
  const bounds = { x: 0, y: 0, width: 900, height: 600 }
  const size = { width: 224, height: 120 }
  const center = { x: 450, y: 300 }

  test('uses the viewport center when it is free', () => {
    expect(nearestFreeNodePosition(center, size, [], bounds)).toEqual({ x: 338, y: 240 })
  })

  test('repeated additions use the closest free row and never overlap', () => {
    const boxes: Array<{ x: number; y: number; width: number; height: number }> = []
    for (let count = 0; count < 7; count++) {
      const position = nearestFreeNodePosition(center, size, boxes, bounds)
      expect(position).not.toBeNull()
      if (!position) throw new Error('expected room for another node')
      expect(position.x).toBeGreaterThanOrEqual(bounds.x)
      expect(position.y).toBeGreaterThanOrEqual(bounds.y)
      expect(position.x + size.width).toBeLessThanOrEqual(bounds.width)
      expect(position.y + size.height).toBeLessThanOrEqual(bounds.height)
      for (const box of boxes) {
        expect(position.x + size.width + 24 <= box.x || box.x + box.width + 24 <= position.x || position.y + size.height + 24 <= box.y || box.y + box.height + 24 <= position.y).toBe(true)
      }
      boxes.push({ ...position, ...size })
    }
    expect(boxes[1]).toMatchObject({ x: 338, y: 96 })
  })

  test('handles different sticker/scene sizes and negative coordinates after pan/zoom', () => {
    const viewport = { x: -500, y: -300, width: 700, height: 500 }
    const scene = { x: -220, y: -100, width: 260, height: 96 }
    const sticker = { width: 180, height: 120 }
    const position = nearestFreeNodePosition({ x: -150, y: -50 }, sticker, [scene], viewport)
    expect(position).not.toBeNull()
    if (!position) throw new Error('expected free space')
    expect(position.x).toBeGreaterThanOrEqual(-500)
    expect(position.x + sticker.width).toBeLessThanOrEqual(200)
    expect(position.y).toBeGreaterThanOrEqual(-300)
    expect(position.y + sticker.height).toBeLessThanOrEqual(200)
    expect(position.y + sticker.height + 24 <= scene.y || position.y >= scene.y + scene.height + 24).toBe(true)
  })

  test('does not consider offscreen boxes occupied viewport space', () => {
    expect(nearestFreeNodePosition(center, size, [{ x: 2000, y: 2000, width: 500, height: 500 }], bounds)).toEqual({ x: 338, y: 240 })
  })

  test('reports a full or smaller-than-node viewport instead of overlapping nodes', () => {
    expect(nearestFreeNodePosition(center, size, [bounds], bounds)).toBeNull()
    expect(nearestFreeNodePosition(center, size, [], { x: 0, y: 0, width: 100, height: 80 })).toBeNull()
  })
})

describe('canvas menu keyboard navigation', () => {
  test('supports arrows, wrapping, Home and End while leaving typing alone', () => {
    expect(menuFocusIndex('ArrowDown', -1, 7)).toBe(0)
    expect(menuFocusIndex('ArrowDown', 6, 7)).toBe(0)
    expect(menuFocusIndex('ArrowUp', 0, 7)).toBe(6)
    expect(menuFocusIndex('Home', 4, 7)).toBe(0)
    expect(menuFocusIndex('End', 4, 7)).toBe(6)
    expect(menuFocusIndex('a', 4, 7)).toBeNull()
    expect(menuFocusIndex('ArrowDown', 0, 0)).toBeNull()
  })
})
