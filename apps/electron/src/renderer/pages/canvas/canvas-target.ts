/**
 * Pending «Доска» navigation target (`canvas/board/{id}#{objectId}`): set by
 * openEntity / the canvas adapter, consumed by CanvasSurfacePage, which opens
 * the board and focuses + selects the fragment object.
 */
import { parseEntityRoute } from '@rox/core/entities'

export interface CanvasTarget { boardId: string; objectId?: string }
let pending: CanvasTarget | null = null
const listeners = new Set<() => void>()

export function setCanvasTarget(t: CanvasTarget): void { pending = t; for (const l of listeners) l() }
export function takeCanvasTarget(): CanvasTarget | null { const t = pending; pending = null; return t }
export function onCanvasTarget(cb: () => void): () => void { listeners.add(cb); return () => listeners.delete(cb) }

/** Parse `canvas/board/{id}[#objectId]`; null for anything else. */
export function parseCanvasRoute(route: string): CanvasTarget | null {
  const p = parseEntityRoute(route)
  if (!p || p.ref.kind !== 'canvas') return null
  return p.ref.fragment ? { boardId: p.ref.id, objectId: p.ref.fragment } : { boardId: p.ref.id }
}
