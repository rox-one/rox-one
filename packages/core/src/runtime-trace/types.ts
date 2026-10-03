/** Versioned observations of execution. These types never authorize an action. */
export type EvidenceOrigin = 'observed' | 'derived' | 'estimated'
export type Measurement<T> =
  | { state: 'known'; value: T; origin: EvidenceOrigin; source: string; algorithm?: string; measuredAt?: number }
  | { state: 'unknown'; reason: 'not-emitted' | 'not-recorded' | 'unsupported' | 'redacted' | 'not-applicable' | 'partial' }
export type RuntimeStatus = 'queued' | 'running' | 'blocked' | 'waiting-approval' | 'succeeded' | 'failed' | 'cancelled' | 'interrupted'
export interface RuntimeContent {
  text?: string
  payloadRef?: string
  byteLength?: number
  truncated?: boolean
  /** False marks a cumulative provider snapshot; absent preserves delta semantics. */
  isDelta?: boolean
  availability?: 'available' | 'redacted' | 'not-recorded'
  tokens?: Measurement<number>
}
export interface CapabilityRef {
  kind: 'skill' | 'source' | 'model-connection' | 'local-tool' | 'channel-identity'
  id: string
  scope: 'workspace' | 'project' | 'session' | 'omp' | 'global'
  label: string
  version?: string
}
export interface RuntimeModel {
  requested?: string
  confirmed: Measurement<string>
  provider?: string
  connection?: CapabilityRef
  contextWindow: Measurement<number>
}
export interface RuntimeContextBlock {
  id: string
  kind: 'system' | 'rules' | 'memory' | 'source' | 'attachment' | 'skill' | 'history' | 'tool-schema' | 'user' | 'native'
  label: string
  source: string
  order: number
  content: RuntimeContent
  included: boolean
  version?: string
  hash?: string
  capability?: CapabilityRef
  reduction?: 'none' | 'truncated' | 'summarized' | 'unknown'
}
// KnowledgeProvider already exports ContextSnapshot. Keep the runtime name distinct.
export interface RuntimeContextSnapshot {
  id: string
  version: number
  capturedAt: Measurement<number>
  originalPrompt: RuntimeContent
  effectivePrompt: RuntimeContent
  model: RuntimeModel
  blocks: RuntimeContextBlock[]
  inputTokens: Measurement<number>
  permissionMode?: string
  workingDirectory?: string
  coverage: TraceCoverage
}
export type ContextSnapshot = RuntimeContextSnapshot
export interface TraceCoverage {
  state: 'complete' | 'partial' | 'unavailable'
  source: 'runtime' | 'reconstructed-from-transcript'
  missing: string[]
  reason?: string
}
export interface RuntimeLaunch {
  kind: 'manual' | 'scheduled' | 'channel' | 'delegated' | 'unknown'
  scheduleId?: string
  triggerId?: string
  occurrenceId?: string
  /** IANA timezone actually reported by the scheduling producer. */
  timezone?: string
  /** Scheduled instant, when recorded by the existing scheduler. */
  scheduledAt?: Measurement<number>
  /** Actual producer dispatch instant; distinct from the planned instant. */
  dispatchedAt?: Measurement<number>
  channel?: CapabilityRef
}
export interface AgentAssignment {
  agentId: string
  parentAgentId?: string
  name: string
  task: RuntimeContent
  prompt: RuntimeContent
  expectedResult?: RuntimeContent
  model?: RuntimeModel
  contextSnapshotId?: string
  permissionMode?: string
  tools?: string[]
  sessionId?: string
  nativeKind: 'root' | 'rox-session' | 'task' | 'eval' | 'restricted' | 'unknown'
}
export interface RuntimeTask {
  id: string
  title: string
  description?: RuntimeContent
  parentTaskId?: string
  agentId?: string
  dependsOn: string[]
  status: RuntimeStatus
  criteria: string[]
  authorityRef?: string
}
export interface RuntimePlan { id: string; version: number; title?: string; tasks: RuntimeTask[]; content?: RuntimeContent }
export interface AcceptanceResult {
  id: string
  taskId?: string
  criterion: string
  status: 'running' | 'passed' | 'failed' | 'unknown'
  evidence: RuntimeContent[]
  authorityRef?: string
}
export interface ArtifactRef { id: string; label: string; kind?: string; uri?: string; content?: RuntimeContent; evidenceEventIds?: string[] }
export interface UsageRecord {
  providerCallId: string
  scope: 'self' | 'aggregate'
  source: string
  inputTokens: Measurement<number>
  outputTokens: Measurement<number>
  cacheReadTokens?: Measurement<number>
  cacheWriteTokens?: Measurement<number>
  cost?: Measurement<number>
  currency?: string
  final: boolean
}
export interface RuntimeSpan { id: string; parentSpanId?: string; status: RuntimeStatus; startedAt: Measurement<number>; endedAt?: Measurement<number>; durationMs: Measurement<number>; clockDomain: string }
export interface RuntimeToolPayload {
  name: string
  input?: RuntimeContent
  result?: RuntimeContent
  modelContent?: RuntimeContent
  status?: RuntimeStatus
  capability?: CapabilityRef
  error?: string
}
export interface RuntimeTerminalPayload {
  durationMs?: Measurement<number>
  timedOut?: boolean
  error?: string
  execution?: 'local' | 'sidecar'
  command: string
  shell?: string
  cwd?: string
  stdout?: RuntimeContent
  stderr?: RuntimeContent
  exitCode?: Measurement<number>
  status?: RuntimeStatus
}
export interface RuntimeEventPayloads {
  'run.accepted': { prompt: RuntimeContent; launch: RuntimeLaunch }
  'run.started': { status: RuntimeStatus }
  'run.completed': { status: RuntimeStatus; reason?: string }
  'run.interrupted': { status: 'cancelled' | 'interrupted' | 'failed'; reason?: string }
  'context.captured': { snapshot: RuntimeContextSnapshot }
  'context.changed': { snapshot: RuntimeContextSnapshot }
  'context.compacted': { snapshot?: RuntimeContextSnapshot; summary?: RuntimeContent }
  'model.confirmed': { model: RuntimeModel }
  'model.changed': { model: RuntimeModel }
  'plan.published': { plan: RuntimePlan }
  'plan.revised': { plan: RuntimePlan }
  'task.state-changed': { task: RuntimeTask }
  'acceptance.started': { acceptance: AcceptanceResult }
  'acceptance.completed': { acceptance: AcceptanceResult }
  'agent.assigned': { assignment: AgentAssignment }
  'agent.started': { name?: string; status: RuntimeStatus }
  'agent.completed': { status: RuntimeStatus; result?: RuntimeContent }
  'skill.selected': { capability: CapabilityRef; content?: RuntimeContent }
  'skill.loaded': { capability: CapabilityRef; content?: RuntimeContent }
  'skill.applied': { capability: CapabilityRef; content?: RuntimeContent }
  'tool.started': RuntimeToolPayload
  'tool.output': RuntimeToolPayload
  'tool.completed': RuntimeToolPayload
  'terminal.started': RuntimeTerminalPayload
  'terminal.output': RuntimeTerminalPayload
  'terminal.completed': RuntimeTerminalPayload
  'reasoning.output': { content: RuntimeContent; provenance: 'provider' | 'summary' | 'explicit'; complete?: boolean }
  'decision.recorded': { content: RuntimeContent; provenance: 'explicit' | 'summary'; evidenceEventIds?: string[] }
  'approval.requested': { id: string; kind: 'permission' | 'credential'; description: string }
  'approval.resolved': { id: string; approved: boolean }
  'operation.queued': { description: string }
  'attempt.started': { status: RuntimeStatus; description?: string }
  'attempt.completed': { status: RuntimeStatus; description?: string }
  'memory.retrieved': { id: string; content: RuntimeContent }
  'memory.included': { id: string; content: RuntimeContent }
  'memory.proposed': { id: string; content: RuntimeContent }
  'memory.committed': { id: string; content: RuntimeContent }
  'usage.reported': { usage: UsageRecord }
  'artifact.created': { artifact: ArtifactRef }
  'result.published': { content: RuntimeContent; artifactIds?: string[]; evidenceEventIds?: string[] }
  'trace.coverage': { coverage: TraceCoverage }
  'trace.gap': { fromSeq: number; toSeq?: number; reason: string }
  'trace.resumed': { afterSeq: number }
}
export type RuntimeEventKind = keyof RuntimeEventPayloads
export interface RuntimeEnvelope {
  schemaVersion: 1
  eventId: string
  sourceEventId: string
  sourceId: string
  sourceSeq: number
  workspaceId: string
  rootSessionId: string
  sessionId?: string
  rootRunId: string
  runId: string
  agentId: string
  parentAgentId?: string
  spanId?: string
  parentSpanId?: string
  attemptId?: string
  providerTurnId?: string
  providerCallId?: string
  messageId?: string
  toolUseId?: string
  causationEventId?: string
  seq: number
  occurredAt: Measurement<number>
  receivedAt: number
  clockDomain: string
  elapsedMs?: number
  origin: EvidenceOrigin
  payloadRef?: string
}
export type RuntimeEvent = { [K in RuntimeEventKind]: RuntimeEnvelope & { kind: K; payload: RuntimeEventPayloads[K] } }[RuntimeEventKind]
export type RuntimeObservation = { [K in RuntimeEventKind]: Omit<RuntimeEnvelope, 'seq' | 'receivedAt'> & { kind: K; payload: RuntimeEventPayloads[K] } }[RuntimeEventKind]
/** An executor only supplies observations; the session collector owns all run identities. */
export type RuntimeAgentObservation = { [K in RuntimeEventKind]: Pick<RuntimeEnvelope, 'sourceEventId' | 'sourceId' | 'sourceSeq' | 'agentId' | 'occurredAt' | 'clockDomain' | 'origin'> & Partial<Pick<RuntimeEnvelope, 'parentAgentId' | 'spanId' | 'parentSpanId' | 'attemptId' | 'providerTurnId' | 'providerCallId' | 'toolUseId' | 'messageId' | 'elapsedMs'>> & { kind: K; payload: RuntimeEventPayloads[K] } }[RuntimeEventKind]
export interface RuntimeCursor { rootRunId: string; seq: number }
export interface RuntimeRunSummary { rootRunId: string; sessionId: string; agentId: string; status: RuntimeStatus; startedAt: number; prompt: string; coverage: TraceCoverage }
export interface RuntimeTraceSnapshot {
  schemaVersion: 1
  workspaceId: string
  sessionId: string
  runs: RuntimeRunSummary[]
  activeRootRunId?: string
  events: RuntimeEvent[]
  cursor?: RuntimeCursor
  coverage: TraceCoverage
  hasMore?: boolean
}
export interface RuntimeTraceQuery { workspaceId: string; sessionId: string; rootRunId?: string; limit?: number }
export interface RuntimeEventsQuery extends RuntimeTraceQuery { rootRunId: string; afterSeq: number }
export interface RuntimeEventsPage { events: RuntimeEvent[]; cursor: RuntimeCursor; hasMore: boolean; coverage: TraceCoverage }
export interface RuntimePayloadQuery extends RuntimeTraceQuery { rootRunId: string; payloadRef: string; offset?: number; limit?: number }
export interface RuntimePayloadPage { text: string; offset: number; nextOffset?: number; byteLength: number; truncated: boolean }
export const known = <T>(value: T, source: string, origin: EvidenceOrigin = 'observed'): Measurement<T> => ({ state: 'known', value, source, origin })
export const unknown = (reason: Extract<Measurement<never>, { state: 'unknown' }>['reason'] = 'not-emitted'): Measurement<never> => ({ state: 'unknown', reason })
