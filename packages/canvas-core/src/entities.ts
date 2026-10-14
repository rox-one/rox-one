/**
 * Live entity cards («Доска» ↔ Rox entities). Clean, host-agnostic contract:
 * canvas-core defines the registry and the board-side operations; the app
 * registers one adapter per EntityKind, backed by that kind's existing
 * creation/read APIs and the entity-links store. New kinds plug in by
 * registering an adapter — the board needs no change.
 *
 * Link convention: every card is linked board → entity with
 *   { kind: 'canvas', id: <boardId>, fragment: <objectId> }  ⇄  { kind, id }
 * so backlinks on the entity point at the exact card.
 */
import type * as Y from 'yjs'
import type { CanvasDoc, Origin } from './doc.ts'
import type { CanvasObject } from './schema.ts'
import { clip, wellFormed } from './text.ts'

export interface EntityRef { kind: string; id: string }
export interface EntitySnapshot { title: string; status?: string; preview?: string; icon?: string; updatedAt?: number }

export interface EntityKindAdapter {
  kind: string
  /** i18n key of the kind's display name. */
  labelKey: string
  icon: string
  /** Whether users/agents may mint new entities of this kind from the board. */
  creatable: boolean
  /** Create through the kind's existing API; returns the new ref. */
  create?(input: { title: string; workspaceId: string; boardId: string }): Promise<EntityRef>
  read(ref: EntityRef): Promise<EntitySnapshot | null>
  /** Viewer access check; false = the card renders as «нет доступа». Default: allowed iff read() returns. */
  canView?(ref: EntityRef): Promise<boolean>
  /** Push-based change feed; returns an unsubscribe. Snapshot null = entity deleted. */
  subscribe?(ref: EntityRef, onChange: (snap: EntitySnapshot | null) => void): () => void
  /** Open natively in the app (route/deep link), not inside the board. */
  open(ref: EntityRef): void
  /** Only called on an explicit user choice; never on card deletion. */
  delete?(ref: EntityRef): Promise<void>
}

export interface EntityLinker {
  link(from: { boardId: string; objectId: string }, to: EntityRef): Promise<void>
  unlink(from: { boardId: string; objectId: string }, to: EntityRef): Promise<void>
  /**
   * Current canvas links of this board (for reconcile). `mine` = created by the
   * current user; reconcile only ever removes links where `mine` is true.
   */
  list?(boardId: string): Promise<Array<{ objectId: string; ref: EntityRef; mine?: boolean }>>
}

/** Fields an entity card may hold in the shared doc. Everything else is stripped. */
export const ENTITY_CARD_KEYS = ['kind', 'entityId', 'origin'] as const

/** Display sanitising of a resolved snapshot (never persisted). */
export interface PersistedSnapshot { title: string; status?: string; icon?: string; updatedAt?: number }
export function persistableSnapshot(s: Partial<EntitySnapshot> | null | undefined): PersistedSnapshot {
  const out: PersistedSnapshot = { title: clip(wellFormed(typeof s?.title === 'string' ? s.title : ''), 200) }
  if (typeof s?.status === 'string') out.status = clip(wellFormed(s.status), 40)
  if (typeof s?.icon === 'string') out.icon = clip(s.icon, 64)
  if (typeof s?.updatedAt === 'number' && Number.isFinite(s.updatedAt)) out.updatedAt = s.updatedAt
  return out
}

export class EntityKindRegistry {
  private adapters = new Map<string, EntityKindAdapter>()
  private listeners = new Set<() => void>()
  register(a: EntityKindAdapter): () => void {
    if (this.adapters.has(a.kind)) throw new Error(`entity kind already registered: ${a.kind}`)
    this.adapters.set(a.kind, a)
    this.emit()
    return () => { if (this.adapters.get(a.kind) === a) { this.adapters.delete(a.kind); this.emit() } }
  }
  get(kind: string): EntityKindAdapter | undefined { return this.adapters.get(kind) }
  list(): EntityKindAdapter[] { return [...this.adapters.values()] }
  creatable(): EntityKindAdapter[] { return this.list().filter(a => a.creatable && a.create) }
  onChange(cb: () => void): () => void { this.listeners.add(cb); return () => this.listeners.delete(cb) }
  private emit() { for (const l of this.listeners) l() }
}

