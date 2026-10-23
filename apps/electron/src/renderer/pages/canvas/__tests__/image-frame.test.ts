import { describe, expect, it } from 'bun:test'
import { actorOrigin, CanvasDoc, validateObject } from '@rox/canvas-core'
import { applicableFields } from '../style-model'
import {
  childrenByParent, collectDescendantIds, defaultImageBox, frameClips, imagePreserveAspectRatio, nestParentId,
  readFrameLabel, readImageFit,
} from '../image-frame'

const me = actorOrigin('user', 'image-frame')

describe('image-frame helpers', () => {
  it('maps object-fit to SVG preserveAspectRatio', () => {
    expect(imagePreserveAspectRatio('contain')).toBe('xMidYMid meet')
    expect(imagePreserveAspectRatio('cover')).toBe('xMidYMid slice')
    expect(imagePreserveAspectRatio('fill')).toBe('none')
    expect(imagePreserveAspectRatio(undefined)).toBe('xMidYMid meet')
    expect(readImageFit({ fit: 'cover' })).toBe('cover')
    expect(readImageFit({})).toBe('contain')
  })

  it('sizes images to a max box keeping aspect', () => {
    expect(defaultImageBox(960, 480, 480)).toEqual({ w: 480, h: 240 })
    expect(defaultImageBox(100, 100, 480)).toEqual({ w: 100, h: 100 })
  })

  it('nests under a single selected unlocked frame', () => {
    const board = new CanvasDoc()
    const [fid] = board.add([{ type: 'frame', x: 0, y: 0, w: 100, h: 100, props: { clip: true } }], me)
    const [sid] = board.add([{ type: 'shape', x: 0, y: 0, w: 10, h: 10, props: { kind: 'rect' } }], me)
    const frame = board.get(fid!)!
    const shape = board.get(sid!)!
    expect(nestParentId([frame])).toBe(fid!)
    expect(nestParentId([frame, shape])).toBeNull()
    expect(nestParentId([shape])).toBeNull()
    expect(frameClips(frame)).toBe(true)
    expect(readFrameLabel(frame, 'Frame')).toBe('Frame')
    board.update(fid!, { name: 'Hero' }, me)
    expect(readFrameLabel(board.get(fid!)!, 'Frame')).toBe('Hero')
  })


  it('collectDescendantIds walks nested parents', () => {
    const board = new CanvasDoc()
    const [fid] = board.add([{ type: 'frame', x: 0, y: 0, w: 100, h: 100, props: { clip: true } }], me)
    const [mid] = board.add([{ type: 'frame', x: 5, y: 5, w: 40, h: 40, parentId: fid!, props: { clip: false } }], me)
    const [cid] = board.add([{ type: 'shape', x: 6, y: 6, w: 10, h: 10, parentId: mid!, props: { kind: 'rect' } }], me)
    expect(collectDescendantIds(board.list(), fid!).sort()).toEqual([mid!, cid!].sort())
    expect(collectDescendantIds(board.list(), mid!)).toEqual([cid!])
    expect(collectDescendantIds(board.list(), cid!)).toEqual([])
  })

  it('groups children by parent for tree render', () => {
    const board = new CanvasDoc()
    const [fid] = board.add([{ type: 'frame', x: 0, y: 0, w: 100, h: 100, props: { clip: true } }], me)
    const [a] = board.add([{ type: 'shape', x: 1, y: 1, w: 10, h: 10, parentId: fid!, props: { kind: 'rect' } }], me)
    const [b] = board.add([{ type: 'text', x: 2, y: 2, w: 20, h: 20, props: { text: 'hi' } }], me)
    const map = childrenByParent(board.list())
    expect(map.get(null)!.map(o => o.id).sort()).toEqual([b!, fid!].sort())
    expect(map.get(fid!)!.map(o => o.id)).toEqual([a!])
  })
})

describe('style inspector + schema smoke', () => {
  it('exposes fill/stroke for frames and stroke for images', () => {
    const board = new CanvasDoc()
    const [fid] = board.add([{ type: 'frame', x: 0, y: 0, w: 40, h: 40, props: { clip: true } }], me)
    const hash = 'c'.repeat(64)
    const [iid] = board.add([{ type: 'image', x: 0, y: 0, w: 40, h: 40, props: { assetId: hash, fit: 'contain' } }], me)
    const f = applicableFields(board.get(fid!)!)
    expect(f.has('fill')).toBe(true)
    expect(f.has('cornerRadius')).toBe(true)
    const i = applicableFields(board.get(iid!)!)
    expect(i.has('stroke')).toBe(true)
    expect(i.has('fill')).toBe(false)
    expect(validateObject(board.get(iid!)!).ok).toBe(true)
  })
})
