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
      kind: node.kind as CanvasNodeKind,
      title: node.title,
      position: node.position,
      provenance: node.anchorSceneId
        ? { sessionId: graph.sessionId, sceneId: node.anchorSceneId, messageIds: [] }
        : undefined,
      now: node.createdAt || now + index,
    }),
  )
  spec.edges = graph.edges.map((edge) =>
    createCanvasEdge({ source: edge.source, target: edge.target, now: edge.createdAt }),
  )
  return spec
}

export function specToDraftGraph(spec: SessionWorkflowSpec): SessionDraftGraph {
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
        }) satisfies SessionDraftNode,
    ),
    edges: spec.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      createdAt: edge.createdAt,
    })),
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
