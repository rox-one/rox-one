import { describe, expect, it } from 'bun:test'
import * as Y from 'yjs'
import { actorOrigin, CanvasDoc, createUndoManager, type CanvasObject } from '@rox/canvas-core'
import {
  applicableFields, applyStyleField, colorForPicker, commonStyle, normalizeColorInput, patchForField, readField, visibleFields,
} from '../style-model'

const me = actorOrigin('user', 'style-inspector')

function boardWith(...inputs: Array<Parameters<CanvasDoc['add']>[0][number]>) {
  const doc = new Y.Doc()
  const board = new CanvasDoc(doc)
  const ids = board.add(inputs, me)
  return { board, ids, doc }
}

describe('style-model applicable fields', () => {
  it('exposes fill/stroke/radius for rects and font for text/sticky', () => {
    const rect = { id: 'r', type: 'shape', parentId: null, index: 'a0', x: 0, y: 0, w: 10, h: 10, props: { kind: 'rect' } } as CanvasObject
    const ell = { ...rect, id: 'e', props: { kind: 'ellipse' } }
    const text = { id: 't', type: 'text', parentId: null, index: 'a0', x: 0, y: 0, w: 10, h: 10, props: { text: '' } } as CanvasObject
    const line = { id: 'l', type: 'line', parentId: null, index: 'a0', x: 0, y: 0, w: 10, h: 2, props: { points: [0, 0, 10, 0] } } as CanvasObject
    expect(applicableFields(rect).has('cornerRadius')).toBe(true)
    expect(applicableFields(ell).has('cornerRadius')).toBe(false)
    expect(applicableFields(text).has('fontSize')).toBe(true)
    expect(applicableFields(line).has('fill')).toBe(false)
    expect(applicableFields(line).has('strokeWidth')).toBe(true)
  })
})

describe('style-model common / mixed', () => {
  it('reports shared values and mixed when they diverge', () => {
    const { board, ids } = boardWith(
      { type: 'shape', x: 0, y: 0, w: 40, h: 40, props: { kind: 'rect' }, style: { fill: { type: 'solid', color: '#ff0000' }, stroke: { color: '#000', width: 2 } }, opacity: 1 },
      { type: 'shape', x: 50, y: 0, w: 40, h: 40, props: { kind: 'rect' }, style: { fill: { type: 'solid', color: '#ff0000' }, stroke: { color: '#000', width: 4 } }, opacity: 0.5 },
    )
    const objs = ids.map(id => board.get(id)!)
    const c = commonStyle(objs)
    expect(c.fill).toEqual({ state: 'value', value: '#ff0000' })
    expect(c.strokeWidth).toEqual({ state: 'mixed' })
    expect(c.opacity).toEqual({ state: 'mixed' })
    expect(c.stroke).toEqual({ state: 'value', value: '#000' })
    expect(visibleFields(objs)).toContain('fill')
    expect(visibleFields(objs)).toContain('cornerRadius')
  })

  it('leaves untouched fields alone when applying a mixed-selection set', () => {
    const { board, ids } = boardWith(
      { type: 'shape', x: 0, y: 0, w: 40, h: 40, props: { kind: 'rect' }, style: { fill: { type: 'solid', color: '#111111' }, stroke: { color: '#aaa', width: 1 } } },
      { type: 'shape', x: 50, y: 0, w: 40, h: 40, props: { kind: 'rect' }, style: { fill: { type: 'solid', color: '#222222' }, stroke: { color: '#bbb', width: 3 } } },
    )
    applyStyleField(board, ids, 'opacity', 0.25, me)
    const a = board.get(ids[0]!)!, b = board.get(ids[1]!)!
    expect(a.opacity).toBe(0.25)
    expect(b.opacity).toBe(0.25)
    // fills stay divergent until the user sets them
    expect(readField(a, 'fill')).toBe('#111111')
    expect(readField(b, 'fill')).toBe('#222222')
    expect(commonStyle([a, b]).fill.state).toBe('mixed')
  })
})

