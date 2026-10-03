import type { SessionDraftGraph, SessionDraftNode, SessionNodeKind } from './draft-nodes'
import {
  CANVAS_NODE_KINDS,
  createCanvasEdge,
  createCanvasNode,
  createDraftSpec,
  createWorkflowDocument,
  parseWorkflowDocument,
  serializeWorkflowDocument,
  workflowDocumentStorageKey,
  type CanvasNodeKind,
  type SessionWorkflowDocument,
  type SessionWorkflowSpec,
} from '@craft-agent/shared/workflows'

export function isSessionNodeKind(value: unknown): value is SessionNodeKind {
  return typeof value === 'string' && (CANVAS_NODE_KINDS as readonly string[]).includes(value)
}

export function draftGraphToSpec(graph: SessionDraftGraph, now = Date.now()): SessionWorkflowSpec {
  const spec = createDraftSpec(graph.sessionId, now)
  spec.nodes = graph.nodes.map((node, index) =>
    createCanvasNode({
      id: node.id,
      kind: node.role === 'frame' || node.role === 'group' ? 'annotation_frame' : node.kind as CanvasNodeKind,
      title: node.title,
      position: node.position,
      provenance: node.anchorSceneId
        ? { sessionId: graph.sessionId, sceneId: node.anchorSceneId, messageIds: [] }
        : undefined,
      now: node.createdAt || now + index,
      appearance: { role: node.role, color: node.color, size: node.size },
    }),
  )
  // Context edges (scene → note) are map annotations, not workflow steps.
  spec.edges = graph.edges
    .filter((edge) => edge.kind !== 'context')
    .map((edge) => createCanvasEdge({
      source: edge.source, target: edge.target,
      sourcePort: edge.sourcePort ?? edge.sourceHandle,
      targetPort: edge.targetPort ?? edge.targetHandle,
      now: edge.createdAt,
    }))
  return spec
}

export function specToDraftGraph(spec: SessionWorkflowSpec): SessionDraftGraph {
  const byId = new Map(spec.nodes.map((node) => [node.id, node]))
  return {
    v: 1,
    sessionId: spec.sessionId,
    nodes: spec.nodes.map(
      (node) =>
        ({
          id: node.id,
          kind: node.kind as SessionDraftNode['kind'],
          title: node.title,
          position: node.position,
          anchorSceneId: node.provenance?.sceneId ?? null,
          createdAt: node.createdAt,
          ...(node.kind === 'annotation_frame' ? { role: 'frame' as const } : {}),
          ...(node.appearance?.role ? { role: node.appearance.role } : {}),
          ...(node.appearance?.color ? { color: node.appearance.color } : {}),
          ...(node.appearance?.size ? { size: node.appearance.size } : {}),
        }) satisfies SessionDraftNode,
    ),
    edges: spec.edges.map((edge) => {
      const source = byId.get(edge.source)
      const sourcePort = source?.outputs.find((port) => port.id === edge.sourcePort || port.name === edge.sourcePort)
      // Only condition branches have named visible handles. Single-port nodes
      // use their default handle; preserve canonical port IDs separately.
      const sourceHandle = source?.kind === 'condition'
        ? `${source.id}:${sourcePort?.name ?? 'true'}`
        : undefined
      return {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        createdAt: edge.createdAt,
        ...(sourceHandle ? { sourceHandle } : {}),
        ...(edge.sourcePort ? { sourcePort: edge.sourcePort } : {}),
        ...(edge.targetPort ? { targetPort: edge.targetPort } : {}),
      }
    }),
  }
}

export function loadWorkflowDocument(sessionId: string, fallback: SessionDraftGraph): SessionWorkflowDocument {
  try {
    const existing = parseWorkflowDocument(localStorage.getItem(workflowDocumentStorageKey(sessionId)), sessionId)
    if (existing.draft.nodes.length > 0 || existing.versions.length > 0 || existing.runs.length > 0) {
      return existing
    }
    if (fallback.nodes.length === 0 && fallback.edges.length === 0) return existing
    return { ...existing, draft: draftGraphToSpec(fallback) }
  } catch {
    return createWorkflowDocument(sessionId)
  }
}

export function persistWorkflowDocument(document: SessionWorkflowDocument): void {
  try {
    localStorage.setItem(workflowDocumentStorageKey(document.sessionId), serializeWorkflowDocument(document))
  } catch {
    /* ignore quota */
  }
}
