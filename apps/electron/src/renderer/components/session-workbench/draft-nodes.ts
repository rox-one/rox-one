import type { SessionNodeKind } from './node-kinds'

export type SessionDraftNode = {
  id: string
  kind: SessionNodeKind
  title: string
  position: { x: number; y: number }
  anchorSceneId: string | null
  createdAt: number
}

export type SessionDraftEdge = {
  id: string
  source: string
  target: string
  createdAt: number
}

export type SessionDraftGraph = {
  v: 1
  sessionId: string
  nodes: SessionDraftNode[]
  edges: SessionDraftEdge[]
}

export const DRAFT_NODE_PROMPTS: Record<SessionNodeKind, string> = {
  note: 'New note',
  model: 'Model inference',
  tool: 'Tool call',
  memory: 'Memory lookup',
}

let nextDraftSequence = 0

export function sessionDraftNodesStorageKey(sessionId: string): string {
  return `rox.sessionMap.drafts.${sessionId}`
}

export function createSessionDraftNode({
  id,
  kind,
  position,
  anchorSceneId = null,
  now = Date.now(),
}: {
  id?: string
  kind: SessionNodeKind
  position: { x: number; y: number }
  anchorSceneId?: string | null
  now?: number
}): SessionDraftNode {
  nextDraftSequence += 1
  return {
    id: id ?? `draft_${kind}_${now.toString(36)}_${nextDraftSequence.toString(36)}`,
    kind,
    title: DRAFT_NODE_PROMPTS[kind],
    position,
    anchorSceneId,
    createdAt: now,
  }
}

export function createSessionDraftEdge({
  source,
  target,
  now = Date.now(),
}: {
  source: string
  target: string
  now?: number
}): SessionDraftEdge {
  return {
    id: `draft_edge_${source}_${target}`,
    source,
    target,
    createdAt: now,
  }
}

export function wouldCreateDraftEdgeCycle(
  edges: ReadonlyArray<Pick<SessionDraftEdge, 'source' | 'target'>>,
  candidate: Pick<SessionDraftEdge, 'source' | 'target'>,
): boolean {
  const nextBySource = new Map<string, string[]>()
  for (const edge of edges) {
    const targets = nextBySource.get(edge.source) ?? []
    targets.push(edge.target)
    nextBySource.set(edge.source, targets)
  }

  const stack = [candidate.target]
  const seen = new Set<string>()
  while (stack.length > 0) {
    const current = stack.pop()!
    if (current === candidate.source) return true
    if (seen.has(current)) continue
    seen.add(current)
    stack.push(...(nextBySource.get(current) ?? []))
  }
  return false
}

export function canPersistDraftEdge(
  edge: Pick<SessionDraftEdge, 'source' | 'target'>,
  nodes: ReadonlyArray<SessionDraftNode>,
  edges: ReadonlyArray<Pick<SessionDraftEdge, 'source' | 'target'>>,
): boolean {
  const knownNodeIds = new Set(nodes.map((node) => node.id))
  return (
    edge.source !== edge.target &&
    knownNodeIds.has(edge.source) &&
    knownNodeIds.has(edge.target) &&
    !edges.some((existing) => existing.source === edge.source && existing.target === edge.target) &&
    !wouldCreateDraftEdgeCycle(edges, edge)
  )
}

function isDraftNode(value: unknown): value is SessionDraftNode {
  if (!value || typeof value !== 'object') return false
  const node = value as Partial<SessionDraftNode>
  const position = node.position as Partial<SessionDraftNode['position']> | undefined
  return (
    typeof node.id === 'string' &&
    (node.kind === 'note' || node.kind === 'model' || node.kind === 'tool' || node.kind === 'memory') &&
    typeof node.title === 'string' &&
    typeof position?.x === 'number' &&
    typeof position?.y === 'number' &&
    (node.anchorSceneId === null || typeof node.anchorSceneId === 'string') &&
    typeof node.createdAt === 'number'
  )
}

function isDraftEdge(value: unknown): value is SessionDraftEdge {
  if (!value || typeof value !== 'object') return false
  const edge = value as Partial<SessionDraftEdge>
  return (
    typeof edge.id === 'string' &&
    typeof edge.source === 'string' &&
    typeof edge.target === 'string' &&
    edge.source !== edge.target &&
    typeof edge.createdAt === 'number'
  )
}

export function parseSessionDraftGraph(raw: string | null, sessionId: string): SessionDraftGraph {
  if (!raw) return { v: 1, sessionId, nodes: [], edges: [] }
  try {
    const parsed = JSON.parse(raw) as Partial<SessionDraftGraph>
    if (parsed.v !== 1 || parsed.sessionId !== sessionId || !Array.isArray(parsed.nodes)) {
      return { v: 1, sessionId, nodes: [], edges: [] }
    }
    const nodes = parsed.nodes.filter(isDraftNode)
    const knownNodeIds = new Set(nodes.map((node) => node.id))
    const edges: SessionDraftEdge[] = []
    if (Array.isArray(parsed.edges)) {
      for (const edge of parsed.edges) {
        if (!isDraftEdge(edge)) continue
        if (!knownNodeIds.has(edge.source) || !knownNodeIds.has(edge.target)) continue
        if (wouldCreateDraftEdgeCycle(edges, edge)) continue
        edges.push(edge)
      }
    }
    return { v: 1, sessionId, nodes, edges }
  } catch {
    return { v: 1, sessionId, nodes: [], edges: [] }
  }
}

export function parseSessionDraftNodes(raw: string | null, sessionId: string): SessionDraftNode[] {
  return parseSessionDraftGraph(raw, sessionId).nodes
}

export function serializeSessionDraftGraph(sessionId: string, graph: Pick<SessionDraftGraph, 'nodes' | 'edges'>): string {
  return JSON.stringify({ v: 1, sessionId, nodes: graph.nodes, edges: graph.edges } satisfies SessionDraftGraph)
}

export function serializeSessionDraftNodes(sessionId: string, nodes: SessionDraftNode[]): string {
  return serializeSessionDraftGraph(sessionId, { nodes, edges: [] })
}
