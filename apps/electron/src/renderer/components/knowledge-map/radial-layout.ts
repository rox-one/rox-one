/**
 * radial-layout — pure, deterministic radial graph layout for the knowledge map.
 *
 * Ported from the donor algorithm (`_asn` in `skills/kb-search/gitmark.py`,
 * `cmd_map`): BFS levels from the root node over the undirected edge set, then
 * an angular sweep where each node occupies a sector proportional to its leaf
 * count and sits at the middle of that sector. Nodes unreachable from the root
 * ("orphans") are parked on an outer ring with equal sectors.
 *
 * No DOM, no dependencies — unit-testable. Coordinates are ring units: a node
 * at BFS level `n` has radius `n` (root at radius 0). The SVG component scales
 * them to pixels; `layers` carries the per-level radius for the ring guides.
 */

import type { KnowledgeMapDto } from '@rox/shared/knowledge/knowledge-map-types'

export interface RadialNodePosition {
  id: string
  /** BFS distance from the root (0 = root). Orphans sit at `maxLevel + 1`. */
  level: number
  /** Middle of the node's sector, radians in [0, 2π). */
  angle: number
  /** Start of the node's sector, radians. */
  angleStart: number
  /** End of the node's sector, radians. */
  angleEnd: number
  /** Ring radius in layout units (=== level). */
  radius: number
  x: number
  y: number
  /** Number of leaves in the node's subtree (1 for a leaf). */
  leafCount: number
  parentId: string | null
  isRoot: boolean
  /** True for nodes unreachable from the root (parked on the outer ring). */
  onOuterRing: boolean
}

export interface RadialLayer {
  level: number
  radius: number
  count: number
}

export interface RadialLayout {
  positions: RadialNodePosition[]
  byId: Map<string, RadialNodePosition>
  layers: RadialLayer[]
  maxLevel: number
  /** Outermost radius in layout units. */
  radius: number
  rootId: string | null
}

const TWO_PI = Math.PI * 2

/** Layout of an empty node set: valid root-less shell, no rings. */
function emptyLayout(): RadialLayout {
  return { positions: [], byId: new Map(), layers: [], maxLevel: 0, radius: 0, rootId: null }
}

/**
 * Build the radial layout for a knowledge map DTO.
 *
 * Deterministic: identical input yields identical output (all iteration runs
 * over id-sorted collections).
 */
export function radialLayout(dto: Pick<KnowledgeMapDto, 'nodes' | 'edges'>): RadialLayout {
  const nodes = [...dto.nodes].sort((a, b) => a.id.localeCompare(b.id))
  if (nodes.length === 0) return emptyLayout()

  const adjacency = new Map<string, Set<string>>()
  for (const node of nodes) adjacency.set(node.id, new Set())
  for (const edge of dto.edges) {
    if (edge.source === edge.target) continue
    const from = adjacency.get(edge.source)
    const to = adjacency.get(edge.target)
    if (!from || !to) continue
    from.add(edge.target)
    to.add(edge.source)
  }

  const rootNode = nodes.find((node) => node.kind === 'root') ?? nodes[0]
  const rootId = rootNode.id

  // BFS levels and spanning tree.
  const level = new Map<string, number>([[rootId, 0]])
  const parent = new Map<string, string | null>([[rootId, null]])
  const queue: string[] = [rootId]
  while (queue.length > 0) {
    const current = queue.shift() as string
    const neighbours = [...(adjacency.get(current) ?? [])].sort((a, b) => a.localeCompare(b))
    for (const next of neighbours) {
      if (level.has(next)) continue
      level.set(next, (level.get(current) as number) + 1)
      parent.set(next, current)
      queue.push(next)
    }
  }

  const children = new Map<string, string[]>()
  for (const [node, nodeParent] of parent) {
    if (nodeParent === null) continue
    const list = children.get(nodeParent)
    if (list) list.push(node)
    else children.set(nodeParent, [node])
  }
  for (const list of children.values()) list.sort((a, b) => a.localeCompare(b))

  // Leaf counts (subtree sizes) drive the angular sector widths.
  const leaves = new Map<string, number>()
  const countLeaves = (node: string): number => {
    const kids = children.get(node)
    if (!kids || kids.length === 0) {
      leaves.set(node, 1)
      return 1
    }
    let total = 0
    for (const child of kids) total += countLeaves(child)
    leaves.set(node, total)
    return total
  }
  countLeaves(rootId)

  const angle = new Map<string, number>()
  const span = new Map<string, [number, number]>()
  const assign = (node: string, start: number, end: number): void => {
    angle.set(node, (start + end) / 2)
    span.set(node, [start, end])
    const kids = children.get(node)
    if (!kids || kids.length === 0) return
    let total = 0
    for (const child of kids) total += leaves.get(child) ?? 1
    if (total <= 0) total = 1
    let cursor = start
    for (const child of kids) {
      const width = ((end - start) * (leaves.get(child) ?? 1)) / total
      assign(child, cursor, cursor + width)
      cursor += width
    }
  }
  assign(rootId, 0, TWO_PI)

  let maxLevel = 0
  for (const value of level.values()) if (value > maxLevel) maxLevel = value

  // Orphans: unreachable nodes get the next ring, equal sectors around it.
  const orphanIds = nodes
    .filter((node) => !level.has(node.id))
    .map((node) => node.id)
    .sort((a, b) => a.localeCompare(b))
  const orphanLevel = maxLevel + 1
  const orphanCount = orphanIds.length
  orphanIds.forEach((id, index) => {
    level.set(id, orphanLevel)
    const start = (TWO_PI * index) / Math.max(1, orphanCount)
    const end = (TWO_PI * (index + 1)) / Math.max(1, orphanCount)
    span.set(id, [start, end])
    angle.set(id, (start + end) / 2)
  })
  if (orphanCount > 0) maxLevel = orphanLevel

  const orphanSet = new Set(orphanIds)
  const positions: RadialNodePosition[] = nodes.map((node) => {
    const nodeLevel = level.get(node.id) ?? orphanLevel
    const nodeAngle = angle.get(node.id) ?? 0
    const nodeSpan = span.get(node.id) ?? [nodeAngle, nodeAngle]
    const radius = nodeLevel
    return {
      id: node.id,
      level: nodeLevel,
      angle: nodeAngle,
      angleStart: nodeSpan[0],
      angleEnd: nodeSpan[1],
      radius,
      x: Math.cos(nodeAngle) * radius,
      y: Math.sin(nodeAngle) * radius,
      leafCount: leaves.get(node.id) ?? 1,
      parentId: parent.get(node.id) ?? null,
      isRoot: node.id === rootId,
      onOuterRing: orphanSet.has(node.id),
    }
  })

  const counts = new Map<number, number>()
  for (const position of positions) counts.set(position.level, (counts.get(position.level) ?? 0) + 1)
  const layers: RadialLayer[] = [...counts.keys()]
    .sort((a, b) => a - b)
    .map((levelValue) => ({ level: levelValue, radius: levelValue, count: counts.get(levelValue) ?? 0 }))

  return {
    positions,
    byId: new Map(positions.map((position) => [position.id, position])),
    layers,
    maxLevel,
    radius: maxLevel,
    rootId,
  }
}