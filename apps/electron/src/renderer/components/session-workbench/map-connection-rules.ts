/**
 * Session map connection rules.
 *
 * Two kinds of user-drawn edges live in the draft graph:
 * - `step`: draft → draft, workflow order (acyclic, directed).
 * - `context`: scene ↔ draft/note. The note is attached to the scene as
 *   context; its text is appended when that scene is rewritten in a new branch.
 *
 * Scene → scene edges come from the conversation itself and cannot be drawn;
 * branching is an explicit inspector / menu action.
 */
import { wouldCreateDraftEdgeCycle, type SessionDraftEdge, type SessionDraftNode } from './draft-nodes'

export type MapEdgeKind = 'step' | 'context'

export type MapConnectionRejectReason =
  | 'self'
  | 'scene-scene'
  | 'branch'
  | 'unknown'
  | 'duplicate'
  | 'cycle'
  | 'annotation'
  | 'output'

export type MapConnectionVerdict =
  | { ok: true; kind: MapEdgeKind; source: string; target: string; sourceHandle?: string; targetHandle?: string }
  | { ok: false; reason: MapConnectionRejectReason }

export type MapConnectionContext = {
  draftNodes: ReadonlyArray<Pick<SessionDraftNode, 'id'> & Partial<Pick<SessionDraftNode, 'kind' | 'role'>>>
  draftEdges: ReadonlyArray<Pick<SessionDraftEdge, 'source' | 'target' | 'kind' | 'sourceHandle' | 'targetHandle'>>
  sceneIds: ReadonlySet<string>
}

export function draftEdgeKind(edge: Pick<SessionDraftEdge, 'kind'>): MapEdgeKind {
  return edge.kind === 'context' ? 'context' : 'step'
}

/**
 * Decide whether a drawn connection is allowed and what it means.
 * Context edges are normalized to `scene → draft` so duplicates are detected
 * regardless of the drag direction.
 */
export function classifyMapConnection(
  connection: { source?: string | null; target?: string | null; sourceHandle?: string | null; targetHandle?: string | null },
  ctx: MapConnectionContext,
): MapConnectionVerdict {
  const source = connection.source ?? ''
  const target = connection.target ?? ''
  if (!source || !target) return { ok: false, reason: 'unknown' }
  if (source === target) return { ok: false, reason: 'self' }
  const draftIds = new Set(ctx.draftNodes.map((node) => node.id))
  const sourceIsDraft = draftIds.has(source)
  const targetIsDraft = draftIds.has(target)
  const sourceIsScene = ctx.sceneIds.has(source)
  const targetIsScene = ctx.sceneIds.has(target)

  if (sourceIsScene && targetIsScene) return { ok: false, reason: 'scene-scene' }
  if (source.startsWith('br_') || target.startsWith('br_')) return { ok: false, reason: 'branch' }

  const sourceDraft = ctx.draftNodes.find((node) => node.id === source)
  const targetDraft = ctx.draftNodes.find((node) => node.id === target)
  if ([sourceDraft, targetDraft].some((node) => node?.kind === 'annotation_frame' || node?.role === 'frame' || node?.role === 'group')) {
    return { ok: false, reason: 'annotation' }
  }
  // An output is a workflow sink. Context links may still attach it to a scene.
  if (sourceIsDraft && targetIsDraft && sourceDraft?.kind === 'output') return { ok: false, reason: 'output' }

  if (sourceIsDraft && targetIsDraft) {
    const steps = ctx.draftEdges.filter((edge) => draftEdgeKind(edge) === 'step')
    // Keyboard connections use the condition's first branch, just like workflow
    // export. Every persisted condition edge must name an actual visible handle.
    const sourceHandle = sourceDraft?.kind === 'condition' ? connection.sourceHandle ?? `${source}:true` : connection.sourceHandle
    if (sourceDraft?.kind === 'condition' && sourceHandle !== `${source}:true` && sourceHandle !== `${source}:false`) return { ok: false, reason: 'unknown' }
    if (steps.some((edge) => edge.source === source && edge.target === target && (edge.sourceHandle ?? (sourceDraft?.kind === 'condition' ? `${source}:true` : '')) === (sourceHandle ?? '') && (edge.targetHandle ?? '') === (connection.targetHandle ?? ''))) {
      return { ok: false, reason: 'duplicate' }
    }
    if (wouldCreateDraftEdgeCycle(steps, { source, target })) return { ok: false, reason: 'cycle' }
    return {
      ok: true, kind: 'step', source, target,
      ...(sourceHandle ? { sourceHandle } : {}),
      ...(connection.targetHandle ? { targetHandle: connection.targetHandle } : {}),
    }
  }

  if ((sourceIsScene && targetIsDraft) || (sourceIsDraft && targetIsScene)) {
    const scene = sourceIsScene ? source : target
    const draft = sourceIsScene ? target : source
    const exists = ctx.draftEdges.some(
      (edge) =>
        draftEdgeKind(edge) === 'context' &&
        ((edge.source === scene && edge.target === draft) || (edge.source === draft && edge.target === scene)),
    )
    if (exists) return { ok: false, reason: 'duplicate' }
    return { ok: true, kind: 'context', source: scene, target: draft }
  }

  return { ok: false, reason: 'unknown' }
}

/** i18n key explaining why a connection was refused. */
export function connectionRejectMessageKey(reason: MapConnectionRejectReason): string {
  switch (reason) {
    case 'scene-scene':
      return 'entityView.mapConnectSceneScene'
    case 'cycle':
      return 'entityView.mapConnectCycle'
    case 'duplicate':
      return 'entityView.mapConnectDuplicate'
    case 'annotation':
      return 'entityView.mapConnectAnnotation'
    case 'output':
      return 'entityView.mapConnectOutput'
    case 'branch':
    case 'self':
    case 'unknown':
      return 'entityView.mapConnectInvalid'
    default: {
      const _exhaustive: never = reason
      return _exhaustive
    }
  }
}

/** Notes attached to a scene with `context` edges, in creation order. */
export function contextNotesForScene(
  sceneId: string,
  graph: {
    nodes: ReadonlyArray<Pick<SessionDraftNode, 'id' | 'title'>>
    edges: ReadonlyArray<Pick<SessionDraftEdge, 'source' | 'target' | 'kind' | 'createdAt'>>
  },
): string[] {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]))
  return [...graph.edges]
    .filter((edge) => draftEdgeKind(edge) === 'context' && (edge.source === sceneId || edge.target === sceneId))
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((edge) => byId.get(edge.source === sceneId ? edge.target : edge.source)?.title.trim() ?? '')
    .filter((text) => text.length > 0)
}

/** Prompt sent to «Переписать в новой ветке»: the rewrite plus attached context notes. */
export function withContextNotes(prompt: string, notes: readonly string[], heading: string): string {
  const body = prompt.trim()
  if (notes.length === 0) return body
  return `${body}\n\n---\n${heading}\n${notes.map((note) => `- ${note.replace(/\s*\n\s*/g, ' ')}`).join('\n')}`
}
