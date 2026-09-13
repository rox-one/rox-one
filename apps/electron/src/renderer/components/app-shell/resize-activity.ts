/**
 * Live panel-resize activity. Native browser suppression (ZS-07) leases this
 * reason; it is not a durable layout store.
 */

let depth = 0
const listeners = new Set<(active: boolean) => void>()

export function beginPanelResizeActivity(): void {
  depth += 1
  if (depth === 1) {
    for (const listener of listeners) listener(true)
  }
}

export function endPanelResizeActivity(): void {
  if (depth === 0) return
  depth -= 1
  if (depth === 0) {
    for (const listener of listeners) listener(false)
  }
}

export function isPanelResizeActive(): boolean {
  return depth > 0
}

export function subscribePanelResizeActivity(listener: (active: boolean) => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
