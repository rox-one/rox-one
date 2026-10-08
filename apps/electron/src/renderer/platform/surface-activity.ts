/**
 * W1-07 (#1504) — which unified surfaces are mounted right now.
 *
 * `SurfaceHost` marks its surface while mounted. Keybinding `when` clauses
 * read it synchronously (e.g. the ⌃1…4 quick panels are Messenger-only,
 * UI-SPEC §15) without React state or re-renders.
 */
import type { UnifiedSurfaceId } from '../../shared/surface-routes'

const mounted = new Map<UnifiedSurfaceId, number>()

/** Mark `surface` mounted; returns the unmark function (idempotent). */
export function markSurfaceMounted(surface: UnifiedSurfaceId): () => void {
  mounted.set(surface, (mounted.get(surface) ?? 0) + 1)
  let done = false
  return () => {
    if (done) return
    done = true
    const next = (mounted.get(surface) ?? 1) - 1
    if (next <= 0) mounted.delete(surface)
    else mounted.set(surface, next)
  }
}

export function isSurfaceMounted(surface: UnifiedSurfaceId): boolean {
  return (mounted.get(surface) ?? 0) > 0
}

export function __resetSurfaceActivityForTests(): void {
  mounted.clear()
}
