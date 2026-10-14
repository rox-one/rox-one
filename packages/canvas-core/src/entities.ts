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
  /** Current canvas links of this board (for reconcile). */
  list?(boardId: string): Promise<Array<{ objectId: string; ref: EntityRef }>>
}

/**
 * What a card may persist in the shared board doc. Board docs replicate to
 * every member (including view-only relay peers), so only display metadata is
 * kept — never `preview` or any extra field an adapter returns (bodies,
 * participants, private notes). Previews are read live through the adapter,
 * which enforces the viewer's own permissions.
 */
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

const CARD_W = 280
const CARD_H = 160

/** Mint a new entity via its kind adapter, place a card and link it. */
export async function createEntityCard(ctx: EntityCardContext, kind: string, title: string, at: { x: number; y: number }): Promise<string> {
  const a = ctx.registry.get(kind)
  if (!a?.creatable || !a.create) throw new Error(`entity kind not creatable: ${kind}`)
  const ref = await a.create({ title, workspaceId: ctx.workspaceId, boardId: ctx.boardId })
  return placeCard(ctx, ref, at, 'created', { title })
}

/** Drop an existing entity onto the board: card + link (idempotent per board placement). */
export async function linkEntityCard(ctx: EntityCardContext, ref: EntityRef, at: { x: number; y: number }): Promise<string> {
  const a = ctx.registry.get(ref.kind)
  if (!a) throw new Error(`unknown entity kind: ${ref.kind}`)
  const snap = (await a.read(ref)) ?? { title: ref.id }
  return placeCard(ctx, ref, at, 'linked', snap)
}

async function placeCard(ctx: EntityCardContext, ref: EntityRef, at: { x: number; y: number }, provenance: 'created' | 'linked', snapshot: EntitySnapshot): Promise<string> {
  const [objectId] = ctx.board.add([{
    type: 'entity', x: at.x, y: at.y, w: CARD_W, h: CARD_H,
    props: { kind: ref.kind, entityId: ref.id, snapshot: persistableSnapshot(snapshot), provenance },
    links: [{ kind: ref.kind, id: ref.id }],
  }], ctx.origin)
  try {
    await ctx.linker.link({ boardId: ctx.boardId, objectId: objectId! }, ref)
  } catch (e) {
    ctx.board.delete([objectId!], ctx.origin) // no orphan card without its link
    throw e
  }
  return objectId!
}

/** Refresh the cached snapshot (rename/status changes show on the card). */
export function applyEntitySnapshot(board: CanvasDoc, objectId: string, snap: EntitySnapshot | null, origin: Origin): void {
  const o = board.get(objectId)
  if (!o || o.type !== 'entity') return
  const next = snap ? persistableSnapshot(snap) : { ...persistableSnapshot(o.props.snapshot as EntitySnapshot | undefined), status: 'deleted' }
  if (JSON.stringify(next) === JSON.stringify(o.props.snapshot)) return
  board.update(objectId, { props: { snapshot: next } }, origin)
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
 * Make the link store match the board: every card linked, no link without a
 * card. Covers deletions by key/undo/remote peers that bypass removeEntityCards,
 * undo-restored cards, and failed link/unlink calls. Never deletes entities.
 */
export async function reconcileEntityLinks(ctx: EntityCardContext): Promise<{ linked: number; unlinked: number; failed: number }> {
  if (!ctx.linker.list) return { linked: 0, unlinked: 0, failed: 0 }
  const want = new Map(entityCards(ctx.board).map(c => [`${c.objectId}|${c.ref.kind}|${c.ref.id}`, c]))
  const have = new Map((await ctx.linker.list(ctx.boardId)).map(c => [`${c.objectId}|${c.ref.kind}|${c.ref.id}`, c]))
  let linked = 0, unlinked = 0, failed = 0
  for (const [k, c] of want) if (!have.has(k)) { try { await ctx.linker.link({ boardId: ctx.boardId, objectId: c.objectId }, c.ref); linked++ } catch { failed++ } }
  for (const [k, c] of have) if (!want.has(k)) { try { await ctx.linker.unlink({ boardId: ctx.boardId, objectId: c.objectId }, c.ref); unlinked++ } catch { failed++ } }
  return { linked, unlinked, failed }
}

/** Every entity card on the board (for subscription wiring). */
export function entityCards(board: CanvasDoc): Array<{ objectId: string; ref: EntityRef }> {
  return board.list().filter(o => o.type === 'entity').map(o => ({ objectId: o.id, ref: { kind: String(o.props.kind), id: String(o.props.entityId) } }))
}
