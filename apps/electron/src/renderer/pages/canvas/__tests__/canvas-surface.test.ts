import { describe, expect, it, mock } from 'bun:test'
import { parseCanvasRoute, setCanvasTarget, takeCanvasTarget } from '../canvas-target'

describe('canvas target (S3)', () => {
  it('parses board and object id', () => {
    expect(parseCanvasRoute('canvas/board/b1#o2')).toEqual({ boardId: 'b1', objectId: 'o2' })
    expect(parseCanvasRoute('canvas/board/b1')).toEqual({ boardId: 'b1' })
    expect(parseCanvasRoute('notes/note/n1')).toBeNull()
  })
  it('pending target is consumed once', () => {
    setCanvasTarget({ boardId: 'b', objectId: 'o' })
    expect(takeCanvasTarget()).toEqual({ boardId: 'b', objectId: 'o' })
    expect(takeCanvasTarget()).toBeNull()
  })
})

describe('preview batcher (S7)', () => {
  it('one entitiesResolve per frame, cached per ref', async () => {
    const calls: unknown[] = []
    ;(globalThis as any).window = { electronAPI: { entitiesResolve: async (_ws: string, q: { refs: { id: string }[] }) => { calls.push(q); return q.refs.map(r => ({ title: r.id })) } } }
    const { createPreviewBatcher } = await import('../entity-wiring')
    const frames: Array<() => void> = []
    const b = createPreviewBatcher('ws', cb => { frames.push(cb) })
    const p1 = b.get({ kind: 'note', id: 'a' }), p2 = b.get({ kind: 'note', id: 'b' }), p3 = b.get({ kind: 'note', id: 'a' })
    expect(p3).toBe(p1)
    expect(frames.length).toBe(1)
    frames[0]!()
    expect(((await p1) as any)?.title).toBe('a')
    expect(((await p2) as any)?.title).toBe('b')
    expect(calls.length).toBe(1)
    b.get({ kind: 'note', id: 'a' })
    expect(frames.length).toBe(1)
  })
})

describe('preview batcher cache policy (review 6 #4)', () => {
  const setApi = (impl: (refs: { id: string }[]) => Promise<unknown[]>, extra: Record<string, unknown> = {}) => {
    const calls: string[][] = []
    ;(globalThis as any).window = { electronAPI: { entitiesResolve: async (_ws: string, q: { refs: { id: string }[] }) => { calls.push(q.refs.map(r => r.id)); return impl(q.refs) }, ...extra } }
    return calls
  }
  const run = async (b: { get(r: any): Promise<unknown> }, frames: Array<() => void>, id: string) => { const p = b.get({ kind: 'note', id }); frames.splice(0).forEach(f => f()); return p }
  it('does not cache null results or errors', async () => {
    let fail = true
    const calls = setApi(async refs => { if (fail) throw new Error('x'); return refs.map(() => null) })
    const { createPreviewBatcher } = await import('../entity-wiring')
    const frames: Array<() => void> = []
    const b = createPreviewBatcher('ws', cb => { frames.push(cb) })
    expect(await run(b, frames, 'a')).toBeNull()
    fail = false
    expect(await run(b, frames, 'a')).toBeNull()
    expect(await run(b, frames, 'a')).toBeNull()
    expect(calls.length).toBe(3)
  })
  it('expires entries after the TTL', async () => {
    const calls = setApi(async refs => refs.map(r => ({ title: r.id })))
    const { createPreviewBatcher, PREVIEW_TTL_MS } = await import('../entity-wiring')
    const frames: Array<() => void> = []
    let t = 0
    const b = createPreviewBatcher('ws', cb => { frames.push(cb) }, () => t)
    await run(b, frames, 'a'); await run(b, frames, 'a')
    expect(calls.length).toBe(1)
    t = PREVIEW_TTL_MS + 1
    await run(b, frames, 'a')
    expect(calls.length).toBe(2)
  })
  it('entity-change events clear the cache and notify', async () => {
    const subs: Record<string, (x?: unknown) => void> = {}
    const on = (name: string) => (cb: (x?: unknown) => void) => { subs[name] = cb; return () => { delete subs[name] } }
    const calls = setApi(async refs => refs.map(r => ({ title: r.id })), { onNotesChanged: on('notes'), onPagesChanged: on('pages'), onEntitiesLinksChanged: on('links'), onPersonalTasksChanged: on('tasks') })
    const { createPreviewBatcher, watchEntityChanges } = await import('../entity-wiring')
    const frames: Array<() => void> = []
    const b = createPreviewBatcher('ws', cb => { frames.push(cb) })
    let fired = 0
    const off = watchEntityChanges('ws', b, () => { fired++ })
    await run(b, frames, 'a')
    subs.pages!('other-ws')
    expect(fired).toBe(0)
    subs.notes!({})
    expect(fired).toBe(1)
    await run(b, frames, 'a')
    expect(calls.length).toBe(2)
    off()
    expect(Object.keys(subs)).toEqual([])
  })
})