export interface EntityCardContext {
  board: CanvasDoc
  boardId: string
  workspaceId: string
  registry: EntityKindRegistry
  linker: EntityLinker
  origin: Origin
}

/** Non-undoable origin for compensating/system writes (never in any UndoManager's trackedOrigins). */
export const SYSTEM_ORIGIN: Origin = Object.freeze({ kind: 'migration' }) as Origin

const CARD_W = 280
const CARD_H = 160

/** Mint a new entity via its kind adapter, place a card and link it. On link failure the new entity is deleted again. */
export async function createEntityCard(ctx: EntityCardContext, kind: string, title: string, at: { x: number; y: number }): Promise<string> {
  const a = ctx.registry.get(kind)
  if (!a?.creatable || !a.create) throw new Error(`entity kind not creatable: ${kind}`)
  const ref = await a.create({ title, workspaceId: ctx.workspaceId, boardId: ctx.boardId })
  try {
    return await placeCard(ctx, ref, at, 'created')
  } catch (e) {
    // The entity only existed for this card: don't leave an orphan behind.
    try { await a.delete?.(ref) } catch (e2) { throw new AggregateError([e, e2], 'entity card: link failed and the orphan entity could not be deleted') }
    throw e
  }
}

/** Drop an existing entity onto the board: card + link. The entity is never deleted here. */
export async function linkEntityCard(ctx: EntityCardContext, ref: EntityRef, at: { x: number; y: number }): Promise<string> {
  if (!ctx.registry.get(ref.kind)) throw new Error(`unknown entity kind: ${ref.kind}`)
  return placeCard(ctx, ref, at, 'linked')
}

async function placeCard(ctx: EntityCardContext, ref: EntityRef, at: { x: number; y: number }, origin: 'created' | 'linked'): Promise<string> {
  const [objectId] = ctx.board.add([{
    type: 'entity', x: at.x, y: at.y, w: CARD_W, h: CARD_H,
    props: { kind: ref.kind, entityId: ref.id, origin },
    links: [{ kind: ref.kind, id: ref.id }],
  }], ctx.origin)
  try {
    await ctx.linker.link({ boardId: ctx.boardId, objectId: objectId! }, ref)
  } catch (e) {
    // Compensating delete on a non-undo origin: undo must not resurrect a link-less card.
    ctx.board.delete([objectId!], SYSTEM_ORIGIN)
    throw e
  }
  return objectId!
}

/** Card display state for this viewer. */
export type ResolvedEntity = { state: 'ok'; snapshot: PersistedSnapshot & { preview?: string } } | { state: 'forbidden' } | { state: 'deleted' } | { state: 'unknown-kind' }

/**
 * Per-viewer snapshot resolution. Lives only in memory on this client: the
 * adapter checks the viewer's access first and nothing is written to the doc.
 */
export class EntitySnapshotResolver {
  private cache = new Map<string, ResolvedEntity>()
  private subs = new Map<string, () => void>()
  private listeners = new Set<(key: string, r: ResolvedEntity) => void>()
  constructor(private registry: EntityKindRegistry) {}
  static key(ref: EntityRef): string { return `${ref.kind}:${ref.id}` }
  get(ref: EntityRef): ResolvedEntity | undefined { return this.cache.get(EntitySnapshotResolver.key(ref)) }
  onChange(cb: (key: string, r: ResolvedEntity) => void): () => void { this.listeners.add(cb); return () => this.listeners.delete(cb) }
  async resolve(ref: EntityRef): Promise<ResolvedEntity> {
    const key = EntitySnapshotResolver.key(ref)
    const a = this.registry.get(ref.kind)
    let r: ResolvedEntity
    if (!a) r = { state: 'unknown-kind' }
    else if (a.canView && !(await a.canView(ref).catch(() => false))) r = { state: 'forbidden' }
    else {
      const snap = await a.read(ref).catch(() => null)
      r = snap ? this.toOk(snap) : { state: a.canView ? 'deleted' : 'forbidden' }
      if (snap && a.subscribe && !this.subs.has(key)) {
        this.subs.set(key, a.subscribe(ref, next => this.set(key, next ? this.toOk(next) : { state: 'deleted' })))
      }
    }
    this.set(key, r)
    return r
  }
  /** Drop the cached result and the change subscription for one ref (card removed / unmounted). */
  release(ref: EntityRef): void {
    const key = EntitySnapshotResolver.key(ref)
    this.subs.get(key)?.()
    this.subs.delete(key)
    this.cache.delete(key)
  }
  /** Forget the cached result (e.g. permissions changed); the next resolve() re-checks access. */
  invalidate(ref: EntityRef): void { this.cache.delete(EntitySnapshotResolver.key(ref)) }
  dispose(): void { for (const off of this.subs.values()) off(); this.subs.clear(); this.cache.clear(); this.listeners.clear() }
  private toOk(s: EntitySnapshot): ResolvedEntity {
    const snapshot: PersistedSnapshot & { preview?: string } = persistableSnapshot(s)
    if (typeof s.preview === 'string') snapshot.preview = clip(wellFormed(s.preview), 2000)
    return { state: 'ok', snapshot }
  }
  private set(key: string, r: ResolvedEntity) { this.cache.set(key, r); for (const l of this.listeners) l(key, r) }
}

