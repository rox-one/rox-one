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
import { isValidIndexKey, keyBetween, keysBetween } from './fractional-index.ts'
import { wellFormed } from './text.ts'

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

  /** Plain snapshots per object, invalidated per changed id (Yjs reads are costly). */
  private plainCache = new Map<string, CanvasObject>()
  private listCache: CanvasObject[] | null = null

  constructor(doc: Y.Doc = new Y.Doc()) {
    this.doc = doc
    this.meta = doc.getMap('meta')
    this.objects = doc.getMap('objects')
    this.assets = doc.getMap('assets')
    this.comments = doc.getMap('comments')
    this.objects.observeDeep(events => {
      this.listCache = null
      for (const ev of events) {
        if (ev.target === this.objects) { for (const k of ev.changes.keys.keys()) this.plainCache.delete(k); continue }
        let t: Y.AbstractType<unknown> | null = ev.target
        while (t && t.parent && t.parent !== this.objects) t = t.parent as Y.AbstractType<unknown>
        const key = (t as unknown as { _item?: { parentSub?: string | null } } | null)?._item?.parentSub
        if (key) this.plainCache.delete(key)
        else this.plainCache.clear()
      }
    })
  }

  private plainOf(id: string, m: Y.Map<unknown>): CanvasObject {
    let o = this.plainCache.get(id)
    if (!o) { o = Object.freeze(fromYMap(m)) as CanvasObject; this.plainCache.set(id, o) }
    return o
  }

  /** Initialise meta on a fresh board (no-op when already initialised). */
  init(meta: { title: string; createdBy?: string }, origin: Origin = { kind: 'migration' }): void {
    if (this.meta.has('schemaVersion')) return
    this.doc.transact(() => {
      this.meta.set('schemaVersion', SCHEMA_VERSION)
      this.meta.set('title', wellFormed(meta.title))
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
    this.doc.transact(() => this.meta.set('title', wellFormed(title)), origin)
  }

  /** Top-most z key among siblings of `parentId`. */
  private lastIndex(parentId: string | null): string | null {
    let max: string | null = null
    for (const [id, m] of this.objects.entries()) {
      const o = this.plainOf(id, m)
      if ((o.parentId ?? null) !== parentId) continue
      const idx: unknown = o.index
      // Keys from remote peers are not validated; ignore malformed ones.
      if (typeof idx !== 'string' || !isValidIndexKey(idx)) continue
      if (max === null || idx > max) max = idx
    }
    return max
  }

  /**
   * Add objects. All inputs are validated before anything is written, so a bad
   * input never leaves a partial insert. Parents may be existing objects or
   * earlier entries of the same batch. Missing id/index are generated (the top
   * z-key of each parent is computed once per call).
   */
  add(inputs: ReadonlyArray<Omit<CanvasObjectInput, 'id' | 'index' | 'parentId'> & Partial<Pick<CanvasObjectInput, 'id' | 'index' | 'parentId'>>>, origin: Origin): string[] {
    const prepared: CanvasObject[] = []
    const batchIds = new Set<string>()
    const top = new Map<string | null, string | null>()
    const now = Date.now()
    for (const input of inputs) {
      const id = input.id ?? newObjectId()
      if (this.objects.has(id) || batchIds.has(id)) throw new CanvasValidationError(id, ['duplicate id'])
      const parentId = input.parentId ?? null
      if (parentId !== null && !this.objects.has(parentId) && !batchIds.has(parentId)) throw new CanvasValidationError(id, [`unknown parent ${parentId}`])
      let index = input.index
      if (index === undefined) {
        const last = top.has(parentId) ? top.get(parentId)! : this.lastIndex(parentId)
        index = keyBetween(last, null)
      }
      if (isValidIndexKey(index)) {
        const prev = top.has(parentId) ? top.get(parentId)! : this.lastIndex(parentId)
        top.set(parentId, prev === null || index > prev ? index : prev)
      }
      const res = validateObject({ ...input, id, index, parentId, updatedAt: now })
      if (!res.ok) throw new CanvasValidationError(id, res.issues)
      prepared.push(res.value)
      batchIds.add(id)
    }
    this.doc.transact(() => {
      for (const o of prepared) this.objects.set(o.id, toYMap(o))
    }, origin)
    return prepared.map(o => o.id)
  }

  get(id: string): CanvasObject | undefined {
    const m = this.objects.get(id)
    return m ? this.plainOf(id, m) : undefined
  }

  /** All objects, parents before children, siblings by z-order. */
  list(): CanvasObject[] {
    if (this.listCache) return this.listCache.slice()
    const all = [...this.objects.entries()].map(([id, m]) => this.plainOf(id, m))
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
    this.listCache = out
    return out.slice()
  }

  /** Shallow patch; `style`/`props` merge key-wise. Result is re-validated. */
  update(id: string, patch: Partial<Omit<CanvasObject, 'id'>>, origin: Origin): void {
    const m = this.objects.get(id)
    if (!m) throw new CanvasValidationError(id, ['not found'])
    const current = fromYMap(m)
    const repairedIndex = isValidIndexKey(current.index) ? current.index : keyBetween(this.lastIndex((patch.parentId !== undefined ? patch.parentId : current.parentId) ?? null), null)
    const next = {
      ...current, index: repairedIndex, ...patch,
      style: patch.style ? { ...current.style, ...patch.style } : current.style,
      props: patch.props ? { ...current.props, ...patch.props } : current.props,
      id, updatedAt: Date.now(),
    }
    if (next.parentId !== null && !this.objects.has(next.parentId)) throw new CanvasValidationError(id, [`unknown parent ${next.parentId}`])
    if (next.parentId !== null && (next.parentId === id || this.isDescendant(next.parentId, id))) throw new CanvasValidationError(id, ['parent cycle'])
    const res = validateObject(next)
    if (!res.ok) throw new CanvasValidationError(id, res.issues)
    const value = res.value
    this.doc.transact(() => {
      for (const [k, v] of Object.entries(value)) {
        if (k === 'props' || k === 'style') {
          // Nested maps merge per key: only keys named in the patch are written,
          // so concurrent edits of other keys survive.
          const patchPart = (k === 'props' ? patch.props : patch.style) as Record<string, unknown> | undefined
          if (!patchPart) continue
          const nested = ensureYMap(m, k)
          const merged = v as Record<string, unknown>
          for (const pk of Object.keys(patchPart)) {
            const pv = merged[pk]
            if (pv === undefined) { nested.delete(pk); continue }
            if (k === 'props' && pk === TEXT_PROP && typeof pv === 'string') {
              const t = nested.get(pk)
              if (t instanceof Y.Text) applyTextDiff(t, pv)
              else nested.set(pk, new Y.Text(wellFormed(pv)))
            } else if (!deepEqual(plain(nested.get(pk)), pv)) nested.set(pk, pv)
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
    this.doc.transact(() => {
      // Connectors that survive keep their last endpoint position instead of dangling.
      for (const [cid, m] of this.objects.entries()) {
        if (doomed.has(cid) || m.get('type') !== 'connector') continue
        const props = m.get('props') as Y.Map<unknown> | undefined
        if (!props) continue
        for (const end of ['from', 'to'] as const) {
          const ep = props.get(end) as { objectId?: string } | undefined
          if (!ep || typeof ep.objectId !== 'string' || !doomed.has(ep.objectId)) continue
          const target = this.objects.get(ep.objectId)!
          const x = Number(target.get('x')) + Number(target.get('w')) / 2
          const y = Number(target.get('y')) + Number(target.get('h')) / 2
          props.set(end, { x: Number.isFinite(x) ? x : 0, y: Number.isFinite(y) ? y : 0 })
        }
      }
      for (const id of doomed) this.objects.delete(id)
    }, origin)
    return [...doomed]
  }

  /** Move `id` directly above `aboveId` among its siblings (null = to back). */
  reorder(id: string, placement: 'front' | 'back' | { after: string } , origin: Origin): void {
    const m = this.objects.get(id)
    if (!m) throw new CanvasValidationError(id, ['not found'])
    const parent = (m.get('parentId') ?? null) as string | null
    const siblings = [...this.objects.entries()]
      .filter(([sid, s]) => sid !== id && (s.get('parentId') ?? null) === parent)
      .map(([, s]) => s.get('index'))
      .filter((k): k is string => typeof k === 'string' && isValidIndexKey(k))
      .sort()
    let key: string
    if (placement === 'front') key = keyBetween(siblings.at(-1) ?? null, null)
    else if (placement === 'back') key = keyBetween(null, siblings[0] ?? null)
    else {
      const ref = this.objects.get(placement.after)
      if (!ref || (ref.get('parentId') ?? null) !== parent) throw new CanvasValidationError(id, ['reorder target is not a sibling'])
      const refIdx = ref.get('index')
      if (typeof refIdx !== 'string' || !isValidIndexKey(refIdx)) throw new CanvasValidationError(id, ['reorder target has an invalid index'])
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

/** Nested Y.Map at `key` (upgrades a legacy plain-object value in place). */
function ensureYMap(m: Y.Map<unknown>, key: string): Y.Map<unknown> {
  const cur = m.get(key)
  if (cur instanceof Y.Map) return cur
  const next = new Y.Map<unknown>()
  m.set(key, next)
  // Sorted keys: the upgrade must produce identical content on every peer.
  if (cur && typeof cur === 'object') for (const k of Object.keys(cur as Record<string, unknown>).sort()) next.set(k, (cur as Record<string, unknown>)[k])
  return next
}

function toYMap(o: CanvasObject): Y.Map<unknown> {
  const m = new Y.Map<unknown>()
  for (const [k, v] of Object.entries(o)) {
    if (k === 'style') {
      const style = new Y.Map<unknown>()
      for (const [sk, sv] of Object.entries(v as Record<string, unknown>)) if (sv !== undefined) style.set(sk, sv)
      m.set('style', style)
    } else if (k === 'props') {
      const props = new Y.Map<unknown>()
      for (const [pk, pv] of Object.entries(v as Record<string, unknown>)) props.set(pk, pk === TEXT_PROP && typeof pv === 'string' ? new Y.Text(wellFormed(pv)) : pv)
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

/**
 * Minimal edit: keep the common prefix/suffix so concurrent edits elsewhere
 * survive. Diffed by code point, so the edit boundaries never split a
 * surrogate pair.
 */
export function applyTextDiff(t: Y.Text, nextRaw: string): void {
  const next = wellFormed(nextRaw)
  const prev = t.toString()
  if (prev === next) return
  const a = Array.from(prev), b = Array.from(next)
  let p = 0
  const max = Math.min(a.length, b.length)
  while (p < max && a[p] === b[p]) p++
  let sfx = 0
  while (sfx < max - p && a[a.length - 1 - sfx] === b[b.length - 1 - sfx]) sfx++
  const start = a.slice(0, p).join('').length
  const delLen = a.slice(p, a.length - sfx).join('').length
  const ins = b.slice(p, b.length - sfx).join('')
  if (delLen > 0) t.delete(start, delLen)
  if (ins) t.insert(start, ins)
}


/**
 * Legacy boards (pre integer-head keys, or keys from unvalidated peers): give
 * every object whose z-key is invalid a fresh key above its valid siblings,
 * keeping the old relative order. Also upgrades plain-object style/props and
 * plain-string text to the current nested layout. Returns the ids touched.
 */
export function migrateLegacy(board: CanvasDoc, origin: Origin = { kind: 'migration' }): string[] {
  if (!needsMigration(board)) return []
  // Deterministic upgrade: run it in a fork whose clientID is derived from the
  // exact doc state. Peers migrating the same state independently produce
  // byte-identical structs (same ids, same content), which Yjs dedupes instead
  // of letting one peer's upgraded map win and drop the other's later edits.
  const base = Y.encodeStateAsUpdate(board.doc)
  const fork = new Y.Doc()
  fork.clientID = migrationClientId(base)
  Y.applyUpdate(fork, base)
  const touched = migrateInPlace(new CanvasDoc(fork))
  Y.applyUpdate(board.doc, Y.encodeStateAsUpdate(fork, Y.encodeStateVector(board.doc)), origin)
  fork.destroy()
  return touched
}

function needsMigration(board: CanvasDoc): boolean {
  for (const m of board.objects.values()) {
    const k = m.get('index')
    if (typeof k !== 'string' || !isValidIndexKey(k)) return true
    for (const f of ['style', 'props'] as const) { const v = m.get(f); if (v !== undefined && !(v instanceof Y.Map)) return true }
    const props = m.get('props')
    if (props instanceof Y.Map && typeof props.get(TEXT_PROP) === 'string') return true
  }
  return false
}

/** FNV-1a of the state, mapped into a uint32 clientID range. */
function migrationClientId(state: Uint8Array): number {
  let h = 0x811c9dc5
  for (let i = 0; i < state.length; i++) { h ^= state[i]!; h = Math.imul(h, 0x01000193) >>> 0 }
  return (h & 0x3fffffff) + 1
}

function migrateInPlace(board: CanvasDoc): string[] {
  const byParent = new Map<string | null, Array<[string, Y.Map<unknown>]>>()
  for (const id of [...board.objects.keys()].sort()) {
    const m = board.objects.get(id)!
    const p = (m.get('parentId') ?? null) as string | null
    const list = byParent.get(p) ?? []
    list.push([id, m])
    byParent.set(p, list)
  }
  const touched = new Set<string>()
  const parents = [...byParent.keys()].sort((x, y) => (x ?? '') < (y ?? '') ? -1 : (x ?? '') > (y ?? '') ? 1 : 0)
  board.doc.transact(() => {
    for (const parent of parents) {
      const list = byParent.get(parent)!
      const bad = list.filter(([, m]) => { const k = m.get('index'); return typeof k !== 'string' || !isValidIndexKey(k) })
      if (bad.length) {
        const top = list.map(([, m]) => m.get('index')).filter((k): k is string => typeof k === 'string' && isValidIndexKey(k)).sort().at(-1) ?? null
        bad.sort(([ia, a], [ib, b]) => { const ka = String(a.get('index') ?? ''), kb = String(b.get('index') ?? ''); return ka < kb ? -1 : ka > kb ? 1 : ia < ib ? -1 : 1 })
        const keys = keysBetween(top, null, bad.length)
        bad.forEach(([id, m], i) => { m.set('index', keys[i]!); touched.add(id) })
      }
      for (const [id, m] of list) {
        for (const k of ['style', 'props'] as const) {
          const v = m.get(k)
          if (v !== undefined && !(v instanceof Y.Map)) { ensureYMap(m, k); touched.add(id) }
        }
        const props = m.get('props')
        if (props instanceof Y.Map && typeof props.get(TEXT_PROP) === 'string') {
          props.set(TEXT_PROP, new Y.Text(wellFormed(props.get(TEXT_PROP) as string)))
          touched.add(id)
        }
      }
    }
  })
  return [...touched].sort()
}
