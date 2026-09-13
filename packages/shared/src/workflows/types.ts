/**
 * Session-map WorkflowSpec (Rox tracker issue 10).
 *
 * Distinct from task.yaml `WorkflowSpec` (`@craft-agent/shared/tasks`): this
 * document versions the Map canvas. Runs always point at an immutable version.
 */
import type { PermissionMode } from '../agent/mode-types.ts'

export const CANVAS_NODE_KINDS = [
  'note',
  'model',
  'tool',
  'memory',
  'subflow',
  'condition',
  'merge',
  'human_input',
  'output',
  'annotation_frame',
] as const

export type CanvasNodeKind = (typeof CANVAS_NODE_KINDS)[number]

export const EXECUTABLE_NODE_KINDS = ['model', 'tool', 'subflow', 'human_input'] as const satisfies readonly CanvasNodeKind[]
export type ExecutableNodeKind = (typeof EXECUTABLE_NODE_KINDS)[number]

export const PORT_KINDS = ['text', 'prompt', 'completion', 'json', 'boolean', 'any'] as const
export type PortKind = (typeof PORT_KINDS)[number]

export type CanvasPort = {
  id: string
  name: string
  direction: 'in' | 'out'
  kind: PortKind
  required?: boolean
}

export type CanvasNodeProvenance = {
  sessionId: string
  sceneId?: string
  messageIds: string[]
}

export type CanvasNode = {
  id: string
  kind: CanvasNodeKind
  title: string
  position: { x: number; y: number }
  inputs: CanvasPort[]
  outputs: CanvasPort[]
  permissionMode?: PermissionMode
  provenance?: CanvasNodeProvenance
  createdAt: number
}

export type CanvasEdge = {
  id: string
  source: string
  target: string
  sourcePort?: string
  targetPort?: string
  createdAt: number
}

export type SessionWorkflowSpec = {
  v: 2
  id: string
  sessionId: string
  versionId: string
  parentVersionId: string | null
  title: string
  createdAt: number
  nodes: CanvasNode[]
  edges: CanvasEdge[]
  defaults: { permissionMode: PermissionMode }
}

export type WorkflowRunMode = 'node' | 'from-here' | 'selection' | 'pipeline'

export type WorkflowExecutionKind = 'simulate' | 'production'

export type WorkflowNodeRunStatus =
  | 'queued'
  | 'running'
  | 'done'
  | 'skipped'
  | 'blocked'
  | 'simulated'
  | 'waiting_approval'
  | 'failed'
  | 'cancelled'

export type WorkflowArtifact = {
  nodeId: string
  kind: PortKind
  value: string
}

export type WorkflowNodeReceipt = {
  nodeId: string
  effectId: string
  value: string
}

export type WorkflowRun = {
  id: string
  specId: string
  specVersionId: string
  mode: WorkflowRunMode
  execution: WorkflowExecutionKind
  nodeIds: string[]
  status: Record<string, WorkflowNodeRunStatus>
  artifacts: Record<string, WorkflowArtifact>
  receipts: Record<string, WorkflowNodeReceipt>
  permissionRevision: string
  startedAt: number
  finishedAt?: number
}

export type SessionWorkflowDocument = {
  v: 2
  sessionId: string
  draft: SessionWorkflowSpec
  versions: SessionWorkflowSpec[]
  runs: WorkflowRun[]
}

export function isCanvasNodeKind(value: unknown): value is CanvasNodeKind {
  return typeof value === 'string' && (CANVAS_NODE_KINDS as readonly string[]).includes(value)
}

export function isExecutableNodeKind(kind: CanvasNodeKind): kind is ExecutableNodeKind {
  return (EXECUTABLE_NODE_KINDS as readonly string[]).includes(kind)
}

export const DEFAULT_PORTS: Record<CanvasNodeKind, { inputs: Omit<CanvasPort, 'id'>[]; outputs: Omit<CanvasPort, 'id'>[] }> = {
  note: {
    inputs: [{ name: 'text', direction: 'in', kind: 'text' }],
    outputs: [{ name: 'text', direction: 'out', kind: 'text' }],
  },
  model: {
    inputs: [{ name: 'prompt', direction: 'in', kind: 'prompt', required: true }],
    outputs: [{ name: 'completion', direction: 'out', kind: 'completion' }],
  },
  tool: {
    inputs: [{ name: 'input', direction: 'in', kind: 'json', required: true }],
    outputs: [{ name: 'result', direction: 'out', kind: 'json' }],
  },
  memory: {
    inputs: [{ name: 'query', direction: 'in', kind: 'text', required: true }],
    outputs: [{ name: 'recall', direction: 'out', kind: 'text' }],
  },
  subflow: {
    inputs: [{ name: 'input', direction: 'in', kind: 'any', required: true }],
    outputs: [{ name: 'output', direction: 'out', kind: 'any' }],
  },
  condition: {
    inputs: [{ name: 'value', direction: 'in', kind: 'boolean', required: true }],
    outputs: [
      { name: 'true', direction: 'out', kind: 'any' },
      { name: 'false', direction: 'out', kind: 'any' },
    ],
  },
  merge: {
    inputs: [
      { name: 'a', direction: 'in', kind: 'any', required: true },
      { name: 'b', direction: 'in', kind: 'any' },
    ],
    outputs: [{ name: 'merged', direction: 'out', kind: 'any' }],
  },
  human_input: {
    inputs: [{ name: 'prompt', direction: 'in', kind: 'prompt', required: true }],
    outputs: [{ name: 'answer', direction: 'out', kind: 'text' }],
  },
  output: {
    inputs: [{ name: 'value', direction: 'in', kind: 'any', required: true }],
    outputs: [],
  },
  annotation_frame: {
    inputs: [],
    outputs: [],
  },
}

export function portsForKind(kind: CanvasNodeKind, nodeId: string): { inputs: CanvasPort[]; outputs: CanvasPort[] } {
  const spec = DEFAULT_PORTS[kind]
  return {
    inputs: spec.inputs.map((port) => ({ ...port, id: `${nodeId}:${port.name}` })),
    outputs: spec.outputs.map((port) => ({ ...port, id: `${nodeId}:${port.name}` })),
  }
}

const TEXT_FAMILY = new Set<PortKind>(['text', 'prompt', 'completion'])

export function portCompatible(from: PortKind, to: PortKind): boolean {
  if (from === to || from === 'any' || to === 'any') return true
  return TEXT_FAMILY.has(from) && TEXT_FAMILY.has(to)
}
