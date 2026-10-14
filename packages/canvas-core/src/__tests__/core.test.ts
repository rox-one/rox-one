import { describe, expect, test } from 'bun:test'
import { appendFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as Y from 'yjs'
import { actorOrigin, CanvasDoc, CanvasValidationError, createUndoManager, isValidIndexKey, keyBetween, keysBetween, OBJECT_TYPES, validateObject, type Origin } from '../index.ts'
import { CanvasFileStore } from '../node/index.ts'

const me: Origin = actorOrigin('user', 'u1')
const shape = (x = 0) => ({ type: 'shape', x, y: 0, w: 10, h: 10, props: { kind: 'rect' } })

describe('fractional index', () => {
  test('ordering holds over many random inserts', () => {
    const keys: string[] = []
    for (let i = 0; i < 2000; i++) {
      const pos = Math.floor(Math.random() * (keys.length + 1))
      const k = keyBetween(keys[pos - 1] ?? null, keys[pos] ?? null)
      expect(isValidIndexKey(k)).toBe(true)
      if (pos > 0) expect(k > keys[pos - 1]!).toBe(true)
      if (pos < keys.length) expect(k < keys[pos]!).toBe(true)
      keys.splice(pos, 0, k)
    }
  })
  test('rejects bad bounds', () => {
    expect(() => keyBetween('b', 'a')).toThrow()
    expect(() => keyBetween('a00', null)).toThrow()
  })
  test('keysBetween is increasing', () => {
    const ks = keysBetween('a0', 'a1', 50)
    expect([...ks].sort()).toEqual(ks)
  })
})

describe('schema', () => {
  test('covers parity types and preserves unknown types', () => {
    expect(OBJECT_TYPES).toContain('connector')
    const r = validateObject({ id: 'x', type: 'future-thing', parentId: null, index: 'a0', x: 0, y: 0, w: 1, h: 1, props: { a: 1 } })
    expect(r.ok && r.unknownType).toBe(true)
  })
  test('validates type props', () => {
    const r = validateObject({ id: 'x', type: 'ink', parentId: null, index: 'a0', x: 0, y: 0, w: 1, h: 1, props: { points: [1, 2, 3] } })
    expect(r.ok).toBe(false)
  })
})

describe('CanvasDoc', () => {
  test('add/list/update/delete with z-order and children', () => {
    const b = new CanvasDoc()
    b.init({ title: 'T' })
    const [f] = b.add([{ type: 'frame', x: 0, y: 0, w: 100, h: 100 }], me)
    const [a, c] = b.add([{ ...shape(1), parentId: f }, { ...shape(2), parentId: f }], me)
    expect(b.list().map(o => o.id)).toEqual([f!, a!, c!])
    b.reorder(a!, 'front', me)
    expect(b.list().map(o => o.id)).toEqual([f!, c!, a!])
    b.update(a!, { x: 50, props: { kind: 'ellipse' } }, me)
    expect(b.get(a!)!.x).toBe(50)
    expect(b.get(a!)!.props.kind).toBe('ellipse')
    expect(() => b.update(f!, { parentId: a! }, me)).toThrow(CanvasValidationError)
    expect(b.delete([f!], me).length).toBe(3)
    expect(b.list()).toEqual([])
  })
  test('rejects invalid input', () => {
    const b = new CanvasDoc()
    expect(() => b.add([{ type: 'shape', x: NaN, y: 0, w: 1, h: 1, props: { kind: 'rect' } }], me)).toThrow()
    expect(() => b.add([{ ...shape(), parentId: 'missing' }], me)).toThrow()
  })
  test('text merges concurrently', () => {
    const d1 = new Y.Doc(), d2 = new Y.Doc()
    const b1 = new CanvasDoc(d1), b2 = new CanvasDoc(d2)
    const [id] = b1.add([{ type: 'sticky', x: 0, y: 0, w: 1, h: 1, props: { text: 'ab' } }], me)
    Y.applyUpdate(d2, Y.encodeStateAsUpdate(d1))
    b1.textOf(id!)!.insert(0, 'X')
    b2.textOf(id!)!.insert(2, 'Y')
    Y.applyUpdate(d2, Y.encodeStateAsUpdate(d1)); Y.applyUpdate(d1, Y.encodeStateAsUpdate(d2))
    expect(b1.get(id!)!.props.text).toBe(b2.get(id!)!.props.text as string)
    expect(b1.get(id!)!.props.text).toBe('XabY')
  })
  test('undo only touches own edits', () => {
    const other: Origin = actorOrigin('agent', 's')
    const b = new CanvasDoc()
    const um = createUndoManager(b, me, 0)
    b.add([shape(1)], me)
    b.add([shape(2)], other)
    um.undo()
    expect(b.list().map(o => o.x)).toEqual([2])
  })
})

describe('CanvasFileStore', () => {
  test('persists, reloads, compacts and soft-deletes', async () => {
    const root = mkdtempSync(join(tmpdir(), 'canvas-'))
    const s1 = new CanvasFileStore(root)
    const { id } = await s1.createBoard('Plan')
    const b = await s1.openBoard(id)
    for (let i = 0; i < 250; i++) b.add([shape(i)], me)
    b.setTitle('Plan 2', me)
    await s1.flush(id)
    await s1.dispose() // one store per workspace: a second one in-process is refused
    const s2 = new CanvasFileStore(root)
    const b2 = await s2.openBoard(id)
    expect(b2.list().length).toBe(250)
    expect((await s2.listBoards())[0]!.title).toBe('Plan 2')
    await s2.dispose()
    await s1.trashBoard(id)
    expect(await s1.listBoards()).toEqual([])
    await expect(s1.openBoard('../x')).rejects.toThrow()
  })
})

describe('review fixes', () => {
  test('schema rejects bad index keys; tolerant of bad remote keys', () => {
    expect(validateObject({ id: 'x', type: 'shape', parentId: null, index: 'a00', x: 0, y: 0, w: 1, h: 1, props: { kind: 'rect' } }).ok).toBe(false)
    const b = new CanvasDoc()
    const [a] = b.add([shape(1)], me)
    // Simulate a malformed key arriving from a remote peer.
    b.objects.get(a!)!.set('index', '!!bad')
    const [c] = b.add([shape(2)], me)
    expect(isValidIndexKey(b.get(c!)!.index)).toBe(true)
    b.reorder(c!, 'back', me)
    b.update(a!, { x: 5 }, me) // repairs the bad key instead of throwing
    expect(isValidIndexKey(b.get(a!)!.index)).toBe(true)
  })
  test('update rejects unknown parent', () => {
    const b = new CanvasDoc()
    const [a] = b.add([shape()], me)
    expect(() => b.update(a!, { parentId: 'nope' }, me)).toThrow(CanvasValidationError)
  })
  test('text update applies a minimal diff (concurrent edit elsewhere survives)', () => {
    const d1 = new Y.Doc(), d2 = new Y.Doc()
    const b1 = new CanvasDoc(d1), b2 = new CanvasDoc(d2)
    const [id] = b1.add([{ type: 'sticky', x: 0, y: 0, w: 1, h: 1, props: { text: 'hello world' } }], me)
    Y.applyUpdate(d2, Y.encodeStateAsUpdate(d1))
    b1.update(id!, { props: { text: 'hello brave world' } }, me)
    b2.textOf(id!)!.insert(11, '!')
    Y.applyUpdate(d2, Y.encodeStateAsUpdate(d1)); Y.applyUpdate(d1, Y.encodeStateAsUpdate(d2))
    expect(b1.get(id!)!.props.text).toBe('hello brave world!')
    expect(b2.get(id!)!.props.text).toBe('hello brave world!')
  })
  test('delete detaches connectors at the last position', () => {
    const b = new CanvasDoc()
    const [s1, s2] = b.add([{ ...shape(0), w: 10, h: 20 }, shape(100)], me)
    const [c] = b.add([{ type: 'connector', x: 0, y: 0, w: 0, h: 0, props: { from: { objectId: s1! }, to: { objectId: s2! } } }], me)
    b.delete([s1!], me)
    expect(b.get(c!)!.props.from).toEqual({ x: 5, y: 10 })
    expect((b.get(c!)!.props.to as { objectId: string }).objectId).toBe(s2!)
  })
})

describe('file store review fixes', () => {
  test('concurrent openBoard returns one doc', async () => {
    const root = mkdtempSync(join(tmpdir(), 'canvas-'))
    const s = new CanvasFileStore(root)
    const { id } = await s.createBoard('A')
    const [a, b] = await Promise.all([s.openBoard(id), s.openBoard(id)])
    expect(a).toBe(b)
  })
  test('corrupt index.json is rebuilt from snapshots', async () => {
    const root = mkdtempSync(join(tmpdir(), 'canvas-'))
    const s = new CanvasFileStore(root, { onError: () => {} })
    const { id } = await s.createBoard('Rebuilt')
    writeFileSync(join(root, 'canvas', 'index.json'), '{not json')
    const list = await s.listBoards()
    expect(list.map(x => [x.id, x.title])).toEqual([[id, 'Rebuilt']])
    await s.createBoard('Second') // index writes keep working
    expect((await s.listBoards()).length).toBe(2)
  })
  test('a failed write does not stop later saves; dirty board is re-snapshotted', async () => {
    const root = mkdtempSync(join(tmpdir(), 'canvas-'))
    const errors: string[] = []
    const s = new CanvasFileStore(root, { onError: (_e, c) => errors.push(c.op) })
    const { id } = await s.createBoard('F')
    const b = await s.openBoard(id)
    const logPath = join(root, 'canvas', `${id}.log`)
    mkdirSync(logPath) // appendFile on a directory fails
    b.add([shape(1)], me)
    await expect(s.flush(id)).rejects.toThrow()
    expect(errors).toContain('persist')
    rmSync(logPath, { recursive: true })
    b.add([shape(2)], me) // next update triggers a full snapshot
    await s.flush(id)
    await s.dispose()
    const reopened = await new CanvasFileStore(root).openBoard(id)
    expect(reopened.list().length).toBe(2)
  })
})

describe('re-review fixes', () => {
  test('add() is all-or-nothing', () => {
    const b = new CanvasDoc()
    expect(() => b.add([shape(1), { type: 'shape', x: NaN, y: 0, w: 1, h: 1, props: { kind: 'rect' } }], me)).toThrow()
    expect(b.list()).toEqual([])
  })
  test('add() orders a batch and accepts parents from the same batch', () => {
    const b = new CanvasDoc()
    const ids = b.add([{ id: 'f', type: 'frame', x: 0, y: 0, w: 1, h: 1 }, { ...shape(1), parentId: 'f' }, { ...shape(2), parentId: 'f' }], me)
    expect(b.list().map(o => o.id)).toEqual(ids)
  })
  test('style merges per key across peers', () => {
    const d1 = new Y.Doc(), d2 = new Y.Doc()
    const b1 = new CanvasDoc(d1), b2 = new CanvasDoc(d2)
    const [id] = b1.add([{ ...shape(), style: { fill: { type: 'solid', color: 'a' } } }], me)
    Y.applyUpdate(d2, Y.encodeStateAsUpdate(d1))
    b1.update(id!, { style: { fill: { type: 'solid', color: 'b' } } }, me)
    b2.update(id!, { style: { stroke: { color: 'c', width: 2 } } }, me)
    Y.applyUpdate(d2, Y.encodeStateAsUpdate(d1)); Y.applyUpdate(d1, Y.encodeStateAsUpdate(d2))
    expect(b1.get(id!)!.style).toEqual({ fill: { type: 'solid', color: 'b' }, stroke: { color: 'c', width: 2 } })
    expect(b2.get(id!)!.style).toEqual(b1.get(id!)!.style)
  })
  test('actorOrigin is memoized', () => {
    expect(actorOrigin('user', 'z')).toBe(actorOrigin('user', 'z'))
  })
})

describe('file store re-review fixes', () => {
  const fresh = async () => {
    const root = mkdtempSync(join(tmpdir(), 'canvas-'))
    const errors: string[] = []
    const s = new CanvasFileStore(root, { onError: (_e, c) => errors.push(c.op) })
    const { id } = await s.createBoard('B')
    return { root, s, id, errors }
  }
  test('close vs open race: the reopen sees every edit, and stale edits are forwarded', async () => {
    const { root, s, id, errors } = await fresh()
    const b = await s.openBoard(id)
    b.add([shape(1)], me)
    const closing = s.closeBoard(id)
    const reopened = s.openBoard(id)
    await closing
    const b2 = await reopened
    expect(b2).not.toBe(b)
    expect(b2.list().length).toBe(1)
    b.add([shape(2)], me) // edit on the stale doc
    expect(errors).toContain('write-after-close')
    expect(b2.list().length).toBe(2)
    await s.flush(id)
  })
  test('trash blocks a concurrent open', async () => {
    const { s, id } = await fresh()
    await s.openBoard(id)
    const trashing = s.trashBoard(id)
    const opening = s.openBoard(id)
    await trashing
    await expect(opening).rejects.toThrow()
  })
  test('corrupt log frame: good prefix kept, bad tail set aside', async () => {
    const { root, s, id, errors } = await fresh()
    const b = await s.openBoard(id)
    b.add([shape(1)], me)
    await s.flush(id)
    await s.dispose()
    appendFileSync(join(root, 'canvas', `${id}.log`), new Uint8Array([200, 0, 0, 0, 1, 2, 3]))
    const s2 = new CanvasFileStore(root, { onError: (_e, c) => errors.push(c.op) })
    const b2 = await s2.openBoard(id)
    expect(b2.list().length).toBe(1)
    expect(errors).toContain('replay-log')
    expect(readdirSync(join(root, 'canvas')).some(n => n.includes('.log.corrupt-'))).toBe(true)
    await s2.dispose()
  })
  test('lockfile: a live foreign owner blocks, a stale one is taken over', async () => {
    const { root, s } = await fresh()
    await s.dispose()
    const lock = join(root, 'canvas', '.lock')
    writeFileSync(lock, String(process.ppid)) // a live process that is not us
    await expect(new CanvasFileStore(root).createBoard('x')).rejects.toThrow(/CANVAS_LOCKED/)
    writeFileSync(lock, '999999999') // dead pid
    const s3 = new CanvasFileStore(root)
    await s3.createBoard('ok')
    expect(readFileSync(lock, 'utf8').startsWith(`${process.pid}:`)).toBe(true)
    await s3.dispose()
  })
})
