/**
 * Helpers for «Доска» frame + image objects (clean-room — no HyCanvas code/assets).
 */
import type { CanvasObject } from '@rox/canvas-core'
import { CONTAINER_TYPES, isObjectType } from '@rox/canvas-core'

export type ImageFit = 'cover' | 'contain' | 'fill'

/** SVG preserveAspectRatio for object-fit. */
export function imagePreserveAspectRatio(fit: unknown): string {
  if (fit === 'cover') return 'xMidYMid slice'
  if (fit === 'fill') return 'none'
  return 'xMidYMid meet' // contain (default)
}

export function readImageFit(props: Record<string, unknown> | undefined): ImageFit {
  const f = props?.fit
  if (f === 'cover' || f === 'fill' || f === 'contain') return f
  return 'contain'
}

export function readFrameLabel(o: CanvasObject, fallback: string): string {
  if (typeof o.name === 'string' && o.name.trim()) return o.name.trim()
  const label = o.props?.label
  if (typeof label === 'string' && label.trim()) return label.trim()
  return fallback
}

export function frameClips(o: CanvasObject): boolean {
  return o.props?.clip === true
}

/** True when this type may own children via parentId. */
export function isContainerObject(o: CanvasObject): boolean {
  return isObjectType(o.type) && CONTAINER_TYPES.has(o.type)
}

/**
 * If the selection is exactly one unlocked container, new objects nest under it.
 * Coordinates stay absolute (board space); parentId is hierarchy only.
 */
export function nestParentId(selected: readonly CanvasObject[]): string | null {
  if (selected.length !== 1) return null
  const o = selected[0]!
  if (!isContainerObject(o) || o.locked) return null
  return o.id
}

/** Group objects by parentId for tree rendering (missing parents → root). */
export function childrenByParent(objects: readonly CanvasObject[]): Map<string | null, CanvasObject[]> {
  const known = new Set(objects.map(o => o.id))
  const map = new Map<string | null, CanvasObject[]>()
  for (const o of objects) {
    const p = o.parentId !== null && known.has(o.parentId) ? o.parentId : null
    const list = map.get(p) ?? []
    list.push(o)
    map.set(p, list)
  }
  for (const list of map.values()) {
    list.sort((a, b) => (a.index < b.index ? -1 : a.index > b.index ? 1 : a.id < b.id ? -1 : 1))
  }
  return map
}

/** Default place size for a newly inserted image (contain box). */
export function defaultImageBox(naturalW: number, naturalH: number, max = 480): { w: number; h: number } {
  const w0 = Number.isFinite(naturalW) && naturalW > 0 ? naturalW : max
  const h0 = Number.isFinite(naturalH) && naturalH > 0 ? naturalH : max
  const scale = Math.min(1, max / Math.max(w0, h0))
  return { w: Math.max(40, Math.round(w0 * scale)), h: Math.max(40, Math.round(h0 * scale)) }
}

export const DEFAULT_FRAME = { w: 420, h: 300 } as const

/** Depth-first descendant ids of `rootId` (not including root). */
export function collectDescendantIds(objects: readonly CanvasObject[], rootId: string): string[] {
  const byParent = new Map<string, string[]>()
  for (const o of objects) {
    if (o.parentId === null) continue
    const list = byParent.get(o.parentId) ?? []
    list.push(o.id)
    byParent.set(o.parentId, list)
  }
  const out: string[] = []
  const stack = [...(byParent.get(rootId) ?? [])]
  const seen = new Set<string>()
  while (stack.length) {
    const id = stack.pop()!
    if (seen.has(id)) continue
    seen.add(id)
    out.push(id)
    stack.push(...(byParent.get(id) ?? []))
  }
  return out
}
