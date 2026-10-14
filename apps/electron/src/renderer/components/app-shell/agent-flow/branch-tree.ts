/**
 * Dialogue branch tree (top50 #15) — builds the nested branch tree of the
 * family the current session belongs to, from `branchFromSessionId` lineage.
 * Pure; no React.
 */

export interface BranchSessionLike {
  id: string
  name?: string
  preview?: string
  branchFromSessionId?: string
  createdAt?: number
  isArchived?: boolean
}

export interface BranchNode {
  id: string
  title: string
  depth: number
  children: BranchNode[]
  isCurrent: boolean
}

export interface BranchTree {
  root: BranchNode
  /** Total sessions in the tree (root included). */
  size: number
  /** Ancestors of the current session, root first (current excluded). */
  path: string[]
}

export function branchTitle(s: BranchSessionLike): string {
  return (s.name || s.preview || '').trim()
}

export function buildBranchTree(
  sessions: Iterable<BranchSessionLike>,
  currentId: string,
): BranchTree | null {
  const byId = new Map<string, BranchSessionLike>()
  for (const s of sessions) if (!s.isArchived || s.id === currentId) byId.set(s.id, s)
  const current = byId.get(currentId)
  if (!current) return null

  // Walk up to the top ancestor present in the set (cycle-safe).
  const path: string[] = []
  const seen = new Set<string>([current.id])
  let top = current
  while (top.branchFromSessionId && byId.has(top.branchFromSessionId) && !seen.has(top.branchFromSessionId)) {
    top = byId.get(top.branchFromSessionId)!
    seen.add(top.id)
    path.unshift(top.id)
  }

  const childrenOf = new Map<string, BranchSessionLike[]>()
  for (const s of byId.values()) {
    if (!s.branchFromSessionId || !byId.has(s.branchFromSessionId) || s.id === top.id) continue
    const arr = childrenOf.get(s.branchFromSessionId) ?? []
    arr.push(s)
    childrenOf.set(s.branchFromSessionId, arr)
  }

  let size = 0
  const visited = new Set<string>()
  const build = (s: BranchSessionLike, depth: number): BranchNode => {
    visited.add(s.id)
    size++
    const kids = (childrenOf.get(s.id) ?? [])
      .filter((c) => !visited.has(c.id))
      .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0) || a.id.localeCompare(b.id))
    return { id: s.id, title: branchTitle(s), depth, isCurrent: s.id === currentId, children: kids.map((c) => build(c, depth + 1)) }
  }
  const root = build(top, 0)
  return size > 1 ? { root, size, path } : null
}

/** Depth-first flattening (for a roving-focus tree list). */
export function flattenBranchTree(node: BranchNode, out: BranchNode[] = []): BranchNode[] {
  out.push(node)
  for (const c of node.children) flattenBranchTree(c, out)
  return out
}
