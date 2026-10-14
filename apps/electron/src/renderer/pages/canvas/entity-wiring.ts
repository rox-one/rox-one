/**
 * «Доска» ↔ Rox entities, renderer side.
 * - Titles/previews are resolved per viewer through `entitiesResolve` (server
 *   access check; `no_access` → forbidden), batched once per frame with a
 *   per-ref cache, and never written to the board doc.
 * - Creation goes through each kind's real API (notes, pages, dashboards =
 *   live pages, sessions, personal tasks).
 * - Links: card `{kind:'canvas', id:<board>, fragment:<object>}` --embeds--> entity.
 *   `currentUserId` comes from the server (`whoami`, derived from the session's
 *   auth context), so reconcile can remove only our links.
 */
import { EntityKindRegistry, EntitySnapshotResolver, type EntityKindAdapter, type EntityLinker, type EntityRef } from '@rox/canvas-core'
import { ENTITY_KINDS, kindDescriptor, type EntityKind, type EntityPreview, type EntityLink } from '@rox/core/entities'
import { openEntity } from '@/components/entities/open-entity'
import { createPersonalTaskConfirmed } from '@/lib/extra-screens/personal-task-bridge'

interface Bridge {
  entitiesResolve?: (ws: string, input: { refs: Array<{ kind: EntityKind; id: string; fragment?: string }> }) => Promise<EntityPreview[]>
  entitiesLinks?: (ws: string, input: unknown) => Promise<unknown>
  createNote?: (ws: string, title: string) => Promise<{ id: string; title: string }>
  createPage?: (ws: string, input: { name: string; kind?: 'static' | 'interactive' | 'live' }) => Promise<{ id: string; slug: string; name: string }>
  createSession?: (ws: string, options?: { name?: string }) => Promise<{ id: string; name?: string }>
  listNotes?: (ws: string) => Promise<Array<{ id: string; title: string }>>
  getPages?: (ws: string) => Promise<Array<{ config: { slug: string; name: string; kind?: string } }>>
  getSessions?: () => Promise<Array<{ id: string; name?: string; workspaceId?: string; isArchived?: boolean }>>
  personalTasksList?: () => Promise<{ tasks: Array<{ id: string; title: string; revision?: number }> }>
  deleteNote?: (ws: string, id: string) => Promise<boolean>
  deletePage?: (ws: string, slug: string) => Promise<unknown>
  deleteSession?: (id: string) => Promise<void>
  personalTasksDelete?: (deletes: Array<{ id: string; expectedRevision: number }>) => Promise<unknown>
}
const api = (): Bridge => ((window as unknown as { electronAPI?: Bridge }).electronAPI) ?? {}

/** Kinds that can be minted from the board, in picker order. `dashboard` is a live page. */
export const CREATABLE_KINDS = ['note', 'page', 'dashboard', 'session', 'task'] as const
export type CreatableKind = (typeof CREATABLE_KINDS)[number]
export const creatableEntityKind = (k: CreatableKind): EntityKind => (k === 'dashboard' ? 'page' : k)

export async function createEntity(workspaceId: string, kind: CreatableKind, title: string): Promise<EntityRef> {
  const a = api()
  switch (kind) {
    case 'note': { if (!a.createNote) throw new Error('notes unavailable'); const n = await a.createNote(workspaceId, title); return { kind: 'note', id: n.id } }
    case 'page':
    case 'dashboard': {
      if (!a.createPage) throw new Error('pages unavailable')
      const p = await a.createPage(workspaceId, { name: title, kind: kind === 'dashboard' ? 'live' : 'interactive' })
      return { kind: 'page', id: p.slug }
    }
    case 'session': { if (!a.createSession) throw new Error('sessions unavailable'); const s = await a.createSession(workspaceId, { name: title }); return { kind: 'session', id: s.id } }
    case 'task': { const t = await createPersonalTaskConfirmed({ title }); return { kind: 'task', id: t.id } }
  }
}

/** Delete an entity through its own API (card delete dialog, orphan cleanup). Kinds without one throw. */
export async function deleteEntity(workspaceId: string, ref: EntityRef): Promise<void> {
  const a = api()
  switch (ref.kind) {
    case 'note': if (a.deleteNote) { await a.deleteNote(workspaceId, ref.id); return } break
    case 'page': if (a.deletePage) { await a.deletePage(workspaceId, ref.id); return } break
    case 'session': if (a.deleteSession) { await a.deleteSession(ref.id); return } break
    case 'task': if (a.personalTasksList && a.personalTasksDelete) {
      const t = (await a.personalTasksList()).tasks.find(x => x.id === ref.id)
      if (!t) return
      await a.personalTasksDelete([{ id: t.id, expectedRevision: t.revision ?? 0 }])
      return
    } break
  }
  throw new Error(`entity kind not deletable: ${ref.kind}`)
}

