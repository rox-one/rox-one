import { describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as Y from 'yjs'
import {
  actorOrigin, applyTextDiff, CanvasDoc, createEntityCard, createUndoManager, EntityKindRegistry, EntitySnapshotResolver,
  guardEntityCards, linkEntityCard, migrateLegacy, watchEntityLinks, type EntityCardContext, type EntityRef,
} from '../index.ts'
import { CanvasFileStore, processStartTime } from '../node/file-store.ts'

const me = actorOrigin('user', 'r4')
const shape = (x = 0) => ({ type: 'shape' as const, x, y: 0, w: 10, h: 10, props: { kind: 'rect' } })

function ctxWith(opts: { failLink?: boolean; canView?: (r: EntityRef) => boolean } = {}) {
  const links = new Map<string, { objectId: string; ref: EntityRef; mine?: boolean }>()
  const entities = new Map<string, string>()
  const registry = new EntityKindRegistry()
  registry.register({
    kind: 'note', labelKey: 'k', icon: 'N', creatable: true,
    async create({ title }) { const id = `n${entities.size + 1}`; entities.set(id, title); return { kind: 'note', id } },
    async read(r) { const t = entities.get(r.id); return t ? { title: t, preview: 'BODY' } : null },
    canView: opts.canView ? async r => opts.canView!(r) : undefined,
    open() {},
    async delete(r) { entities.delete(r.id) },
  })
  const ctx: EntityCardContext = {
    board: new CanvasDoc(), boardId: 'b', workspaceId: 'w', registry, origin: me,
    linker: {
      async link(f, ref) { if (opts.failLink) throw new Error('link down'); links.set(`${f.objectId}|${ref.kind}|${ref.id}`, { objectId: f.objectId, ref, mine: true }) },
      async unlink(f, ref) { links.delete(`${f.objectId}|${ref.kind}|${ref.id}`) },
      async list() { return [...links.values()] },
    },
  }
  return { ctx, links, entities }
}

describe('entity cards: reference-only doc, per-viewer resolution', () => {
  test('resolver checks access and never writes the doc', async () => {
    const { ctx, entities } = ctxWith({ canView: r => r.id !== 'n2' })
    entities.set('n1', 'Mine'); entities.set('n2', 'Private')
    await linkEntityCard(ctx, { kind: 'note', id: 'n1' }, { x: 0, y: 0 })
    await linkEntityCard(ctx, { kind: 'note', id: 'n2' }, { x: 0, y: 0 })
    const before = Y.encodeStateAsUpdate(ctx.board.doc)
    const r = new EntitySnapshotResolver(ctx.registry)
    expect(await r.resolve({ kind: 'note', id: 'n1' })).toEqual({ state: 'ok', snapshot: { title: 'Mine', preview: 'BODY' } })
    expect(await r.resolve({ kind: 'note', id: 'n2' })).toEqual({ state: 'forbidden' })
    expect(Y.encodeStateAsUpdate(ctx.board.doc)).toEqual(before)
    expect(new TextDecoder().decode(before).includes('Private')).toBe(false)
  })

  test('snapshot fields arriving from a remote peer are stripped', async () => {
    const { ctx } = ctxWith()
    const id = await linkEntityCard(ctx, { kind: 'note', id: 'x' }, { x: 0, y: 0 })
    const peer = new Y.Doc()
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(ctx.board.doc))
    const off = guardEntityCards(ctx.board)
    const props = peer.getMap<Y.Map<unknown>>('objects').get(id)!.get('props') as Y.Map<unknown>
    props.set('snapshot', { title: 'leak', preview: 'SECRET' })
    props.set('provenance', 'linked')
    Y.applyUpdate(ctx.board.doc, Y.encodeStateAsUpdate(peer, Y.encodeStateVector(ctx.board.doc)), { kind: 'remote' })
    expect(ctx.board.get(id)!.props).toEqual({ kind: 'note', entityId: 'x', origin: 'linked' })
    off()
  })

  test('link failure deletes the orphan entity; undo/redo cannot bring the card back', async () => {
    const { ctx, entities } = ctxWith({ failLink: true })
    const um = createUndoManager(ctx.board, me, 0)
    await expect(createEntityCard(ctx, 'note', 'Orphan', { x: 0, y: 0 })).rejects.toThrow('link down')
    expect(entities.size).toBe(0)
    expect(ctx.board.list().length).toBe(0)
    um.undo(); um.redo()
    expect(ctx.board.list().length).toBe(0)
  })

  test('links reconcile from doc state: plain delete, undo, remote delete', async () => {
    const { ctx, links } = ctxWith()
    const um = createUndoManager(ctx.board, me, 0)
    const w = watchEntityLinks(ctx, { debounceMs: 1 })
    const id = await createEntityCard(ctx, 'note', 'A', { x: 0, y: 0 })
    um.stopCapturing()
    ctx.board.delete([id], me)
    await w.idle()
    expect(links.size).toBe(0)
    um.undo()
    await w.idle()
    expect([...links.values()].map(l => l.objectId)).toEqual([id])
    const peer = new Y.Doc()
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(ctx.board.doc))
    peer.getMap('objects').delete(id)
    Y.applyUpdate(ctx.board.doc, Y.encodeStateAsUpdate(peer, Y.encodeStateVector(ctx.board.doc)), { kind: 'remote' })
    await w.idle()
    expect(links.size).toBe(0)
    w.stop()
  })
})

