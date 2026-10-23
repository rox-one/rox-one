import { describe, expect, it, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  CanvasAssetStore, hashAssetBytes, isValidAssetHash, MAX_ASSET_BYTES, normalizeAssetMime, sanitizeAssetName,
} from '../node/asset-store.ts'
import { actorOrigin, CanvasDoc, createUndoManager, validateObject } from '../index.ts'

const me = actorOrigin('user', 'assets')

describe('asset-store', () => {
  let root: string
  beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'rox-canvas-assets-')) })
  afterEach(async () => { await rm(root, { recursive: true, force: true }) })

  it('writes content-addressed blobs and is idempotent', async () => {
    const store = new CanvasAssetStore(root)
    const bytes = new Uint8Array([137, 80, 78, 71, 1, 2, 3])
    const meta = await store.put(bytes, 'image/png', 'shot.png')
    expect(isValidAssetHash(meta.hash)).toBe(true)
    expect(meta.hash).toBe(hashAssetBytes(bytes))
    expect(meta.mime).toBe('image/png')
    expect(meta.size).toBe(bytes.byteLength)
    expect(meta.name).toBe('shot.png')
    const again = await store.put(bytes, 'image/png', 'other.png')
    expect(again.hash).toBe(meta.hash)
    const got = await store.get(meta.hash)
    expect([...got]).toEqual([...bytes])
    expect(await store.has(meta.hash)).toBe(true)
    const onDisk = await readFile(join(root, 'canvas', 'assets', meta.hash))
    expect([...onDisk]).toEqual([...bytes])
  })

  it('rejects bad mime / oversize / empty', async () => {
    const store = new CanvasAssetStore(root)
    await expect(store.put(new Uint8Array([1]), 'text/plain', 'x')).rejects.toThrow(/mime/)
    await expect(store.put(new Uint8Array(0), 'image/png', 'x')).rejects.toThrow(/empty/)
    await expect(store.put(new Uint8Array(MAX_ASSET_BYTES + 1), 'image/png', 'x')).rejects.toThrow(/large/)
    expect(normalizeAssetMime('image/jpg')).toBe('image/jpeg')
    expect(sanitizeAssetName('../a<b>.png')).toBe('.._a_b_.png')
  })
})

describe('schema frame/image', () => {
  it('validates frame clip/label and image assetId+fit', () => {
    const frame = validateObject({
      id: 'f1', type: 'frame', parentId: null, index: 'a0', x: 0, y: 0, w: 100, h: 80,
      props: { clip: true, label: 'Hero' },
    })
    expect(frame.ok).toBe(true)
    const image = validateObject({
      id: 'i1', type: 'image', parentId: null, index: 'a0', x: 0, y: 0, w: 40, h: 40,
      props: { assetId: 'a'.repeat(64), fit: 'contain' },
    })
    expect(image.ok).toBe(true)
    const bad = validateObject({
      id: 'bad', type: 'image', parentId: null, index: 'a0', x: 0, y: 0, w: 1, h: 1, props: {},
    })
    expect(bad.ok).toBe(false)
  })
})

describe('board frame/image lifecycle', () => {
  it('add frame with nested child → delete frame removes child; undo restores both', () => {
    const board = new CanvasDoc()
    const undo = createUndoManager(board, me, 0)
    const [fid] = board.add([{ type: 'frame', x: 0, y: 0, w: 200, h: 150, name: 'F', props: { clip: true } }], me)
    const [cid] = board.add([{ type: 'shape', x: 10, y: 10, w: 40, h: 40, parentId: fid!, props: { kind: 'rect' } }], me)
    undo.stopCapturing()
    expect(board.get(cid!)!.parentId).toBe(fid!)
    board.delete([fid!], me)
    undo.stopCapturing()
    expect(board.get(fid!)).toBeUndefined()
    expect(board.get(cid!)).toBeUndefined()
    undo.undo()
    expect(board.get(fid!)).toBeDefined()
    expect(board.get(cid!)!.parentId).toBe(fid!)
  })

  it('image add → update → delete; asset meta + undo', () => {
    const board = new CanvasDoc()
    const undo = createUndoManager(board, me, 0)
    const hash = 'b'.repeat(64)
    board.setAssetMeta(hash, { hash, mime: 'image/png', size: 12, name: 'a.png' }, me)
    const [id] = board.add([{ type: 'image', x: 0, y: 0, w: 100, h: 80, props: { assetId: hash, fit: 'contain' } }], me)
    undo.stopCapturing()
    expect(board.getAssetMeta(hash)?.mime).toBe('image/png')
    board.update(id!, { w: 200, h: 160, props: { fit: 'cover' } }, me)
    undo.stopCapturing()
    expect(board.get(id!)!.w).toBe(200)
    expect(board.get(id!)!.props.fit).toBe('cover')
    board.delete([id!], me)
    undo.stopCapturing()
    expect(board.get(id!)).toBeUndefined()
    undo.undo()
    expect(board.get(id!)!.props.assetId).toBe(hash)
    expect(board.get(id!)!.props.fit).toBe('cover')
    undo.undo()
    expect(board.get(id!)!.props.fit).toBe('contain')
  })
})
