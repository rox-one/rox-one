/**
 * Yjs binding for one board. Layout (SPEC §3):
 *   meta: Y.Map  { schemaVersion, title, createdAt, createdBy, background }
 *   objects: Y.Map<id, Y.Map>  flat; tree via parentId; z-order via `index`
 *     text-bearing props (`text`) are Y.Text so concurrent typing merges.
 *   assets: Y.Map<assetId, {hash,mime,size,name}>
 *   comments: Y.Map<threadId, Y.Map>
 * All writes go through `CanvasDoc` so validation and origins are uniform.
 */
import * as Y from 'yjs'
import { SCHEMA_VERSION, validateObject, type CanvasObject, type CanvasObjectInput } from './schema.ts'
import { keyBetween } from './fractional-index.ts'

export type Origin = { kind: 'user'; userId: string } | { kind: 'agent'; sessionId: string } | { kind: 'remote' } | { kind: 'migration' }

const TEXT_PROP = 'text'

export interface BoardMeta { schemaVersion: number; title: string; createdAt: number; createdBy?: string; background?: string }

export class CanvasValidationError extends Error {
  constructor(public readonly objectId: string, public readonly issues: string[]) {
    super(`invalid canvas object ${objectId}: ${issues.join('; ')}`)
  }
}

let idCounter = 0
export function newObjectId(): string {
  idCounter = (idCounter + 1) % 0x10000
  const rand = crypto.getRandomValues(new Uint32Array(2))
  return `o_${Date.now().toString(36)}${idCounter.toString(36)}${rand[0]!.toString(36)}${rand[1]!.toString(36)}`
}

export class CanvasDoc {
  readonly doc: Y.Doc
  readonly meta: Y.Map<unknown>
  readonly objects: Y.Map<Y.Map<unknown>>
  readonly assets: Y.Map<unknown>
  readonly comments: Y.Map<Y.Map<unknown>>

  constructor(doc: Y.Doc = new Y.Doc()) {
    this.doc = doc
    this.meta = doc.getMap('meta')
    this.objects = doc.getMap('objects')
    this.assets = doc.getMap('assets')
    this.comments = doc.getMap('comments')
  }

  /** Initialise meta on a fresh board (no-op when already initialised). */
  init(meta: { title: string; createdBy?: string }, origin: Origin = { kind: 'migration' }): void {
    if (this.meta.has('schemaVersion')) return
    this.doc.transact(() => {
      this.meta.set('schemaVersion', SCHEMA_VERSION)
      this.meta.set('title', meta.title)
      this.meta.set('createdAt', Date.now())
      if (meta.createdBy) this.meta.set('createdBy', meta.createdBy)
    }, origin)
  }

  getMeta(): BoardMeta {
    return {
      schemaVersion: Number(this.meta.get('schemaVersion') ?? 0),
      title: String(this.meta.get('title') ?? ''),
      createdAt: Number(this.meta.get('createdAt') ?? 0),
      createdBy: this.meta.get('createdBy') as string | undefined,
      background: this.meta.get('background') as string | undefined,
    }
  }

  setTitle(title: string, origin: Origin): void {
    this.doc.transact(() => this.meta.set('title', title), origin)
  }

  /** Top-most z key among siblings of `parentId`. */
  private lastIndex(parentId: string | null): string | null {
    let max: string | null = null
    for (const m of this.objects.values()) {
      if ((m.get('parentId') ?? null) !== parentId) continue
      const idx = m.get('index') as string
      if (max === null || idx > max) max = idx
    }
    return max
  }

  /** Add objects (validated). Missing id/index are generated; returns the stored ids. */
  add(inputs: ReadonlyArray<Omit<CanvasObjectInput, 'id' | 'index' | 'parentId'> & Partial<Pick<CanvasObjectInput, 'id' | 'index' | 'parentId'>>>, origin: Origin): string[] {
    const ids: string[] = []
    this.doc.transact(() => {
      for (const input of inputs) {
        const id = input.id ?? newObjectId()
        if (this.objects.has(id)) throw new CanvasValidationError(id, ['duplicate id'])
        const parentId = input.parentId ?? null
        if (parentId !== null && !this.objects.has(parentId)) throw new CanvasValidationError(id, [`unknown parent ${parentId}`])
        const index = input.index ?? keyBetween(this.lastIndex(parentId), null)
        const res = validateObject({ ...input, id, index, parentId, updatedAt: Date.now() })
        if (!res.ok) throw new CanvasValidationError(id, res.issues)
        this.objects.set(id, toYMap(res.value))
        ids.push(id)
      }
    }, origin)
    return ids
  }

  get(id: string): CanvasObject | undefined {
    const m = this.objects.get(id)
    return m ? fromYMap(m) : undefined
  }

  /** All objects, parents before children, siblings by z-order. */
  list(): CanvasObject[] {
    const all = [...this.objects.values()].map(fromYMap)
    const byParent = new Map<string | null, CanvasObject[]>()
    for (const o of all) {
      const p = o.parentId !== null && this.objects.has(o.parentId) ? o.parentId : null
      const list = byParent.get(p) ?? []
      list.push(o)
      byParent.set(p, list)
    }
    const out: CanvasObject[] = []
    const seen = new Set<string>()
    const walk = (p: string | null) => {
      const kids = (byParent.get(p) ?? []).sort((a, b) => (a.index < b.index ? -1 : a.index > b.index ? 1 : a.id < b.id ? -1 : 1))
      for (const k of kids) {
        if (seen.has(k.id)) continue
        seen.add(k.id)
        out.push(k)
        walk(k.id)
      }
    }
    walk(null)
    // Objects caught in a parent cycle (possible after concurrent re-parenting) surface at the root.
    for (const o of all) if (!seen.has(o.id)) { seen.add(o.id); out.push(o) }
    return out
  }

