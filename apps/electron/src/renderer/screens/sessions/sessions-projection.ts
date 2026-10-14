import type { SessionsSidebarInput } from './sessions-sidebar-sections'

/**
 * Narrow projection of session metadata: only the fields the sidebar reads.
 * Streaming ticks that touch other fields (token counts, previews of other
 * fields…) keep the same projection, so nothing rebuilds or republishes.
 */
const PROJECTED_KEYS = ['id', 'name', 'preview', 'lastMessageAt', 'createdAt', 'isProcessing', 'isFlagged', 'hasUnread', 'labels', 'sessionStatus', 'hidden', 'isArchived', 'parentSessionId', 'sharedUrl'] as const

export function projectSessionsSidebarInput(metas: Iterable<SessionsSidebarInput>): SessionsSidebarInput[] {
  const out: SessionsSidebarInput[] = []
  for (const m of metas) {
    const p: Record<string, unknown> = {}
    for (const k of PROJECTED_KEYS) if (m[k] !== undefined) p[k] = m[k]
    out.push(p as unknown as SessionsSidebarInput)
  }
  return out
}

function sameValue(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => x === b[i])
  return a === b
}

export function sameSessionsProjection(a: readonly SessionsSidebarInput[], b: readonly SessionsSidebarInput[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!, y = b[i]!
    for (const k of PROJECTED_KEYS) if (!sameValue(x[k], y[k])) return false
  }
  return true
}

