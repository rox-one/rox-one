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
    props: { kind: ref.kind, entityId: ref.id, snapshot, provenance },
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
  const next = snap ?? { ...(o.props.snapshot as EntitySnapshot | undefined ?? { title: '' }), status: 'deleted' }
  board.update(objectId, { props: { snapshot: next } }, origin)
}

/**
 * Remove cards: always unlinks; deletes the entity only when the caller passes
 * `deleteEntities: true` (an explicit user choice in the UI).
 */
export async function removeEntityCards(ctx: EntityCardContext, objectIds: string[], opts: { deleteEntities?: boolean } = {}): Promise<void> {
  const cards = objectIds.map(id => ctx.board.get(id)).filter((o): o is CanvasObject => !!o && o.type === 'entity')
  const removed = ctx.board.delete(objectIds, ctx.origin)
  for (const card of cards) {
    if (!removed.includes(card.id)) continue
    const ref = { kind: String(card.props.kind), id: String(card.props.entityId) }
    await ctx.linker.unlink({ boardId: ctx.boardId, objectId: card.id }, ref)
    if (opts.deleteEntities) await ctx.registry.get(ref.kind)?.delete?.(ref)
  }
}

/** Every entity card on the board (for subscription wiring). */
export function entityCards(board: CanvasDoc): Array<{ objectId: string; ref: EntityRef }> {
  return board.list().filter(o => o.type === 'entity').map(o => ({ objectId: o.id, ref: { kind: String(o.props.kind), id: String(o.props.entityId) } }))
}