/** Existing entities for the picker (notes, pages, sessions, tasks), filtered by `query`. */
export async function searchExisting(workspaceId: string, query: string, limit = 40): Promise<Array<{ ref: EntityRef; title: string }>> {
  const a = api()
  const q = query.trim().toLocaleLowerCase()
  const [notes, pages, sessions, tasks] = await Promise.all([
    a.listNotes?.(workspaceId).catch(() => []) ?? [],
    a.getPages?.(workspaceId).catch(() => []) ?? [],
    a.getSessions?.().catch(() => []) ?? [],
    a.personalTasksList?.().then(s => s.tasks).catch(() => []) ?? [],
  ])
  const all = [
    ...notes.map(n => ({ ref: { kind: 'note', id: n.id }, title: n.title })),
    ...pages.map(p => ({ ref: { kind: 'page', id: p.config.slug }, title: p.config.name })),
    ...sessions.filter(s => !s.isArchived && (!s.workspaceId || s.workspaceId === workspaceId)).map(s => ({ ref: { kind: 'session', id: s.id }, title: s.name || s.id })),
    ...tasks.map(t => ({ ref: { kind: 'task', id: t.id }, title: t.title })),
  ]
  return (q ? all.filter(e => e.title.toLocaleLowerCase().includes(q)) : all).slice(0, limit)
}

/** How long a resolved preview is reused before it is fetched again. */
export const PREVIEW_TTL_MS = 30_000

/**
 * One `entitiesResolve` call per frame for all refs requested in it; results
 * cached per ref for PREVIEW_TTL_MS. Null results and errors are never cached
 * (the next get() retries), and entity-change events clear the cache.
 */
export function createPreviewBatcher(
  workspaceId: string,
  schedule: (cb: () => void) => void = cb => { requestAnimationFrame(cb) },
  now: () => number = () => Date.now(),
) {
  const cache = new Map<string, { p: Promise<EntityPreview | null>; at: number }>()
  let queue: Array<{ k: string; ref: EntityRef; resolve: (p: EntityPreview | null) => void; entry?: { p: Promise<EntityPreview | null>; at: number } }> = []
  const flush = async () => {
    const batch = queue
    queue = []
    const r = api().entitiesResolve
    let previews: EntityPreview[] | null = null
    if (r) { try { previews = await r(workspaceId, { refs: batch.map(b => ({ kind: b.ref.kind as EntityKind, id: b.ref.id })) }) } catch { previews = null } }
    batch.forEach((b, i) => {
      const p = previews?.[i] ?? null
      if (!p && b.entry && cache.get(b.k) === b.entry) cache.delete(b.k) // don't cache misses / errors
      b.resolve(p)
    })
  }
  const key = (ref: EntityRef) => `${ref.kind}:${ref.id}`
  return {
    get(ref: EntityRef): Promise<EntityPreview | null> {
      const k = key(ref)
      const hit = cache.get(k)
      if (hit && now() - hit.at < PREVIEW_TTL_MS) return hit.p
      const item: (typeof queue)[number] = { k, ref, resolve: () => {} }
      const p = new Promise<EntityPreview | null>(resolve => { item.resolve = resolve })
      const entry = { p, at: now() }
      item.entry = entry
      if (!queue.length) schedule(() => void flush())
      queue.push(item)
      cache.set(k, entry)
      return p
    },
    invalidate(ref: EntityRef) { cache.delete(key(ref)) },
    clear() { cache.clear() },
  }
}
export type PreviewBatcher = ReturnType<typeof createPreviewBatcher>

interface ChangeEvents {
  onNotesChanged?: (cb: (p: unknown) => void) => () => void
  onPagesChanged?: (cb: (ws: string) => void) => () => void
  onEntitiesLinksChanged?: (cb: (ws: string) => void) => () => void
  onPersonalTasksChanged?: (cb: () => void) => () => void
}
/**
 * Entity-change events (notes, pages/dashboards, links, personal tasks) clear the
 * preview cache and call `onChange` so the page can re-resolve its cards.
 */