describe('text + migration', () => {
  test('applyTextDiff snaps to code points', () => {
    for (const [a, b] of [['a😀b', 'a😁b'], ['😀', '😀😀'], ['x😀', '😀'], ['👍🏽', '👍🏿'], ['ab', 'a😀b']] as const) {
      const d = new Y.Doc(); const t = d.getText('t'); t.insert(0, a)
      const seen: string[] = []
      d.on('update', () => seen.push(t.toString()))
      applyTextDiff(t, b)
      expect(t.toString()).toBe(b)
      for (const s of seen) expect(s).toBe(s.toWellFormed())
    }
  })

  test('concurrent legacy upgrade is deterministic: no edits lost', () => {
    const base = new CanvasDoc()
    const [id] = base.add([shape()], me)
    base.objects.get(id!)!.set('props', { kind: 'rect', text: 'hi', b: 1 })
    const state = Y.encodeStateAsUpdate(base.doc)
    const A = new CanvasDoc(), B = new CanvasDoc()
    Y.applyUpdate(A.doc, state); Y.applyUpdate(B.doc, state)
    migrateLegacy(A); migrateLegacy(B)
    ;(A.objects.get(id!)!.get('props') as Y.Map<unknown>).set('b', 2)
    ;(B.objects.get(id!)!.get('props') as Y.Map<unknown>).set('c', 3)
    Y.applyUpdate(A.doc, Y.encodeStateAsUpdate(B.doc)); Y.applyUpdate(B.doc, Y.encodeStateAsUpdate(A.doc))
    for (const d of [A, B]) {
      const p = d.get(id!)!.props
      expect(p.b).toBe(2); expect(p.c).toBe(3); expect(p.text).toBe('hi')
    }
  })
})

describe('file store', () => {
  const root = () => mkdtempSync(join(tmpdir(), 'r4-'))

  test('lock records pid + start time; a reused pid with another start time is stale', async () => {
    const r = root()
    mkdirSync(join(r, 'canvas'), { recursive: true })
    writeFileSync(join(r, 'canvas', '.lock'), `${process.pid}:not-this-process:x`)
    const s = new CanvasFileStore(r, { onError: () => {} })
    await s.acquireLock()
    const content = require('node:fs').readFileSync(join(r, 'canvas', '.lock'), 'utf8') as string
    expect(content.startsWith(`${process.pid}:${processStartTime(process.pid) || '?'}:`)).toBe(true)
    await s.dispose()
    writeFileSync(join(r, 'canvas', '.lock'), `${process.pid}:${processStartTime(process.pid)}:other`)
    await expect(new CanvasFileStore(r, { onError: () => {} }).acquireLock()).rejects.toThrow('CANVAS_LOCKED')
  })

  test('no writes to the live log after a trash, even for edits racing it', async () => {
    const r = root()
    const s = new CanvasFileStore(r, { onError: () => {} })
    const { id } = await s.createBoard('T')
    const b = await s.openBoard(id)
    const trashing = s.trashBoard(id)
    b.add([shape(1)], me) // races the close
    await trashing
    b.add([shape(2)], me) // edit on the closed doc
    await new Promise(res => setTimeout(res, 50))
    await s.dispose()
    expect(existsSync(join(r, 'canvas', `${id}.log`))).toBe(false)
    expect(existsSync(join(r, 'canvas', `${id}.ydoc`))).toBe(false)
    expect(readdirSync(join(r, 'canvas', '.trash')).some(n => n.endsWith('.late.log'))).toBe(true)
  })

  test('index failures are tracked apart from dirty data', async () => {
    const r = root()
    const s = new CanvasFileStore(r, { onError: () => {} })
    const { id } = await s.createBoard('T')
    const b = await s.openBoard(id)
    const idx = join(r, 'canvas', 'index.json')
    require('node:fs').rmSync(idx)
    mkdirSync(idx); writeFileSync(join(idx, 'x'), '') // index writes now fail
    b.add([shape()], me)
    await s.flush(id) // data saved: must not report unsaved changes
    expect(s.indexFailures()).toEqual([id])
    await s.closeBoard(id)
    const s2 = new CanvasFileStore(mkdtempSync(join(tmpdir(), 'r4b-')))
    void s2
    const doc = new Y.Doc()
    Y.applyUpdate(doc, new Uint8Array(require('node:fs').readFileSync(join(r, 'canvas', `${id}.ydoc`))))
    expect(new CanvasDoc(doc).list().length).toBe(1)
    await s.dispose()
  })
})

