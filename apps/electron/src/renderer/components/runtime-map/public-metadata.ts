import type { EvidenceOrigin, Measurement, RuntimeGraph, RuntimeGraphEdge, RuntimeStatus, TraceCoverage } from '@rox/core/runtime-trace'
import { runtimeNodeDuration } from './measurements'

const nodeKinds = ['run', 'context', 'model', 'plan', 'task', 'acceptance', 'agent', 'skill', 'tool', 'terminal', 'reasoning', 'decision', 'result', 'usage', 'memory', 'artifact', 'trace', 'operation', 'attempt', 'approval'] as const
const statuses: readonly RuntimeStatus[] = ['queued', 'running', 'blocked', 'waiting-approval', 'succeeded', 'failed', 'cancelled', 'interrupted']
const origins: readonly EvidenceOrigin[] = ['observed', 'derived', 'estimated']
const edgeKinds: readonly RuntimeGraphEdge['kind'][] = ['parent-child', 'causal', 'data-dependency', 'span-parent']

type PublicDuration = { state: 'unknown' } | { state: 'known'; value: number; provenance: EvidenceOrigin }
export interface PublicRuntimeMetadata {
  schemaVersion: 1
  identityScope: 'export'
  rootRunId?: string
  coverage: { state: TraceCoverage['state']; source?: TraceCoverage['source']; missingCount?: number }
  nodes: { id: string; agentId: string; runId: string; kind: typeof nodeKinds[number] | 'unknown'; status?: RuntimeStatus; seq?: number; endSeq?: number; durationMs: PublicDuration }[]
  edges: { id: string; source: string; target: string; kind: RuntimeGraphEdge['kind'] }[]
}

function enumValue<T extends string>(value: unknown, choices: readonly T[]): T | undefined {
  return typeof value === 'string' && choices.includes(value as T) ? value as T : undefined
}
function sequence(value: number): number | undefined { return Number.isSafeInteger(value) && value >= 0 ? value : undefined }
function duration(measurement: Measurement<number>): PublicDuration {
  if (measurement.state !== 'known' || !Number.isFinite(measurement.value) || measurement.value < 0) return { state: 'unknown' }
  const provenance = enumValue(measurement.origin, origins)
  return provenance ? { state: 'known', value: measurement.value, provenance } : { state: 'unknown' }
}
function identities(prefix: string) {
  const values = new Map<string, string>()
  return (privateId: string) => {
    let value = values.get(privateId)
    if (!value) { value = `${prefix}-${values.size + 1}`; values.set(privateId, value) }
    return value
  }
}

/** Public exports preserve topology, never producer text, paths or private identity strings. */
export function publicRuntimeMetadata(graph: RuntimeGraph, coverage: TraceCoverage, rootRunId?: string): PublicRuntimeMetadata {
  const nodeIdentity = identities('node'), agentIdentity = identities('agent'), runIdentity = identities('run')
  const publicRootRunId = rootRunId ? runIdentity(rootRunId) : undefined
  const nodeIds = new Map(graph.nodes.map(node => [node.id, nodeIdentity(node.id)]))
  const nodes = graph.nodes.map(node => ({ id: nodeIds.get(node.id)!, agentId: agentIdentity(node.agentId), runId: runIdentity(node.runId),
    kind: enumValue(node.kind, nodeKinds) ?? 'unknown' as const, status: enumValue(node.status, statuses), seq: sequence(node.seq), endSeq: sequence(node.endSeq), durationMs: duration(runtimeNodeDuration(node)) }))
  const edges: PublicRuntimeMetadata['edges'] = []
  for (const edge of graph.edges) {
    const kind = enumValue(edge.kind, edgeKinds), source = nodeIds.get(edge.source), target = nodeIds.get(edge.target)
    if (kind && source && target) edges.push({ id: `edge-${edges.length + 1}`, source, target, kind })
  }
  return { schemaVersion: 1, identityScope: 'export', rootRunId: publicRootRunId,
    coverage: { state: enumValue(coverage.state, ['complete', 'partial', 'unavailable']) ?? 'unavailable', source: enumValue(coverage.source, ['runtime', 'reconstructed-from-transcript']), missingCount: Array.isArray(coverage.missing) ? coverage.missing.length : undefined }, nodes, edges }
}

export function serializeRuntimeMetadata(graph: RuntimeGraph, coverage: TraceCoverage, rootRunId?: string): string {
  return JSON.stringify(publicRuntimeMetadata(graph, coverage, rootRunId), null, 2)
}