/**
 * Keep entity cards to {kind, entityId, origin}: any other prop key (e.g. a
 * `snapshot` injected by a remote or legacy peer) is removed on a non-undo
 * origin. Runs once now and after every transaction. Returns a detach.
 */
export function guardEntityCards(board: CanvasDoc): () => void {
  const allowed = new Set<string>(ENTITY_CARD_KEYS)
  const sweep = (ids?: Iterable<string>) => {
    const doomed: Array<[import('yjs').Map<unknown>, string]> = []
    for (const id of ids ?? board.objects.keys()) {
      const m = board.objects.get(id)
      if (!m || m.get('type') !== 'entity') continue
      const props = m.get('props') as { keys?: () => IterableIterator<string>; delete?: (k: string) => void } | undefined
      if (!props?.keys) continue
      for (const k of props.keys()) if (!allowed.has(k)) doomed.push([props as never, k])
    }
    if (doomed.length) board.doc.transact(() => { for (const [p, k] of doomed) p.delete(k) }, SYSTEM_ORIGIN)
  }
  sweep()
  // Only objects touched by the transaction are checked (boards hold thousands).
  const onAfter = (tr: { origin: unknown; changed: Map<unknown, Set<string | null>> }) => {
    if (tr.origin === SYSTEM_ORIGIN || tr.changed.size === 0) return
    const ids = new Set<string>()
    for (const [t, keys] of tr.changed) {
      if (t === board.objects) { for (const k of keys) if (k) ids.add(k); continue }
      let cur = t as { parent?: unknown; _item?: { parentSub?: string | null } | null } | null
      while (cur && cur.parent && cur.parent !== board.objects) cur = cur.parent as typeof cur
      const id = cur?._item?.parentSub
      if (cur?.parent === board.objects && id) ids.add(id)
    }
    if (ids.size) sweep(ids)
  }
  board.doc.on('afterTransaction', onAfter as never)
  return () => board.doc.off('afterTransaction', onAfter as never)
}

/**
 * Reconcile links from doc state whenever the board's entity cards change —
 * covers remote deletes, plain `board.delete`, undo/redo. Debounced; returns a detach.
 */
export function watchEntityLinks(ctx: EntityCardContext, opts: { debounceMs?: number; onError?: (e: unknown) => void } = {}): { stop(): void; idle(): Promise<void> } {
  // Cards inserted by this client (local actor or its undo/redo), never by remote peers.
  const localCards = new Set<string>()
  const linkable = async (c: { objectId: string; ref: EntityRef }) => {
    if (!localCards.has(c.objectId)) return false
    const a = ctx.registry.get(c.ref.kind)
    if (!a) return false
    return a.canView ? a.canView(c.ref).catch(() => false) : (await a.read(c.ref).catch(() => null)) !== null
  }
  let sig = cardSignature(ctx.board)
  let timer: ReturnType<typeof setTimeout> | null = null
  let running: Promise<void> = Promise.resolve()
  let again = false
  const run = () => {
    timer = null
    running = running.then(async () => {
      do {
        again = false
        const r = await reconcileEntityLinks(ctx, { linkable }).catch(e => { opts.onError?.(e); return null })
        if (r && r.failed) opts.onError?.(new Error(`entity links: ${r.failed} reconcile step(s) failed`))
      } while (again)
    })
  }
  const onAfter = (tr: Y.Transaction) => {
    const o = tr.origin as Origin | null | undefined
    if (tr.local && o !== SYSTEM_ORIGIN && !(o && typeof o === 'object' && 'kind' in o && (o.kind === 'remote' || o.kind === 'migration'))) {
      for (const k of tr.changed.get(ctx.board.objects as never) ?? []) {
        if (k && ctx.board.objects.get(k)?.get('type') === 'entity') localCards.add(k)
      }
    }
    const next = cardSignature(ctx.board)
    if (next === sig) return
    sig = next
    again = true
    if (!timer) timer = setTimeout(run, opts.debounceMs ?? 50)
  }
  ctx.board.doc.on('afterTransaction', onAfter)
  return {
    stop() { ctx.board.doc.off('afterTransaction', onAfter); if (timer) clearTimeout(timer) },
    async idle() { while (timer) { await new Promise(r => setTimeout(r, 5)) } await running },
  }
}