describe('review 4b: link policy, resolver release', () => {
  test('remote-inserted cards never cause a local link; local ones link only after canView', async () => {
    const { ctx, links, entities } = ctxWith({ canView: r => r.id !== 'secret' })
    entities.set('ok', 'Ok'); entities.set('secret', 'S')
    const w = watchEntityLinks(ctx, { debounceMs: 1 })
    const peer = new Y.Doc()
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(ctx.board.doc))
    const pb = new CanvasDoc(peer)
    pb.add([{ type: 'entity', x: 0, y: 0, w: 10, h: 10, props: { kind: 'note', entityId: 'ok', origin: 'linked' } }], { kind: 'remote' })
    Y.applyUpdate(ctx.board.doc, Y.encodeStateAsUpdate(peer, Y.encodeStateVector(ctx.board.doc)), { kind: 'remote' })
    await w.idle()
    expect(links.size).toBe(0)
    ctx.board.add([{ type: 'entity', x: 0, y: 0, w: 10, h: 10, props: { kind: 'note', entityId: 'secret', origin: 'linked' } }], me)
    await w.idle()
    expect(links.size).toBe(0) // canView false
    const [mineId] = ctx.board.add([{ type: 'entity', x: 0, y: 0, w: 10, h: 10, props: { kind: 'note', entityId: 'ok', origin: 'linked' } }], me)
    await w.idle()
    expect([...links.values()].map(l => l.objectId)).toEqual([mineId!])
    w.stop()
  })

  test('only links this user created are removed', async () => {
    const { ctx, links } = ctxWith()
    links.set('gone|note|a', { objectId: 'gone', ref: { kind: 'note', id: 'a' }, mine: false } as never)
    links.set('gone2|note|b', { objectId: 'gone2', ref: { kind: 'note', id: 'b' }, mine: true } as never)
    const { reconcileEntityLinks } = await import('../index.ts')
    const r = await reconcileEntityLinks(ctx)
    expect(r.unlinked).toBe(1)
    expect([...links.keys()]).toEqual(['gone|note|a'])
  })

  test('resolver release/invalidate per ref', async () => {
    const { ctx, entities } = ctxWith()
    entities.set('n1', 'A')
    let unsubs = 0
    const a = ctx.registry.get('note')!
    ;(a as { subscribe?: unknown }).subscribe = () => () => { unsubs++ }
    const r = new EntitySnapshotResolver(ctx.registry)
    await r.resolve({ kind: 'note', id: 'n1' })
    r.invalidate({ kind: 'note', id: 'n1' })
    expect(r.get({ kind: 'note', id: 'n1' })).toBeUndefined()
    await r.resolve({ kind: 'note', id: 'n1' })
    r.release({ kind: 'note', id: 'n1' })
    expect(unsubs).toBe(1)
    expect(r.get({ kind: 'note', id: 'n1' })).toBeUndefined()
  })
})

describe('review 4b: file store', () => {
  test('openBoard waits for stale edits before reading', async () => {
    const r = mkdtempSync(join(tmpdir(), 'r4c-'))
    const s = new CanvasFileStore(r, { onError: () => {} })
    const { id } = await s.createBoard('T')
    const b = await s.openBoard(id)
    await s.closeBoard(id)
    b.add([shape(5)], me) // stale edit, queued to the log
    const again = await s.openBoard(id)
    expect(again.list().length).toBe(1)
    await s.dispose()
  })
})
