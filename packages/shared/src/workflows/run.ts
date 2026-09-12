import { fingerprintSpec, mintId, reachableFrom, topologicalOrder } from './graph.ts'
import type {
  SessionWorkflowSpec,
  WorkflowArtifact,
  WorkflowNodeRunStatus,
  WorkflowRun,
  WorkflowRunMode,
} from './types.ts'
import { isExecutableNodeKind } from './types.ts'
import { validateWorkflowSpec } from './validate.ts'

export class WorkflowRunError extends Error {
  constructor(
    message: string,
    readonly issues: Array<{ path: string; message: string }>,
  ) {
    super(message)
    this.name = 'WorkflowRunError'
  }
}

function artifactFor(spec: SessionWorkflowSpec, nodeId: string): WorkflowArtifact {
  const node = spec.nodes.find((item) => item.id === nodeId)!
  const kind = node.outputs[0]?.kind ?? 'any'
  const provenance = node.provenance?.messageIds.join(',') ?? node.title
  return { nodeId, kind, value: `${node.kind}:${node.id}:${provenance}` }
}

function selectNodeIds(spec: SessionWorkflowSpec, mode: WorkflowRunMode, seedIds: string[]): string[] {
  const known = new Set(spec.nodes.map((node) => node.id))
  if (mode === 'pipeline') return spec.nodes.map((node) => node.id)
  const seeds = seedIds.filter((id) => known.has(id))
  if (mode === 'node' || mode === 'selection') return seeds
  const fromHere = new Set<string>()
  for (const id of seeds) {
    for (const next of reachableFrom(id, spec.edges)) fromHere.add(next)
  }
  return [...fromHere]
}

export function runWorkflow({
  spec,
  mode,
  seedIds = [],
  now = Date.now(),
}: {
  spec: SessionWorkflowSpec
  mode: WorkflowRunMode
  seedIds?: string[]
  now?: number
}): WorkflowRun {
  const validation = validateWorkflowSpec(spec)
  if (!validation.valid) {
    throw new WorkflowRunError('WorkflowSpec is invalid', validation.errors)
  }
  const selected = new Set(selectNodeIds(spec, mode, seedIds))
  const order = topologicalOrder(spec.nodes, spec.edges) ?? spec.nodes.map((node) => node.id)
  const status: Record<string, WorkflowNodeRunStatus> = {}
  const artifacts: Record<string, WorkflowArtifact> = {}
  for (const node of spec.nodes) {
    if (node.kind === 'annotation_frame') {
      status[node.id] = 'skipped'
      continue
    }
    if (!selected.has(node.id)) {
      status[node.id] = 'skipped'
      continue
    }
    status[node.id] = isExecutableNodeKind(node.kind) || node.kind === 'note' || node.kind === 'memory' || node.kind === 'condition' || node.kind === 'merge' || node.kind === 'output'
      ? 'done'
      : 'skipped'
    if (status[node.id] === 'done') {
      artifacts[node.id] = artifactFor(spec, node.id)
    }
  }
  const ran = order.filter((id) => selected.has(id))
  return {
    id: mintId('run', now),
    specId: spec.id,
    specVersionId: spec.versionId,
    mode,
    nodeIds: ran,
    status,
    artifacts,
    startedAt: now,
    finishedAt: now,
  }
}

export function replayRun(spec: SessionWorkflowSpec, previous: WorkflowRun, now = Date.now()): WorkflowRun {
  if (previous.specVersionId !== spec.versionId) {
    throw new WorkflowRunError('Replay requires the same immutable specification version', [
      { path: 'specVersionId', message: `${previous.specVersionId} !== ${spec.versionId}` },
    ])
  }
  const next = runWorkflow({ spec, mode: previous.mode, seedIds: previous.nodeIds, now })
  return { ...next, specVersionId: previous.specVersionId }
}

export function compareRuns(a: WorkflowRun, b: WorkflowRun): { sameSpec: boolean; artifactDelta: string[] } {
  const keys = new Set([...Object.keys(a.artifacts), ...Object.keys(b.artifacts)])
  const artifactDelta = [...keys].filter((key) => a.artifacts[key]?.value !== b.artifacts[key]?.value)
  return { sameSpec: a.specVersionId === b.specVersionId, artifactDelta }
}

export function sameSpecContent(a: SessionWorkflowSpec, b: SessionWorkflowSpec): boolean {
  return fingerprintSpec(a) === fingerprintSpec(b)
}
