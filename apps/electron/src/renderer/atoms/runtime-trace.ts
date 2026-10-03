import { atom } from 'jotai'
import { atomFamily } from 'jotai-family'
import type { RuntimeProjection, RuntimeNode } from '@rox/core/runtime-trace/projector'
import type { RuntimeRunSummary, TraceCoverage } from '@rox/core/runtime-trace'

export interface RuntimeTraceScope { workspaceId: string; sessionId: string }
export const runtimeTraceScopeKey = (scope: RuntimeTraceScope): string => JSON.stringify([scope.workspaceId, scope.sessionId])
export interface RuntimeTraceSessionState {
  projections: Readonly<Record<string, RuntimeProjection>>
  runs: RuntimeRunSummary[]
  activeRootRunId?: string
  canonicalSessionId?: string
  coverage: TraceCoverage
  loading: boolean
  loaded: boolean
  error?: string
  generation: number
}
export function createRuntimeTraceSessionState(): RuntimeTraceSessionState {
  return { projections: {}, runs: [], coverage: { state: 'complete', source: 'runtime', missing: [] }, loading: false, loaded: false, generation: 0 }
}
export const runtimeTraceSessionAtomFamily = atomFamily((key: string) => atom<RuntimeTraceSessionState>(createRuntimeTraceSessionState()))
/** Card consumers can subscribe to one normalized entity, independent of neighboring text deltas. */
export const runtimeTraceNodeAtomFamily = atomFamily((key: string) => atom((get): RuntimeNode | undefined => {
  const [workspaceId, sessionId, rootRunId, nodeId] = JSON.parse(key) as [string, string, string, string]
  return get(runtimeTraceSessionAtomFamily(runtimeTraceScopeKey({workspaceId, sessionId}))).projections[rootRunId]?.nodes[nodeId]
}))
/** Camera/selection belongs to a panel, never to the event journal. */
export interface RuntimeMapSelection { nodeId?: string; eventId?: string; follow: boolean }
export const runtimeMapSelectionAtomFamily = atomFamily((panelScopeKey: string) => atom<RuntimeMapSelection>({ follow: true }))
