import type { RuntimeFlowNode } from '../nodes/RuntimeNodeCard'
import type { AgentLaneNode } from '../AgentLane'

export type RuntimeCanvasNode = RuntimeFlowNode | AgentLaneNode

/** Controlled React Flow must see a new object only for an actually changed node. */
export function reconcileFlowNodes(previous: Map<string, RuntimeCanvasNode>, candidates: RuntimeCanvasNode[]): { nodes: RuntimeCanvasNode[]; cache: Map<string, RuntimeCanvasNode> } {
  const cache = new Map<string, RuntimeCanvasNode>()
  const nodes = candidates.map(candidate => {
    const old = previous.get(candidate.id)
    let equal = old?.type === candidate.type && old?.selected === candidate.selected && old?.position.x === candidate.position.x && old?.position.y === candidate.position.y && old?.ariaLabel === candidate.ariaLabel
    if (equal && old?.type === 'runtime' && candidate.type === 'runtime') equal = old.data.runtime === candidate.data.runtime
    else if (equal && old?.type === 'lane' && candidate.type === 'lane') {
      const a = old.data.lane, b = candidate.data.lane
      equal = old.data.collapsed === candidate.data.collapsed && old.data.onToggle === candidate.data.onToggle && a.name === b.name && a.depth === b.depth && a.status === b.status && a.orphan === b.orphan && a.parentAgentId === b.parentAgentId && a.assignment === b.assignment && a.nodeIds.length === b.nodeIds.length && a.nodeIds.every((id, index) => id === b.nodeIds[index])
    } else equal = false
    const node = equal && old ? old : candidate
    cache.set(node.id, node)
    return node
  })
  return { nodes, cache }
}