describe('entity links enable for board cards', () => {
  it('turns entities.links.v1 on and retries when add returns disabled', async () => {
    const ops: Array<{ op: string }> = []
    let enabled = false
    const store = new Map<string, string>()
    ;(globalThis as any).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v) },
      removeItem: (k: string) => { store.delete(k) },
    }
    ;(globalThis as any).window = {
      electronAPI: {
        setEntitiesLinksEnabled: async (on: boolean) => {
          enabled = on
          return { enabled: on, persisted: on, envOverride: undefined }
        },
        entitiesLinks: async (_ws: string, input: { op: string }) => {
          ops.push({ op: input.op })
          if (input.op === 'whoami') return { ok: true, op: 'whoami', actorId: 'u1' }
          if (!enabled) return { ok: false, reason: 'disabled' }
          return { ok: true, op: input.op, link: { relation: 'embeds', from: { kind: 'canvas', id: 'b', fragment: 'o' }, to: { kind: 'note', id: 'n1' }, createdBy: 'u1' } }
        },
      },
    }
    const { createEntityLinker, __resetLinkActorCacheForTests, __resetEntityLinksEnsureForTests } = await import('../entity-wiring')
    __resetLinkActorCacheForTests()
    __resetEntityLinksEnsureForTests()
    const linker = createEntityLinker('ws')
    await linker.link({ boardId: 'b', objectId: 'o' }, { kind: 'note', id: 'n1' })
    expect(enabled).toBe(true)
    expect(ops.filter(o => o.op === 'add').length).toBe(2)
  })
})

describe('link actor from the auth context (review 6 #5)', () => {
  it('asks the server (whoami) and never reads localStorage', async () => {
    const ops: string[] = []
    ;(globalThis as any).localStorage = { getItem: () => { throw new Error('must not read localStorage') }, setItem: () => {} }
    ;(globalThis as any).window = { electronAPI: { entitiesLinks: async (_ws: string, input: { op: string }) => {
      ops.push(input.op)
      if (input.op === 'whoami') return { ok: true, op: 'whoami', actorId: 'user-7' }
      return { ok: true, op: 'outgoing', links: [
        { relation: 'embeds', from: { kind: 'canvas', id: 'b', fragment: 'o1' }, to: { kind: 'note', id: 'n1' }, createdBy: 'user-7' },
        { relation: 'embeds', from: { kind: 'canvas', id: 'b', fragment: 'o2' }, to: { kind: 'note', id: 'n2' }, createdBy: 'user-8' },
      ] }
    } } }
    const { createEntityLinker, __resetLinkActorCacheForTests } = await import('../entity-wiring')
    __resetLinkActorCacheForTests()
    const linker = createEntityLinker('ws')
    expect(await linker.ready()).toBe('user-7')
    const list = await linker.list!('b')
    expect(list.map(l => [l.objectId, l.mine])).toEqual([['o1', true], ['o2', false]])
    expect(ops.filter(o => o === 'whoami').length).toBe(1)
  })
  it('a failed whoami is not cached and marks nothing as mine', async () => {
    let up = false
    ;(globalThis as any).window = { electronAPI: { entitiesLinks: async (_ws: string, input: { op: string }) => {
      if (input.op === 'whoami') { if (!up) throw new Error('offline'); return { ok: true, op: 'whoami', actorId: 'u1' } }
      return { ok: true, links: [{ relation: 'embeds', from: { kind: 'canvas', id: 'b', fragment: 'o1' }, to: { kind: 'note', id: 'n1' }, createdBy: 'u1' }] }
    } } }
    const { createEntityLinker, currentLinkActor, __resetLinkActorCacheForTests } = await import('../entity-wiring')
    __resetLinkActorCacheForTests()
    expect((await createEntityLinker('ws2').list!('b'))[0]!.mine).toBe(false)
    await Promise.resolve()
    up = true
    expect(await currentLinkActor('ws2')).toBe('u1')
  })
})

