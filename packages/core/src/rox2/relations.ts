/**
 * In-memory relation graph over the existing Rox2Relation contract (issue #336).
 * Not a second store: edges are the same Rox2Relation records plus deletion policy.
 */

import { createHash } from 'node:crypto'
import {
  ROX2_RELATION_DELETION_POLICY,
  assertRelationKinds,
  isAcyclicRelationKind,
  type Rox2EntityKind,
  type Rox2Permission,
  type Rox2Relation,
  type Rox2RelationKind,
} from './platform-contract.ts'

export type Rox2RelationEdge = Rox2Relation & {
  id: string
}

export type Rox2RelationSnapshot = {
  sha256: string
  edges: Rox2RelationEdge[]
}

export type Rox2GraphQuery = {
  viewerPermissions?: Readonly<Record<string, readonly Rox2Permission[]>>
}

export class Rox2RelationCycleError extends Error {
  constructor(readonly kind: Rox2RelationKind, readonly fromId: string, readonly toId: string) {
    super(`Relation ${kind} would create a cycle: ${fromId} → ${toId}`)
    this.name = 'Rox2RelationCycleError'
  }
}

export function deletionPolicyFor(kind: Rox2RelationKind): 'cascade' | 'restrict' | 'detach' {
  return ROX2_RELATION_DELETION_POLICY[kind]
}

export function fingerprintRelations(edges: readonly Rox2RelationEdge[]): string {
  const normalized = [...edges]
    .map((edge) => ({ id: edge.id, fromId: edge.fromId, toId: edge.toId, kind: edge.kind, domain: edge.domain, range: edge.range }))
    .sort((a, b) => a.id.localeCompare(b.id))
  return createHash('sha256').update(JSON.stringify(normalized), 'utf8').digest('hex')
}

function edgeId(relation: Rox2Relation): string {
  return `${relation.kind}:${relation.fromId}->${relation.toId}`
}

function reachable(fromId: string, kind: Rox2RelationKind, edges: readonly Rox2Relation[]): Set<string> {
  const seen = new Set<string>()
  const stack = [fromId]
  while (stack.length > 0) {
    const current = stack.pop()!
    if (seen.has(current)) continue
    seen.add(current)
    for (const edge of edges) {
      if (edge.kind === kind && edge.fromId === current && !seen.has(edge.toId)) stack.push(edge.toId)
    }
  }
  return seen
}

export class Rox2RelationGraph {
  private edges = new Map<string, Rox2RelationEdge>()

  snapshot(): Rox2RelationSnapshot {
    const edges = [...this.edges.values()].map((edge) => ({ ...edge }))
    return { sha256: fingerprintRelations(edges), edges }
  }

  restore(snapshot: Rox2RelationSnapshot): void {
    this.edges.clear()
    for (const edge of snapshot.edges) this.edges.set(edge.id, { ...edge })
  }

  add(
    relation: Rox2Relation,
    fromKind: Rox2EntityKind,
    toKind: Rox2EntityKind,
  ): Rox2RelationEdge {
    assertRelationKinds(relation, fromKind, toKind)
    if (isAcyclicRelationKind(relation.kind) && reachable(relation.toId, relation.kind, [...this.edges.values()]).has(relation.fromId)) {
      throw new Rox2RelationCycleError(relation.kind, relation.fromId, relation.toId)
    }
    const edge: Rox2RelationEdge = {
      ...relation,
      domain: relation.domain ?? fromKind,
      range: relation.range ?? toKind,
      id: edgeId(relation),
    }
    this.edges.set(edge.id, edge)
    return edge
  }

  removeEntity(entityId: string): Rox2RelationEdge[] {
    const removed: Rox2RelationEdge[] = []
    for (const [id, edge] of this.edges) {
      if (edge.fromId === entityId || edge.toId === entityId) {
        this.edges.delete(id)
        removed.push(edge)
      }
    }
    return removed
  }

  query(opts: Rox2GraphQuery = {}): Rox2RelationEdge[] {
    const perms = opts.viewerPermissions
    const edges = [...this.edges.values()]
    if (!perms) return edges
    return edges.filter((edge) => {
      const from = perms[edge.fromId]
      const to = perms[edge.toId]
      return Boolean(from?.includes('read') && to?.includes('read'))
    })
  }
}