describe('style-model apply / merge', () => {
  it('merges stroke color without clobbering width, and undoes', () => {
    const { board, ids } = boardWith(
      { type: 'line', x: 0, y: 0, w: 20, h: 2, props: { points: [0, 1, 20, 1] }, style: { stroke: { color: '#000000', width: 5 } } },
    )
    const undo = createUndoManager(board, me, 0)
    const id = ids[0]!
    applyStyleField(board, [id], 'stroke', '#ff00aa', me)
    const o = board.get(id)!
    expect(o.style.stroke?.color).toBe('#ff00aa')
    expect(o.style.stroke?.width).toBe(5)
    undo.undo()
    expect(board.get(id)!.style.stroke?.color).toBe('#000000')
    expect(board.get(id)!.style.stroke?.width).toBe(5)
  })

  it('writes solid fill, corner radius, font size/weight', () => {
    const { board, ids } = boardWith(
      { type: 'shape', x: 0, y: 0, w: 80, h: 60, props: { kind: 'rect' } },
      { type: 'sticky', x: 100, y: 0, w: 120, h: 80, props: { text: 'hi' } },
    )
    const [shapeId, stickyId] = ids
    applyStyleField(board, [shapeId!], 'fill', '#abcdef', me)
    applyStyleField(board, [shapeId!], 'cornerRadius', 12, me)
    applyStyleField(board, [stickyId!], 'fontSize', 18, me)
    applyStyleField(board, [stickyId!], 'fontWeight', 700, me)
    const shape = board.get(shapeId!)!
    const sticky = board.get(stickyId!)!
    expect(shape.style.fill).toEqual({ type: 'solid', color: '#abcdef' })
    expect(shape.props.radius).toBe(12)
    expect(sticky.style.font?.size).toBe(18)
    expect(sticky.style.font?.weight).toBe(700)
    // cornerRadius does not apply to sticky
    expect(patchForField(sticky, 'cornerRadius', 4)).toBeNull()
    expect(applyStyleField(board, [stickyId!], 'cornerRadius', 4, me)).toBe(0)
  })


  it('stroke edit does not rewrite fill (narrow style patch)', () => {
    const { board, ids } = boardWith(
      { type: 'shape', x: 0, y: 0, w: 40, h: 40, props: { kind: 'rect' }, style: { fill: { type: 'solid', color: '#abcdef' }, stroke: { color: '#000', width: 2 } } },
    )
    applyStyleField(board, ids, 'strokeWidth', 8, me)
    const o = board.get(ids[0]!)!
    expect(o.style.fill).toEqual({ type: 'solid', color: '#abcdef' })
    expect(o.style.stroke?.width).toBe(8)
    expect(o.style.stroke?.color).toBe('#000')
  })

  it('skips locked objects and inapplicable types in a mixed selection', () => {
    const { board, ids } = boardWith(
      { type: 'shape', x: 0, y: 0, w: 40, h: 40, props: { kind: 'rect' } },
      { type: 'line', x: 0, y: 50, w: 40, h: 2, props: { points: [0, 1, 40, 1] }, style: { stroke: { color: '#000', width: 2 } } },
    )
    board.update(ids[0]!, { locked: true }, me)
    // fill only applies to the (locked) shape → 0 patches
    expect(applyStyleField(board, ids, 'fill', '#fff', me)).toBe(0)
    // stroke applies to the unlocked line
    expect(applyStyleField(board, ids, 'stroke', '#0f0', me)).toBe(1)
    expect(board.get(ids[1]!)!.style.stroke?.color).toBe('#0f0')
  })
})


  it('rejects url()/breakout colors on fill and stroke', () => {
    const { board, ids } = boardWith(
      { type: 'shape', x: 0, y: 0, w: 40, h: 40, props: { kind: 'rect' } },
    )
    expect(applyStyleField(board, ids, 'fill', 'url(https://evil.example)', me)).toBe(0)
    expect(applyStyleField(board, ids, 'stroke', 'red; } * {', me)).toBe(0)
    expect(board.get(ids[0]!)!.style.fill).toBeUndefined()
  })

  it('clamps strokeWidth / fontSize / cornerRadius to inspector maxima', () => {
    const { board, ids } = boardWith(
      { type: 'shape', x: 0, y: 0, w: 40, h: 40, props: { kind: 'rect' } },
      { type: 'text', x: 50, y: 0, w: 40, h: 20, props: { text: 'x' } },
    )
    applyStyleField(board, [ids[0]!], 'strokeWidth', 999, me)
    applyStyleField(board, [ids[0]!], 'cornerRadius', 999, me)
    applyStyleField(board, [ids[1]!], 'fontSize', 9999, me)
    expect(board.get(ids[0]!)!.style.stroke?.width).toBe(64)
    expect(board.get(ids[0]!)!.props.radius).toBe(200)
    expect(board.get(ids[1]!)!.style.font?.size).toBe(400)
  })

  it('skips locked targets so an all-locked selection is a no-op', () => {
    const { board, ids } = boardWith(
      { type: 'shape', x: 0, y: 0, w: 40, h: 40, props: { kind: 'rect' } },
    )
    board.update(ids[0]!, { locked: true }, me)
    expect(applyStyleField(board, ids, 'opacity', 0.2, me)).toBe(0)
    expect(board.get(ids[0]!)!.opacity).toBe(1)
  })

describe('normalizeColorInput', () => {
  it('accepts hex and named colors', () => {
    expect(normalizeColorInput('#abc')).toBe('#abc')
    expect(normalizeColorInput('  #a1b2c3 ')).toBe('#a1b2c3')
    expect(normalizeColorInput('currentColor')).toBe('currentColor')
    expect(normalizeColorInput('')).toBeNull()
    expect(normalizeColorInput('not a color!')).toBeNull()
    expect(normalizeColorInput('url(https://x)')).toBeNull()
  })

  it('expands #rgb for the native color picker', () => {
    expect(colorForPicker('#abc')).toBe('#aabbcc')
    expect(colorForPicker('#AABBCC')).toBe('#aabbcc')
    expect(colorForPicker('red')).toBe('#888888')
    expect(colorForPicker(undefined)).toBe('#888888')
  })
})
