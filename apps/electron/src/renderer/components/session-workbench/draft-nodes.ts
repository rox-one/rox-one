import type { SessionNodeKind } from './node-kinds'
export type { SessionNodeKind }

export const STICKY_COLORS = ['amber', 'blue', 'green', 'rose', 'violet'] as const
export type StickyColor = (typeof STICKY_COLORS)[number]

export type SessionDraftNode = {
  id: string
  kind: SessionNodeKind
  title: string
  position: { x: number; y: number }
  anchorSceneId: string | null
  createdAt: number
  role?: 'node' | 'sticky' | 'frame' | 'group'
  /** User-resized box; absent = default size for the role. */
  size?: { width: number; height: number }
  color?: StickyColor
}

export type SessionDraftEdge = {
  id: string
  source: string
  target: string
  createdAt: number
  /**
   * `step` (default): draft → draft workflow order.
   * `context`: scene → draft note attached as context to that scene.
   */
  kind?: 'step' | 'context'
  sourceHandle?: string
  targetHandle?: string
  /** Imported WorkflowSpec ports may be named even when the canvas shows one handle. */
  sourcePort?: string
  targetPort?: string
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
  subflow: 'Subflow',
  condition: 'Condition',
  merge: 'Merge',
  human_input: 'Human input',
  output: 'Output',
  annotation_frame: 'Frame',
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
  title,
  role = 'node',
  color,
}: {
  id?: string
  kind: SessionNodeKind
  position: { x: number; y: number }
  anchorSceneId?: string | null
  now?: number
  title?: string
  role?: SessionDraftNode['role']
  color?: StickyColor
}): SessionDraftNode {
  nextDraftSequence += 1
  return {
    id: id ?? `draft_${kind}_${now.toString(36)}_${nextDraftSequence.toString(36)}`,
    kind,
    title: title ?? DRAFT_NODE_PROMPTS[kind],
    position,
    anchorSceneId,
    createdAt: now,
    role,
    ...(role === 'sticky' ? { color: color ?? STICKY_COLORS[(nextDraftSequence - 1) % STICKY_COLORS.length] } : {}),
  }
}

