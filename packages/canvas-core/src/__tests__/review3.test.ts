import { describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as Y from 'yjs'
import {
  actorOrigin, applyTextDiff, CanvasDoc, clip, EntityKindRegistry, isValidIndexKey, linkEntityCard,
  migrateLegacy, persistableSnapshot, reconcileEntityLinks, removeEntityCards, wellFormed, type EntityCardContext, type EntityRef,
} from '../index.ts'
import { CanvasFileStore } from '../node/index.ts'

const me = actorOrigin('user', 'u1')

function linkCtx() {
  const links = new Map<string, { objectId: string; ref: EntityRef; mine?: boolean }>()
  const registry = new EntityKindRegistry()
  registry.register({ kind: 'note', labelKey: 'k', icon: 'N', creatable: false,
    async read(r) { return { title: `T ${r.id}`, preview: 'SECRET BODY', body: 'x', participants: ['a@b'] } as never }, open() {} })
  let failUnlink = new Set<string>()
  const ctx: EntityCardContext = {
    board: new CanvasDoc(), boardId: 'b1', workspaceId: 'w', registry, origin: me,
    linker: {
      async link(f, ref) { links.set(`${f.objectId}|${ref.kind}|${ref.id}`, { objectId: f.objectId, ref, mine: true }) },
      async unlink(f, ref) { if (failUnlink.has(f.objectId)) throw new Error('boom'); links.delete(`${f.objectId}|${ref.kind}|${ref.id}`) },
      async list() { return [...links.values()] },
    },
  }
  return { ctx, links, setFail: (s: Set<string>) => { failUnlink = s } }
}

describe('entity snapshot leak', () => {
  test('nothing but the reference is persisted in the shared doc', async () => {
    const { ctx } = linkCtx()
    const id = await linkEntityCard(ctx, { kind: 'note', id: 'n1' }, { x: 0, y: 0 })
    expect(ctx.board.get(id)!.props).toEqual({ kind: 'note', entityId: 'n1', origin: 'linked' })
    const wire = new TextDecoder().decode(Y.encodeStateAsUpdate(ctx.board.doc))
    expect(wire.includes('SECRET')).toBe(false)
    expect(wire.includes('T n1')).toBe(false)
  })
  test('persistableSnapshot clips without splitting surrogates', () => {
    expect(persistableSnapshot({ title: 'a'.repeat(199) + '😀' }).title).toBe('a'.repeat(199))
    expect(clip('ab😀', 3)).toBe('ab')
  })
})

describe('link reconcile', () => {
  test('deletes outside removeEntityCards and undo-restores are reconciled', async () => {
    const { ctx, links } = linkCtx()
    const a = await linkEntityCard(ctx, { kind: 'note', id: 'n1' }, { x: 0, y: 0 })
    const b = await linkEntityCard(ctx, { kind: 'note', id: 'n2' }, { x: 0, y: 0 })
    ctx.board.delete([a], me) // e.g. Delete key / remote peer
    expect(await reconcileEntityLinks(ctx)).toEqual({ linked: 0, unlinked: 1, failed: 0 })
    links.clear() // e.g. link store lost
    expect(await reconcileEntityLinks(ctx)).toEqual({ linked: 1, unlinked: 0, failed: 0 })
    expect([...links.values()].map(l => l.objectId)).toEqual([b])
  })
  test('one failing unlink does not leave the rest linked', async () => {
    const { ctx, links, setFail } = linkCtx()
    const a = await linkEntityCard(ctx, { kind: 'note', id: 'n1' }, { x: 0, y: 0 })
    const b = await linkEntityCard(ctx, { kind: 'note', id: 'n2' }, { x: 0, y: 0 })
    setFail(new Set([a]))
    await expect(removeEntityCards(ctx, [a, b])).rejects.toThrow(/1 unlink/)
    expect([...links.values()].map(l => l.objectId)).toEqual([a])
    setFail(new Set())
    expect((await reconcileEntityLinks(ctx)).unlinked).toBe(1)
  })
  test('cards inside a deleted frame are unlinked too', async () => {
    const { ctx, links } = linkCtx()
    const [frame] = ctx.board.add([{ type: 'frame', x: 0, y: 0, w: 500, h: 500, props: {} }], me)
    const card = await linkEntityCard(ctx, { kind: 'note', id: 'n1' }, { x: 0, y: 0 })
    ctx.board.update(card, { parentId: frame! }, me)
    await removeEntityCards(ctx, [frame!])
    expect(links.size).toBe(0)
  })
})

describe('surrogates', () => {
  test('wellFormed replaces lone halves only', () => {
    expect(wellFormed('a\uD83Db')).toBe('a\uFFFDb')
    expect(wellFormed('😀')).toBe('😀')
  })
  test('text diffs never split a pair', () => {
    const d = new Y.Doc(); const t = d.getText('t')
    t.insert(0, '😀')
    applyTextDiff(t, '😃') // same high surrogate, different low
    expect(t.toString()).toBe('😃')
    for (const [a, b] of [['x😀y', 'x😃y'], ['😀😀', '😀'], ['a😀', 'a😀😁'], ['😁b', '😀b']]) {
      t.delete(0, t.length); t.insert(0, a!)
      const ops: string[] = []
      const h = (e: Y.YTextEvent) => { for (const op of e.delta) if (typeof op.insert === 'string') ops.push(op.insert) }
      t.observe(h); applyTextDiff(t, b!); t.unobserve(h)
      expect(t.toString()).toBe(b!)
      for (const s of ops) expect(wellFormed(s)).toBe(s)
    }
  })
  test('titles are stored well-formed', () => {
    const b = new CanvasDoc(); b.init({ title: 'x\uD800' }); expect(b.getMeta().title).toBe('x\uFFFD')
  })
})

describe('legacy boards', () => {
  test('invalid z-keys and plain style/props/text are migrated, order kept', () => {
    const doc = new Y.Doc()
    const objects = doc.getMap<Y.Map<unknown>>('objects')
    doc.transact(() => {
      for (const [id, idx] of [['o1', 'a0'], ['o2', 'Zz~'], ['o3', '0legacy'], ['o4', 'a1']] as const) {
        const m = new Y.Map<unknown>()
        for (const [k, v] of Object.entries({ id, type: 'text', x: 0, y: 0, w: 1, h: 1, rotation: 0, parentId: null, index: idx, locked: false, hidden: false, style: { opacity: 0.5 }, props: { text: 'hi' }, links: [], updatedAt: 0 })) m.set(k, v)
        objects.set(id, m)
      }
    })
    const board = new CanvasDoc(doc)
    const touched = migrateLegacy(board)
    expect(touched.sort()).toEqual(['o1', 'o2', 'o3', 'o4'])
    const ids = board.list().map(o => o.id)
    expect(ids).toEqual(['o1', 'o4', 'o3', 'o2'])
    for (const o of board.list()) expect(isValidIndexKey(o.index)).toBe(true)
    expect(board.textOf('o1')?.toString()).toBe('hi')
    expect((board.get('o1')!.style as Record<string, unknown>).opacity).toBe(0.5)
    expect(migrateLegacy(board)).toEqual([])
  })
})

async function fresh() {
  const root = mkdtempSync(join(tmpdir(), 'canvas-r3-'))
  return { root, s: new CanvasFileStore(root, { onError: () => {} }) }
}

describe('file store (review 3)', () => {
  test('lock: concurrent stores in one process — exactly one wins; foreign lock content is never deleted by dispose', async () => {
    const { root } = await fresh()
    const stores = Array.from({ length: 5 }, () => new CanvasFileStore(root, { onError: () => {} }))
    const res = await Promise.allSettled(stores.map(s => s.acquireLock()))
    expect(res.filter(r => r.status === 'fulfilled').length).toBe(1)
    const winner = stores[res.findIndex(r => r.status === 'fulfilled')]!
    const lock = join(root, 'canvas', '.lock')
    writeFileSync(lock, '999999999:other') // someone replaced it
    await winner.dispose()
    expect(readFileSync(lock, 'utf8')).toBe('999999999:other')
  })
  test('index: missing entries recovered, stale entries dropped, legacy array format read', async () => {
    const { root, s } = await fresh()
    const a = await s.createBoard('A')
    const b = await s.createBoard('B')
    writeFileSync(join(root, 'canvas', 'index.json'), JSON.stringify([{ id: a.id, title: 'A', createdAt: 1, updatedAt: 2 }, { id: 'gone', title: 'G', createdAt: 1, updatedAt: 1 }]))
    const ids = (await s.listBoards()).map(x => x.id).sort()
    expect(ids).toEqual([a.id, b.id].sort())
    await s.dispose()
  })
  test('trash: corrupt-log copies move too; late stale edits land in the trash, never resurrect the board', async () => {
    const { root, s } = await fresh()
    const { id } = await s.createBoard('T')
    const board = await s.openBoard(id)
    board.add([{ type: 'shape', x: 0, y: 0, w: 1, h: 1, props: { kind: 'rect' } }], me)
    writeFileSync(join(root, 'canvas', `${id}.log.corrupt-1`), 'junk')
    await s.trashBoard(id)
    board.add([{ type: 'shape', x: 5, y: 0, w: 1, h: 1, props: { kind: 'rect' } }], me) // stale doc edit
    await s.dispose()
    const names = readdirSync(join(root, 'canvas'))
    expect(names.filter(n => n.startsWith(id))).toEqual([])
    const trash = readdirSync(join(root, 'canvas', '.trash'))
    expect(trash.some(n => n.endsWith('.ydoc'))).toBe(true)
    expect(trash.some(n => n.includes('corrupt-1'))).toBe(true)
    expect(trash.some(n => n.endsWith('.log'))).toBe(true)
    expect((await new CanvasFileStore(root).listBoards()).length).toBe(0)
    await expect(s.trashBoard('nope')).rejects.toThrow(/not found/)
  })
  test('legacy board on disk is migrated on open and snapshotted', async () => {
    const { root, s } = await fresh()
    const { id } = await s.createBoard('L')
    const snap = join(root, 'canvas', `${id}.ydoc`)
    const doc = new Y.Doc(); Y.applyUpdate(doc, new Uint8Array(readFileSync(snap)))
    const m = new Y.Map<unknown>()
    for (const [k, v] of Object.entries({ id: 'old', type: 'shape', x: 0, y: 0, w: 1, h: 1, rotation: 0, parentId: null, index: '!!', locked: false, hidden: false, style: {}, props: { kind: 'rect' }, links: [], updatedAt: 0 })) m.set(k, v)
    doc.getMap('objects').set('old', m)
    writeFileSync(snap, Y.encodeStateAsUpdate(doc))
    const board = await s.openBoard(id)
    expect(isValidIndexKey(board.get('old')!.index)).toBe(true)
    expect(existsSync(join(root, 'canvas', `${id}.log`))).toBe(false)
    await s.dispose()
  })
})
