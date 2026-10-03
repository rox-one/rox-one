import type { Node } from '@xyflow/react'
import type { SessionDraftGraph, SessionNodeKind } from './draft-nodes'
import { defaultDraftSize, draftMinimumSize } from './map-node-size'

/** Background transcript/title changes must preserve selection and an active drag. */
export function reconcileCanvasNodes(seed: Node[], current: Node[], activeId: string | null): Node[] {
  const existing = new Map(current.map((node) => [node.id, node]))
  return seed.map((node) => {
    const previous = existing.get(node.id)
    return {
      ...node,
      selected: previous?.selected ?? node.id === activeId,
      ...(previous?.measured ? { measured: previous.measured } : {}),
      ...(previous?.dragging || previous?.resizing ? {
        position: previous.position,
        width: previous.width,
        height: previous.height,
        dragging: previous.dragging,
        resizing: previous.resizing,
      } : {}),
    }
  })
}

/** Rebind incident edges when conversion changes the actual visible ports. */
export function convertDraftGraphNode(graph: SessionDraftGraph, id: string, kind: SessionNodeKind): SessionDraftGraph {
  if (!graph.nodes.some((node) => node.id === id)) return graph
  const nodes = graph.nodes.map((node) => {
    if (node.id !== id) return node
    const role = kind === 'annotation_frame' ? 'frame' as const
      : node.role === 'sticky' && kind === 'note' ? 'sticky' as const : 'node' as const
    const minimum = draftMinimumSize(role)
    const size = node.size ?? defaultDraftSize(role)
    return {
      ...node, kind, role,
      ...(node.size ? { size: { width: Math.max(size.width, minimum.width), height: Math.max(size.height, minimum.height) } } : {}),
    }
  })
  const seen = new Set<string>()
  const edges = graph.edges.flatMap((edge) => {
    if (kind === 'annotation_frame' && (edge.source === id || edge.target === id)) return []
    if (kind === 'output' && edge.source === id && edge.kind !== 'context') return []
    const next = { ...edge }
    if (edge.source === id && edge.kind !== 'context') {
      delete next.sourcePort
      if (kind === 'condition') {
        next.sourceHandle = edge.sourceHandle === `${id}:false` ? `${id}:false` : `${id}:true`
      } else {
        delete next.sourceHandle
      }
    }
    if (edge.target === id) {
      delete next.targetPort
      delete next.targetHandle
    }
    const identity = JSON.stringify([next.kind ?? 'step', next.source, next.target, next.sourceHandle ?? '', next.targetHandle ?? ''])
    if (seen.has(identity)) return []
    seen.add(identity)
    return [next]
  })
  return { ...graph, nodes, edges }
}