export function watchEntityChanges(workspaceId: string, batcher: PreviewBatcher, onChange: () => void): () => void {
  const ev = api() as ChangeEvents
  const fire = () => { batcher.clear(); onChange() }
  const offs = [
    ev.onNotesChanged?.(() => fire()),
    ev.onPagesChanged?.(ws => { if (ws === workspaceId) fire() }),
    ev.onEntitiesLinksChanged?.(ws => { if (ws === workspaceId) fire() }),
    ev.onPersonalTasksChanged?.(() => fire()),
  ]
  return () => { for (const off of offs) off?.() }
}

export function createEntityRegistry(workspaceId: string, batcher = createPreviewBatcher(workspaceId)): EntityKindRegistry {
  const registry = new EntityKindRegistry()
  const creatable = new Set<string>(CREATABLE_KINDS.map(creatableEntityKind))
  for (const kind of ENTITY_KINDS) {
    const d = kindDescriptor(kind)
    const adapter: EntityKindAdapter = {
      kind, labelKey: d.labelKey, icon: d.icon, creatable: creatable.has(kind),
      async canView(ref) { const p = await batcher.get(ref); return !!p && p.status !== 'no_access' },
      async read(ref) {
        const p = await batcher.get(ref)
        if (!p || p.status === 'tombstone' || p.status === 'unavailable' || p.status === 'no_access') return null
        return { title: p.title, icon: p.icon }
      },
      open(ref) {
        const fragment = (ref as EntityRef & { fragment?: string }).fragment
        openEntity(fragment ? { kind: ref.kind as EntityKind, id: ref.id, fragment } : { kind: ref.kind as EntityKind, id: ref.id })
      },
    }
    if (creatable.has(kind)) {
      adapter.create = async ({ title, workspaceId: ws }) => createEntity(ws, kind as CreatableKind, title)
      adapter.delete = async ref => deleteEntity(workspaceId, ref)
    }
    registry.register(adapter)
  }
  return registry
}

const actorCache = new Map<string, Promise<string | undefined>>()
/**
 * The actor id our link writes are recorded under (`createdBy`), asked from the
 * server, which derives it from the session's auth context. Failures are not cached.
 */
export function currentLinkActor(workspaceId: string): Promise<string | undefined> {
  let p = actorCache.get(workspaceId)
  if (!p) {
    p = (async () => {
      const l = api().entitiesLinks
      if (!l) return undefined
      const res = await l(workspaceId, { op: 'whoami' }) as { ok?: boolean; actorId?: unknown } | undefined
      return res?.ok && typeof res.actorId === 'string' && res.actorId ? res.actorId : undefined
    })().catch(() => undefined)
    p.then(id => { if (id === undefined) actorCache.delete(workspaceId) })
    actorCache.set(workspaceId, p)
  }
  return p
}
/** Tests only. */
export function __resetLinkActorCacheForTests(): void { actorCache.clear() }

export function createEntityLinker(workspaceId: string, currentUserId?: string): EntityLinker & { readonly currentUserId: string | undefined; ready(): Promise<string | undefined> } {
  let me = currentUserId
  const ready = async () => { if (me === undefined) me = await currentLinkActor(workspaceId); return me }
  const call = async (input: unknown) => {
    const l = api().entitiesLinks
    if (!l) throw new Error('entity links unavailable')
    const res = await l(workspaceId, input) as { ok: boolean; link?: EntityLink } | undefined
    if (!res?.ok) throw new Error('entity links disabled')
    return res
  }
  const from = (f: { boardId: string; objectId: string }) => ({ kind: 'canvas', id: f.boardId, fragment: f.objectId })
  return {
    get currentUserId() { return me },
    ready,
    async link(f, to) { await call({ op: 'add', from: from(f), to: { kind: to.kind, id: to.id }, relation: 'embeds' }) },
    async unlink(f, to) { await call({ op: 'remove', from: from(f), to: { kind: to.kind, id: to.id }, relation: 'embeds' }) },
    async list(boardId) {
      const mine = await ready()
      const res = await call({ op: 'outgoing', ref: { kind: 'canvas', id: boardId } }) as { links?: EntityLink[] }
      return (res.links ?? []).filter(l => l.relation === 'embeds' && l.from.fragment)
        .map(l => ({ objectId: l.from.fragment!, ref: { kind: l.to.kind, id: l.to.id }, mine: mine !== undefined && l.createdBy === mine }))
    },
  }
}

/** Trashing a board: remove this user's card links (others' links stay; the entities are untouched). */
export async function unlinkMyBoardLinks(linker: EntityLinker, boardId: string): Promise<number> {
  const links = (await linker.list?.(boardId)) ?? []
  let n = 0
  for (const l of links) if (l.mine) { await linker.unlink({ boardId, objectId: l.objectId }, l.ref); n++ }
  return n
}

export { EntitySnapshotResolver }
