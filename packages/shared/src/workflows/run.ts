import { fingerprintSpec, mintId, reachableFrom, topologicalOrder } from './graph.ts'
import type {
  SessionWorkflowSpec,
  WorkflowArtifact,
  WorkflowExecutionKind,
  WorkflowNodeReceipt,
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

export type WorkflowModelAdapter = {
  complete(input: {
    nodeId: string
    prompt: string
    permissionMode: string
    specVersionId: string
    effectId: string
  }): Promise<{ text: string; revision?: string }>
}

export type WorkflowToolAdapter = {
  invoke(input: {
    nodeId: string
    payload: string
    permissionMode: string
    specVersionId: string
    effectId: string
  }): Promise<{ text: string }>
}

export type WorkflowHumanAdapter = {
  resolve(input: { nodeId: string }): Promise<{ answer: string } | null>
}

export type WorkflowSubflowAdapter = {
  run(input: {
    nodeId: string
    payload: string
    specVersionId: string
    effectId: string
  }): Promise<{ text: string }>
}

export type WorkflowAdapters = {
  model?: WorkflowModelAdapter
  tool?: WorkflowToolAdapter
  human?: WorkflowHumanAdapter
  subflow?: WorkflowSubflowAdapter
}

const GRAPH_LOCAL_KINDS = new Set(['note', 'memory', 'condition', 'merge', 'output'])

function artifactFor(spec: SessionWorkflowSpec, nodeId: string, value?: string): WorkflowArtifact {
  const node = spec.nodes.find((item) => item.id === nodeId)!
  const kind = node.outputs[0]?.kind ?? 'any'
  const provenance = node.provenance?.messageIds.join(',') ?? node.title
  return { nodeId, kind, value: value ?? `${node.kind}:${node.id}:${provenance}` }
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

function permissionRevisionOf(spec: SessionWorkflowSpec): string {
  return `${spec.versionId}:${spec.defaults.permissionMode}`
}

function effectIdFor(spec: SessionWorkflowSpec, nodeId: string): string {
  return `${spec.versionId}:${nodeId}`
}

function emptyRun(spec: SessionWorkflowSpec, mode: WorkflowRunMode, nodeIds: string[], now: number, execution: WorkflowExecutionKind): WorkflowRun {
  return {
    id: mintId('run', now),
    specId: spec.id,
    specVersionId: spec.versionId,
    mode,
    execution,
    nodeIds,
    status: {},
    artifacts: {},
    receipts: {},
    permissionRevision: permissionRevisionOf(spec),
    startedAt: now,
  }
}

/**
 * Explicit simulate path. Executable nodes are never production `done`.
 */
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
  const run = emptyRun(spec, mode, order.filter((id) => selected.has(id)), now, 'simulate')
  for (const node of spec.nodes) {
    if (node.kind === 'annotation_frame' || !selected.has(node.id)) {
      run.status[node.id] = 'skipped'
      continue
    }
    if (GRAPH_LOCAL_KINDS.has(node.kind)) {
      run.status[node.id] = 'done'
      run.artifacts[node.id] = artifactFor(spec, node.id)
      continue
    }
    if (isExecutableNodeKind(node.kind)) {
      run.status[node.id] = 'simulated'
      run.artifacts[node.id] = artifactFor(spec, node.id, `simulated:${node.kind}:${node.id}`)
      continue
    }
    run.status[node.id] = 'skipped'
  }
  run.finishedAt = now
  return run
}

export async function runWorkflowProduction({
  spec,
  mode,
  seedIds = [],
  now = Date.now(),
  adapters = {},
  receipts = {},
}: {
  spec: SessionWorkflowSpec
  mode: WorkflowRunMode
  seedIds?: string[]
  now?: number
  adapters?: WorkflowAdapters
  receipts?: Record<string, WorkflowNodeReceipt>
}): Promise<WorkflowRun> {
  const validation = validateWorkflowSpec(spec)
  if (!validation.valid) {
    throw new WorkflowRunError('WorkflowSpec is invalid', validation.errors)
  }
  const selected = new Set(selectNodeIds(spec, mode, seedIds))
  const order = topologicalOrder(spec.nodes, spec.edges) ?? spec.nodes.map((node) => node.id)
  const run = emptyRun(spec, mode, order.filter((id) => selected.has(id)), now, 'production')
  run.receipts = { ...receipts }
  let waiting = false
  for (const node of spec.nodes) {
    if (node.kind === 'annotation_frame' || !selected.has(node.id)) {
      run.status[node.id] = 'skipped'
      continue
    }
    if (GRAPH_LOCAL_KINDS.has(node.kind)) {
      run.status[node.id] = 'done'
      run.artifacts[node.id] = artifactFor(spec, node.id)
      continue
    }
    if (!isExecutableNodeKind(node.kind)) {
      run.status[node.id] = 'skipped'
      continue
    }
    const effectId = effectIdFor(spec, node.id)
    const prior = run.receipts[effectId]
    if (prior) {
      run.status[node.id] = 'done'
      run.artifacts[node.id] = artifactFor(spec, node.id, prior.value)
      continue
    }
    try {
      if (node.kind === 'human_input') {
        const answer = adapters.human ? await adapters.human.resolve({ nodeId: node.id }) : null
        if (!answer) {
          run.status[node.id] = 'waiting_approval'
          waiting = true
          continue
        }
        run.status[node.id] = 'done'
        run.artifacts[node.id] = artifactFor(spec, node.id, answer.answer)
        run.receipts[effectId] = { nodeId: node.id, effectId, value: answer.answer }
        continue
      }
      if (node.kind === 'model') {
        if (!adapters.model) {
          run.status[node.id] = 'failed'
          run.artifacts[node.id] = artifactFor(spec, node.id, 'missing-model-adapter')
          continue
        }
        const result = await adapters.model.complete({
          nodeId: node.id,
          prompt: node.title,
          permissionMode: node.permissionMode ?? spec.defaults.permissionMode,
          specVersionId: spec.versionId,
          effectId,
        })
        run.status[node.id] = 'done'
        run.artifacts[node.id] = artifactFor(spec, node.id, result.text)
        run.receipts[effectId] = { nodeId: node.id, effectId, value: result.text }
        continue
      }
      if (node.kind === 'tool') {
        if (!adapters.tool) {
          run.status[node.id] = 'failed'
          run.artifacts[node.id] = artifactFor(spec, node.id, 'missing-tool-adapter')
          continue
        }
        const result = await adapters.tool.invoke({
          nodeId: node.id,
          payload: node.title,
          permissionMode: node.permissionMode ?? spec.defaults.permissionMode,
          specVersionId: spec.versionId,
          effectId,
        })
        run.status[node.id] = 'done'
        run.artifacts[node.id] = artifactFor(spec, node.id, result.text)
        run.receipts[effectId] = { nodeId: node.id, effectId, value: result.text }
        continue
      }
      if (node.kind === 'subflow') {
        if (!adapters.subflow) {
          run.status[node.id] = 'failed'
          run.artifacts[node.id] = artifactFor(spec, node.id, 'missing-subflow-adapter')
          continue
        }
        const result = await adapters.subflow.run({
          nodeId: node.id,
          payload: node.title,
          specVersionId: spec.versionId,
          effectId,
        })
        run.status[node.id] = 'done'
        run.artifacts[node.id] = artifactFor(spec, node.id, result.text)
        run.receipts[effectId] = { nodeId: node.id, effectId, value: result.text }
        continue
      }
    } catch (error) {
      run.status[node.id] = 'failed'
      run.artifacts[node.id] = artifactFor(spec, node.id, error instanceof Error ? error.message : String(error))
    }
  }
  if (!waiting) run.finishedAt = now
  return run
}

export function replayRun(spec: SessionWorkflowSpec, previous: WorkflowRun, now = Date.now()): WorkflowRun {
  if (previous.specVersionId !== spec.versionId) {
    throw new WorkflowRunError('Replay requires the same immutable specification version', [
      { path: 'specVersionId', message: `${previous.specVersionId} !== ${spec.versionId}` },
    ])
  }
  if (previous.execution === 'production') {
    throw new WorkflowRunError('Replay of a production run requires runWorkflowProduction with prior receipts', [
      { path: 'execution', message: 'production replay is not the simulate path' },
    ])
  }
  const next = runWorkflow({ spec, mode: previous.mode, seedIds: previous.nodeIds, now })
  return { ...next, specVersionId: previous.specVersionId, execution: 'simulate' }
}

export function compareRuns(a: WorkflowRun, b: WorkflowRun): { sameSpec: boolean; artifactDelta: string[] } {
  const keys = new Set([...Object.keys(a.artifacts), ...Object.keys(b.artifacts)])
  const artifactDelta = [...keys].filter((key) => a.artifacts[key]?.value !== b.artifacts[key]?.value)
  return { sameSpec: a.specVersionId === b.specVersionId, artifactDelta }
}

export function sameSpecContent(a: SessionWorkflowSpec, b: SessionWorkflowSpec): boolean {
  return fingerprintSpec(a) === fingerprintSpec(b)
}