function cardSignature(board: CanvasDoc): string {
  return entityCards(board).map(c => `${c.objectId}|${c.ref.kind}|${c.ref.id}`).sort().join(',')
}

/**
 * Remove cards: always unlinks; deletes the entity only when the caller passes
 * `deleteEntities: true` (an explicit user choice in the UI).
 */
export async function removeEntityCards(ctx: EntityCardContext, objectIds: string[], opts: { deleteEntities?: boolean } = {}): Promise<void> {
  const removedCards = new Map(ctx.board.list().filter(o => o.type === 'entity').map(o => [o.id, o]))
  const removed = new Set(ctx.board.delete(objectIds, ctx.origin))
  // Descendant cards (inside a deleted frame) are removed too, so collect after delete.
  const all = [...removed].map(id => removedCards.get(id)).filter((o): o is CanvasObject => !!o)
  const errors: unknown[] = []
  for (const card of all) {
    const ref = { kind: String(card.props.kind), id: String(card.props.entityId) }
    // One failure must not leave the remaining cards linked; reconcile retries the rest later.
    try { await ctx.linker.unlink({ boardId: ctx.boardId, objectId: card.id }, ref) } catch (e) { errors.push(e); continue }
    if (opts.deleteEntities) { try { await ctx.registry.get(ref.kind)?.delete?.(ref) } catch (e) { errors.push(e) } }
  }
  if (errors.length) throw new AggregateError(errors, `entity cards: ${errors.length} unlink/delete step(s) failed`)
}

/**
 * Make the link store match the board. Links are only ADDED for cards that
 * `linkable` accepts (default: all) and only REMOVED for links whose card is
 * gone and which this user created (`mine === true`). Never deletes entities.
 */
export async function reconcileEntityLinks(ctx: EntityCardContext, opts: { linkable?: (card: { objectId: string; ref: EntityRef }) => boolean | Promise<boolean> } = {}): Promise<{ linked: number; unlinked: number; failed: number }> {
  if (!ctx.linker.list) return { linked: 0, unlinked: 0, failed: 0 }
  const key = (c: { objectId: string; ref: EntityRef }) => `${c.objectId}|${c.ref.kind}|${c.ref.id}`
  const cards = new Map(entityCards(ctx.board).map(c => [key(c), c]))
  const have = new Map((await ctx.linker.list(ctx.boardId)).map(c => [key(c), c]))
  let linked = 0, unlinked = 0, failed = 0
  for (const [k, c] of cards) {
    if (have.has(k)) continue
    try {
      if (opts.linkable && !(await opts.linkable(c))) continue
      await ctx.linker.link({ boardId: ctx.boardId, objectId: c.objectId }, c.ref); linked++
    } catch { failed++ }
  }
  for (const [k, c] of have) {
    if (cards.has(k) || c.mine !== true) continue
    try { await ctx.linker.unlink({ boardId: ctx.boardId, objectId: c.objectId }, c.ref); unlinked++ } catch { failed++ }
  }
  return { linked, unlinked, failed }
}

/** Every entity card on the board (for subscription wiring). */
export function entityCards(board: CanvasDoc): Array<{ objectId: string; ref: EntityRef }> {
  return board.list().filter(o => o.type === 'entity').map(o => ({ objectId: o.id, ref: { kind: String(o.props.kind), id: String(o.props.entityId) } }))
}
