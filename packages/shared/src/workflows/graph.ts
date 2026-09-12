import { portsForKind, type CanvasEdge, type CanvasNode, type CanvasNodeKind, type SessionWorkflowSpec } from './types.ts'
import type { PermissionMode } from '../agent/mode-types.ts'

let nextSeq = 0

export function mintId(prefix: string, now = Date.now()): string {
  nextSeq += 1
  return `${prefix}_${now.toString(36)}_${nextSeq.toString(36)}`
}

export function createCanvasNode({
  id,
  kind,
  title,
  position,
  permissionMode,
  provenance,
  now = Date.now(),
}: {
  id?: string
  kind: CanvasNodeKind
  title: string
  position: { x: number; y: number }
  permissionMode?: PermissionMode
  provenance?: CanvasNode['provenance']
  now?: number
}): CanvasNode {
  const nodeId = id ?? mintId(`n_${kind}`, now)
  const ports = portsForKind(kind, nodeId)
  return {
    id: nodeId,
    kind,
    title,
    position,
    inputs: ports.inputs,
    outputs: ports.outputs,
    ...(permissionMode ? { permissionMode } : {}),
    ...(provenance ? { provenance } : {}),
    createdAt: now,
  }
}

export function createCanvasEdge({
  source,
  target,
  sourcePort,
  targetPort,
  now = Date.now(),
}: {
  source: string
  target: string
  sourcePort?: string
  targetPort?: string
  now?: number
}): CanvasEdge {
  return {
    id: `e_${source}_${target}${sourcePort ? `_${sourcePort}` : ''}${targetPort ? `_${targetPort}` : ''}`,
    source,
    target,
    ...(sourcePort ? { sourcePort } : {}),
    ...(targetPort ? { targetPort } : {}),
    createdAt: now,
  }
}

export function createDraftSpec(sessionId: string, now = Date.now()): SessionWorkflowSpec {
  return {
    v: 2,
    id: mintId('wf', now),
    sessionId,
    versionId: mintId('ver', now),
    parentVersionId: null,
    title: sessionId,
    createdAt: now,
    nodes: [],
    edges: [],
    defaults: { permissionMode: 'ask' },
  }
}

export function convertNodeKind(node: CanvasNode, kind: CanvasNodeKind): CanvasNode {
  const ports = portsForKind(kind, node.id)
  return {
    ...node,
    kind,
    inputs: ports.inputs,
    outputs: ports.outputs,
    permissionMode: kind === 'model' || kind === 'tool' || kind === 'subflow' || kind === 'human_input'
      ? node.permissionMode ?? 'ask'
      : undefined,
  }
}

export function cloneSpec(spec: SessionWorkflowSpec, patch: Partial<SessionWorkflowSpec>): SessionWorkflowSpec {
  return {
    ...spec,
    ...patch,
    nodes: patch.nodes ?? spec.nodes.map((node) => ({ ...node, position: { ...node.position } })),
    edges: patch.edges ?? spec.edges.map((edge) => ({ ...edge })),
    defaults: patch.defaults ?? { ...spec.defaults },
  }
}

export function topologicalOrder(nodes: readonly CanvasNode[], edges: readonly CanvasEdge[]): string[] | null {
  const incoming = new Map<string, number>()
  const outgoing = new Map<string, string[]>()
  for (const node of nodes) {
    incoming.set(node.id, 0)
    outgoing.set(node.id, [])
  }
  for (const edge of edges) {
    if (!incoming.has(edge.source) || !incoming.has(edge.target)) continue
    incoming.set(edge.target, (incoming.get(edge.target) ?? 0) + 1)
    outgoing.get(edge.source)!.push(edge.target)
  }
  const queue = [...incoming.entries()].filter(([, n]) => n === 0).map(([id]) => id)
  const ordered: string[] = []
  while (queue.length > 0) {
    const id = queue.shift()!
    ordered.push(id)
    for (const next of outgoing.get(id) ?? []) {
      const left = (incoming.get(next) ?? 1) - 1
      incoming.set(next, left)
      if (left === 0) queue.push(next)
    }
  }
  return ordered.length === nodes.length ? ordered : null
}

export function reachableFrom(startId: string, edges: readonly CanvasEdge[]): Set<string> {
  const nextBySource = new Map<string, string[]>()
  for (const edge of edges) {
    const list = nextBySource.get(edge.source) ?? []
    list.push(edge.target)
    nextBySource.set(edge.source, list)
  }
  const seen = new Set<string>([startId])
  const stack = [startId]
  while (stack.length > 0) {
    const current = stack.pop()!
    for (const next of nextBySource.get(current) ?? []) {
      if (seen.has(next)) continue
      seen.add(next)
      stack.push(next)
    }
  }
  return seen
}

export function fingerprintSpec(spec: SessionWorkflowSpec): string {
  const nodes = spec.nodes
    .map((node) => `${node.id}:${node.kind}:${node.title}:${node.position.x},${node.position.y}:${node.permissionMode ?? ''}`)
    .sort()
  const edges = spec.edges
    .map((edge) => `${edge.source}:${edge.sourcePort ?? ''}->${edge.target}:${edge.targetPort ?? ''}`)
    .sort()
  return `${spec.sessionId}|${nodes.join(';')}|${edges.join(';')}|${spec.defaults.permissionMode}`
}
