/**
 * «Доска» ↔ Rox entities, renderer side.
 * - Titles/previews are resolved per viewer through `entitiesResolve` (server
 *   access check; `no_access` → forbidden), batched once per frame with a
 *   per-ref cache, and never written to the board doc.
 * - Creation goes through each kind's real API (notes, pages, dashboards =
 *   live pages, sessions, personal tasks).
 * - Links: card `{kind:'canvas', id:<board>, fragment:<object>}` --embeds--> entity.
 *   `currentUserId` is learned from the server's `createdBy` on our own link
 *   adds and persisted per workspace, so reconcile can remove only our links.
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
  personalTasksList?: () => Promise<{ tasks: Array<{ id: string; title: string }> }>
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

/** One `entitiesResolve` call per frame for all refs requested in it; results cached per ref. */
export function createPreviewBatcher(workspaceId: string, schedule: (cb: () => void) => void = cb => { requestAnimationFrame(cb) }) {
  const cache = new Map<string, Promise<EntityPreview | null>>()
  let queue: Array<{ ref: EntityRef; resolve: (p: EntityPreview | null) => void }> = []
  const flush = async () => {
    const batch = queue
    queue = []
    const r = api().entitiesResolve
    let previews: EntityPreview[] = []
    if (r) { try { previews = await r(workspaceId, { refs: batch.map(b => ({ kind: b.ref.kind as EntityKind, id: b.ref.id })) }) } catch { previews = [] } }
    batch.forEach((b, i) => b.resolve(previews[i] ?? null))
  }
  const key = (ref: EntityRef) => `${ref.kind}:${ref.id}`
  return {
    get(ref: EntityRef): Promise<EntityPreview | null> {
      const k = key(ref)
      let p = cache.get(k)
      if (!p) {
        p = new Promise(resolve => { if (!queue.length) schedule(() => void flush()); queue.push({ ref, resolve }) })
        cache.set(k, p)
      }
      return p
    },
    invalidate(ref: EntityRef) { cache.delete(key(ref)) },
  }
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
    if (creatable.has(kind)) adapter.create = async ({ title, workspaceId: ws }) => createEntity(ws, kind as CreatableKind, title)
    registry.register(adapter)
  }
  return registry
}

const meKey = (ws: string) => `rox.canvas.linkActor.${ws}`
/** The server-side actor id our link writes are recorded under (learned from our own adds). */
export function currentLinkActor(workspaceId: string): string | undefined {
  try { return localStorage.getItem(meKey(workspaceId)) ?? undefined } catch { return undefined }
}

export function createEntityLinker(workspaceId: string, currentUserId: string | undefined = currentLinkActor(workspaceId)): EntityLinker & { readonly currentUserId: string | undefined } {
  let me = currentUserId
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
    async link(f, to) {
      const res = await call({ op: 'add', from: from(f), to: { kind: to.kind, id: to.id }, relation: 'embeds' })
      if (res.link?.createdBy && res.link.createdBy !== me) {
        me = res.link.createdBy
        try { localStorage.setItem(meKey(workspaceId), me) } catch { /* private mode */ }
      }
    },
    async unlink(f, to) { await call({ op: 'remove', from: from(f), to: { kind: to.kind, id: to.id }, relation: 'embeds' }) },
    async list(boardId) {
      const res = await call({ op: 'outgoing', ref: { kind: 'canvas', id: boardId } }) as { links?: EntityLink[] }
      return (res.links ?? []).filter(l => l.relation === 'embeds' && l.from.fragment)
        .map(l => ({ objectId: l.from.fragment!, ref: { kind: l.to.kind, id: l.to.id }, mine: me !== undefined && l.createdBy === me }))
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