function memStorage() {
  const m = new Map<string, string>()
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v) }, removeItem: (k: string) => { m.delete(k) }, m }
}
function fakeLinker(me: string, links: Array<{ objectId: string; ref: { kind: string; id: string }; mine: boolean }>) {
  const ops: string[] = []
  return {
    ops,
    ready: async () => me,
    get currentUserId() { return me },
    link: async (f: { objectId: string }, to: { id: string }) => { ops.push(`link:${f.objectId}:${to.id}`) },
    unlink: async (f: { objectId: string }, to: { id: string }) => { ops.push(`unlink:${f.objectId}:${to.id}`) },
    list: async () => links,
  }
}

describe('trash → restore re-links own cards (review 6 #6)', () => {
  it('unlinks only mine on trash and re-links them on restore, skipping gone or hidden cards', async () => {
    ;(globalThis as any).localStorage = memStorage()
    const { unlinkMyBoardLinks, relinkMyBoardLinks } = await import('../entity-wiring')
    const l = fakeLinker('u1', [
      { objectId: 'o1', ref: { kind: 'note', id: 'n1' }, mine: true },
      { objectId: 'o2', ref: { kind: 'note', id: 'n2' }, mine: false },
      { objectId: 'o3', ref: { kind: 'note', id: 'n3' }, mine: true },
      { objectId: 'o4', ref: { kind: 'note', id: 'n4' }, mine: true },
    ])
    const removed = await unlinkMyBoardLinks(l as any, 'b', 'ws')
    expect(removed.map(r => r.objectId)).toEqual(['o1', 'o3', 'o4'])
    expect(l.ops).toEqual(['unlink:o1:n1', 'unlink:o3:n3', 'unlink:o4:n4'])
    l.ops.length = 0
    const relinked = await relinkMyBoardLinks(l as any, 'ws', 'b', {
      cardExists: id => id !== 'o3',
      canView: async ref => ref.id !== 'n4',
    })
    expect(relinked.map(r => r.objectId)).toEqual(['o1'])
    expect(l.ops).toEqual(['link:o1:n1'])
    // record consumed: a second restore does nothing
    expect(await relinkMyBoardLinks(l as any, 'ws', 'b', { cardExists: () => true, canView: async () => true })).toEqual([])
  })
  it('another user restoring does not re-link my cards', async () => {
    ;(globalThis as any).localStorage = memStorage()
    const { unlinkMyBoardLinks, relinkMyBoardLinks } = await import('../entity-wiring')
    await unlinkMyBoardLinks(fakeLinker('u1', [{ objectId: 'o1', ref: { kind: 'note', id: 'n1' }, mine: true }]) as any, 'b', 'ws')
    const other = fakeLinker('u2', [])
    expect(await relinkMyBoardLinks(other as any, 'ws', 'b', { cardExists: () => true, canView: async () => true })).toEqual([])
    expect(other.ops).toEqual([])
  })
})

describe('delete entity only for own created cards (review 6 #7)', () => {
  it('requires origin "created" and my link on that card', async () => {
    const { canDeleteCardEntity } = await import('../entity-wiring')
    const links = [
      { objectId: 'c1', ref: { kind: 'note', id: 'n1' }, mine: true },
      { objectId: 'c2', ref: { kind: 'note', id: 'n2' }, mine: false },
      { objectId: 'c3', ref: { kind: 'note', id: 'n3' }, mine: true },
    ]
    const l = fakeLinker('u1', links) as any
    expect(await canDeleteCardEntity(l, 'b', { id: 'c1', props: { kind: 'note', entityId: 'n1', origin: 'created' } })).toBe(true)
    expect(await canDeleteCardEntity(l, 'b', { id: 'c2', props: { kind: 'note', entityId: 'n2', origin: 'created' } })).toBe(false)
    expect(await canDeleteCardEntity(l, 'b', { id: 'c3', props: { kind: 'note', entityId: 'n3', origin: 'linked' } })).toBe(false)
    expect(await canDeleteCardEntity(l, 'b', { id: 'c9', props: { kind: 'note', entityId: 'n1', origin: 'created' } })).toBe(false)
    expect(await canDeleteCardEntity({ ...l, list: async () => { throw new Error('x') } }, 'b', { id: 'c1', props: { kind: 'note', entityId: 'n1', origin: 'created' } })).toBe(false)
  })
})