export function createSessionDraftEdge({
  source,
  target,
  now = Date.now(),
  kind = 'step',
  sourceHandle,
  targetHandle,
}: {
  source: string
  target: string
  now?: number
  kind?: 'step' | 'context'
  sourceHandle?: string
  targetHandle?: string
}): SessionDraftEdge {
  return {
    id: kind === 'context' ? `draft_ctx_${source}_${target}` : `draft_edge_${source}_${target}${sourceHandle ? `_${sourceHandle}` : ''}${targetHandle ? `_${targetHandle}` : ''}`,
    source,
    target,
    createdAt: now,
    ...(kind === 'context' ? { kind } : {}),
    ...(sourceHandle ? { sourceHandle } : {}),
    ...(targetHandle ? { targetHandle } : {}),
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
  edges: ReadonlyArray<Pick<SessionDraftEdge, 'source' | 'target' | 'kind'>>,
): boolean {
  const knownNodeIds = new Set(nodes.map((node) => node.id))
  const steps = edges.filter((existing) => existing.kind !== 'context')
  const source = nodes.find((node) => node.id === edge.source)
  const target = nodes.find((node) => node.id === edge.target)
  const annotation = (node: SessionDraftNode | undefined) => node?.kind === 'annotation_frame' || node?.role === 'frame' || node?.role === 'group'
  return (
    edge.source !== edge.target &&
    knownNodeIds.has(edge.source) &&
    knownNodeIds.has(edge.target) &&
    source?.kind !== 'output' && !annotation(source) && !annotation(target) &&
    !steps.some((existing) => existing.source === edge.source && existing.target === edge.target) &&
    !wouldCreateDraftEdgeCycle(steps, edge)
  )
}

function isNodeSize(value: unknown): value is { width: number; height: number } {
  if (!value || typeof value !== 'object') return false
  const size = value as { width?: unknown; height?: unknown }
  return (
    typeof size.width === 'number' && Number.isFinite(size.width) && size.width > 0 &&
    typeof size.height === 'number' && Number.isFinite(size.height) && size.height > 0
  )
}

function isDraftNode(value: unknown): value is SessionDraftNode {
  if (!value || typeof value !== 'object') return false
  const node = value as Partial<SessionDraftNode>
  const position = node.position as Partial<SessionDraftNode['position']> | undefined
  return (
    typeof node.id === 'string' &&
    (node.kind === 'note' ||
      node.kind === 'model' ||
      node.kind === 'tool' ||
      node.kind === 'memory' ||
      node.kind === 'subflow' ||
      node.kind === 'condition' ||
      node.kind === 'merge' ||
      node.kind === 'human_input' ||
      node.kind === 'output' ||
      node.kind === 'annotation_frame') &&
    typeof node.title === 'string' &&
    typeof position?.x === 'number' &&
    Number.isFinite(position.x) &&
    typeof position?.y === 'number' &&
    Number.isFinite(position.y) &&
    (node.anchorSceneId === null || typeof node.anchorSceneId === 'string') &&
    typeof node.createdAt === 'number' &&
    Number.isFinite(node.createdAt) &&
    (node.role === undefined || node.role === 'node' || node.role === 'sticky' || node.role === 'frame' || node.role === 'group') &&
    (node.color === undefined || STICKY_COLORS.includes(node.color)) &&
    (node.size === undefined || isNodeSize(node.size))
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
    typeof edge.createdAt === 'number' &&
    (edge.kind === undefined || edge.kind === 'step' || edge.kind === 'context') &&
    (edge.sourceHandle === undefined || typeof edge.sourceHandle === 'string') &&
    (edge.targetHandle === undefined || typeof edge.targetHandle === 'string') &&
    (edge.sourcePort === undefined || typeof edge.sourcePort === 'string') &&
    (edge.targetPort === undefined || typeof edge.targetPort === 'string')
  )
}

export function parseSessionDraftGraph(raw: string | null, sessionId: string): SessionDraftGraph {
  if (!raw) return { v: 1, sessionId, nodes: [], edges: [] }
  try {
    const parsed = JSON.parse(raw) as Partial<SessionDraftGraph>
    if (parsed.v !== 1 || parsed.sessionId !== sessionId || !Array.isArray(parsed.nodes)) {
      return { v: 1, sessionId, nodes: [], edges: [] }
    }
    // Older maps represented frames as notes. Keep their layout, but migrate
    // them to annotations so they never participate in executable steps.
    const nodes = parsed.nodes.filter(isDraftNode).map((node) =>
      node.role === 'frame' || node.role === 'group' ? { ...node, kind: 'annotation_frame' as const } : node,
    )
    const knownNodeIds = new Set(nodes.map((node) => node.id))
    const edges: SessionDraftEdge[] = []
    if (Array.isArray(parsed.edges)) {
      for (const edge of parsed.edges) {
        if (!isDraftEdge(edge)) continue
        const source = nodes.find((node) => node.id === edge.source)
        const target = nodes.find((node) => node.id === edge.target)
        if (source?.kind === 'annotation_frame' || target?.kind === 'annotation_frame') continue
        if (edge.kind === 'context') {
          // scene → note: only the note end is a draft node; scenes come from the transcript.
          if (!knownNodeIds.has(edge.target) && !knownNodeIds.has(edge.source)) continue
          edges.push(edge)
          continue
        }
        if (!knownNodeIds.has(edge.source) || !knownNodeIds.has(edge.target)) continue
        if (source?.kind === 'output') continue
        if (wouldCreateDraftEdgeCycle(edges.filter((e) => e.kind !== 'context'), edge)) continue
        // Older keyboard/conversion paths omitted the condition handle. The
        // workflow's default output is its true branch, so restore that handle.
        const sourceHandle = source?.kind === 'condition'
          ? edge.sourceHandle ?? (edge.sourcePort === 'false' || edge.sourcePort === `${source.id}:false` ? `${source.id}:false` : `${source.id}:true`)
          : edge.sourceHandle
        edges.push({ ...edge, ...(sourceHandle ? { sourceHandle } : {}) })
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
