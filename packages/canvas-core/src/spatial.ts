/**
 * Viewport culling: an R-tree (rbush) over object bounding boxes, kept in sync
 * incrementally from Yjs events (only changed objects are re-indexed).
 * Rotated objects are indexed by their rotated bounding box.
 */
import RBush from 'rbush'
import type * as Y from 'yjs'
import type { CanvasDoc } from './doc.ts'

export interface Box { minX: number; minY: number; maxX: number; maxY: number }
interface Item extends Box { id: string }

function boxOf(m: Y.Map<unknown>): Box | null {
  const x = Number(m.get('x')), y = Number(m.get('y')), w = Number(m.get('w')), h = Number(m.get('h'))
  if (![x, y, w, h].every(Number.isFinite)) return null
  const rot = Number(m.get('rotation') ?? 0)
  if (!rot) return { minX: x, minY: y, maxX: x + w, maxY: y + h }
  const cx = x + w / 2, cy = y + h / 2, r = (rot * Math.PI) / 180
  const hw = (Math.abs(Math.cos(r)) * w + Math.abs(Math.sin(r)) * h) / 2
  const hh = (Math.abs(Math.sin(r)) * w + Math.abs(Math.cos(r)) * h) / 2
  return { minX: cx - hw, minY: cy - hh, maxX: cx + hw, maxY: cy + hh }
}

export class SpatialIndex {
  private tree = new RBush<Item>()
  private items = new Map<string, Item>()
  private off: () => void

  constructor(private board: CanvasDoc) {
    const all: Item[] = []
    for (const [id, m] of board.objects.entries()) {
      const b = boxOf(m)
      if (b) { const it = { ...b, id }; this.items.set(id, it); all.push(it) }
    }
    this.tree.load(all) // bulk load: O(n log n), much faster than n inserts
    const onDeep = (events: Y.YEvent<Y.AbstractType<unknown>>[]) => {
      const touched = new Set<string>()
      for (const ev of events) {
        if (ev.target === board.objects) for (const k of ev.changes.keys.keys()) touched.add(k)
        else {
          // nested change: walk up to the object map
          let t: Y.AbstractType<unknown> | null = ev.target
          while (t && t.parent && t.parent !== board.objects) t = t.parent as Y.AbstractType<unknown>
          const key = t ? (t as unknown as { _item?: { parentSub?: string } })._item?.parentSub : undefined
          if (key) touched.add(key)
        }
      }
      for (const id of touched) this.reindex(id)
    }
    board.objects.observeDeep(onDeep)
    this.off = () => board.objects.unobserveDeep(onDeep)
  }

  private reindex(id: string): void {
    const prev = this.items.get(id)
    if (prev) { this.tree.remove(prev); this.items.delete(id) }
    const m = this.board.objects.get(id)
    const b = m ? boxOf(m) : null
    if (b) { const it = { ...b, id }; this.items.set(id, it); this.tree.insert(it) }
  }

  /** Ids whose boxes intersect `view` (world coordinates). */
  query(view: Box): Set<string> {
    return new Set(this.tree.search(view).map(i => i.id))
  }

  get size(): number { return this.items.size }
  dispose(): void { this.off() }
}