  /** Shallow patch; `style`/`props` merge key-wise. Result is re-validated. */
  update(id: string, patch: Partial<Omit<CanvasObject, 'id'>>, origin: Origin): void {
    const m = this.objects.get(id)
    if (!m) throw new CanvasValidationError(id, ['not found'])
    const current = fromYMap(m)
    const next = {
      ...current, ...patch,
      style: patch.style ? { ...current.style, ...patch.style } : current.style,
      props: patch.props ? { ...current.props, ...patch.props } : current.props,
      id, updatedAt: Date.now(),
    }
    if (next.parentId !== null && (next.parentId === id || this.isDescendant(next.parentId, id))) throw new CanvasValidationError(id, ['parent cycle'])
    const res = validateObject(next)
    if (!res.ok) throw new CanvasValidationError(id, res.issues)
    this.doc.transact(() => {
      for (const [k, v] of Object.entries(res.value)) {
        if (k === 'props') {
          const props = m.get('props') as Y.Map<unknown>
          const val = v as Record<string, unknown>
          for (const pk of [...props.keys()]) if (!(pk in val)) props.delete(pk)
          for (const [pk, pv] of Object.entries(val)) {
            if (pk === TEXT_PROP && typeof pv === 'string') {
              const t = props.get(pk)
              if (t instanceof Y.Text) { if (t.toString() !== pv) { t.delete(0, t.length); t.insert(0, pv) } }
              else props.set(pk, new Y.Text(pv))
            } else if (!deepEqual(plain(props.get(pk)), pv)) props.set(pk, pv)
          }
        } else if (!deepEqual(m.get(k), v)) m.set(k, v)
      }
    }, origin)
  }

  /** Delete objects and all their descendants. */
  delete(ids: readonly string[], origin: Origin): string[] {
    const doomed = new Set<string>()
    const childrenOf = new Map<string, string[]>()
    for (const [id, m] of this.objects.entries()) {
      const p = m.get('parentId') as string | null
      if (p !== null) childrenOf.set(p, [...(childrenOf.get(p) ?? []), id])
    }
    const stack = ids.filter(id => this.objects.has(id))
    while (stack.length) {
      const id = stack.pop()!
      if (doomed.has(id)) continue
      doomed.add(id)
      stack.push(...(childrenOf.get(id) ?? []))
    }
    this.doc.transact(() => { for (const id of doomed) this.objects.delete(id) }, origin)
    return [...doomed]
  }

  /** Move `id` directly above `aboveId` among its siblings (null = to back). */
  reorder(id: string, placement: 'front' | 'back' | { after: string } , origin: Origin): void {
    const m = this.objects.get(id)
    if (!m) throw new CanvasValidationError(id, ['not found'])
    const parent = (m.get('parentId') ?? null) as string | null
    const siblings = [...this.objects.entries()]
      .filter(([sid, s]) => sid !== id && (s.get('parentId') ?? null) === parent)
      .map(([, s]) => s.get('index') as string)
      .sort()
    let key: string
    if (placement === 'front') key = keyBetween(siblings.at(-1) ?? null, null)
    else if (placement === 'back') key = keyBetween(null, siblings[0] ?? null)
    else {
      const ref = this.objects.get(placement.after)
      if (!ref || (ref.get('parentId') ?? null) !== parent) throw new CanvasValidationError(id, ['reorder target is not a sibling'])
      const refIdx = ref.get('index') as string
      const next = siblings.find(s => s > refIdx) ?? null
      key = keyBetween(refIdx, next)
    }
    this.doc.transact(() => m.set('index', key), origin)
  }

  private isDescendant(candidate: string, ancestor: string): boolean {
    let cur: string | null = candidate
    const guard = new Set<string>()
    while (cur !== null && !guard.has(cur)) {
      if (cur === ancestor) return true
      guard.add(cur)
      cur = (this.objects.get(cur)?.get('parentId') ?? null) as string | null
    }
    return false
  }

  /** Live Y.Text of a text-bearing object (for editor binding). */
  textOf(id: string): Y.Text | undefined {
    const t = (this.objects.get(id)?.get('props') as Y.Map<unknown> | undefined)?.get(TEXT_PROP)
    return t instanceof Y.Text ? t : undefined
  }
}

function toYMap(o: CanvasObject): Y.Map<unknown> {
  const m = new Y.Map<unknown>()
  for (const [k, v] of Object.entries(o)) {
    if (k === 'props') {
      const props = new Y.Map<unknown>()
      for (const [pk, pv] of Object.entries(v as Record<string, unknown>)) props.set(pk, pk === TEXT_PROP && typeof pv === 'string' ? new Y.Text(pv) : pv)
      m.set('props', props)
    } else if (v !== undefined) m.set(k, v)
  }
  return m
}

function plain(v: unknown): unknown {
  if (v instanceof Y.Text) return v.toString()
  if (v instanceof Y.Map) return Object.fromEntries([...v.entries()].map(([k, x]) => [k, plain(x)]))
  if (v instanceof Y.Array) return v.toArray().map(plain)
  return v
}

function fromYMap(m: Y.Map<unknown>): CanvasObject {
  return plain(m) as CanvasObject
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const ka = Object.keys(a as object), kb = Object.keys(b as object)
  if (ka.length !== kb.length) return false
  return ka.every(k => deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
}
