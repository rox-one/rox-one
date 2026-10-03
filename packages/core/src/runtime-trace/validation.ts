import type { RuntimeAgentObservation, RuntimeEvent, RuntimeObservation, RuntimeTraceSnapshot, RuntimeEventsPage, RuntimePayloadPage, RuntimeLaunch, TraceCoverage } from './types'

type Check = (value: unknown) => boolean
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const string: Check = value => typeof value === 'string'
const id: Check = value => typeof value === 'string' && value.length > 0 && value.length <= 4096
const number: Check = value => typeof value === 'number' && Number.isFinite(value)
const count: Check = value => number(value) && Number.isSafeInteger(value) && (value as number) >= 0
const positive: Check = value => count(value) && (value as number) > 0
const boolean: Check = value => typeof value === 'boolean'
const oneOf = (...values: unknown[]): Check => value => values.includes(value)
const array = (check: Check): Check => value => Array.isArray(value) && value.length <= 100_000 && value.every(check)
const shape = (required: Record<string, Check>, optional: Record<string, Check> = {}): Check => value => object(value)
  && Object.entries(required).every(([key, check]) => check(value[key]))
  && Object.entries(optional).every(([key, check]) => value[key] === undefined || check(value[key]))
const origin = oneOf('observed', 'derived', 'estimated')
const status = oneOf('queued', 'running', 'waiting-approval', 'blocked', 'succeeded', 'failed', 'cancelled', 'interrupted')
const measurement = (valueCheck: Check): Check => value => object(value) && (value.state === 'known'
  ? shape({ state: oneOf('known'), value: valueCheck, origin, source: id }, { algorithm: string, measuredAt: number })(value)
  : shape({ state: oneOf('unknown'), reason: oneOf('not-emitted', 'not-recorded', 'unsupported', 'redacted', 'not-applicable', 'partial') })(value))
const numericMeasurement = measurement(value => number(value) && (value as number) >= 0)
const content = shape({}, { text: string, payloadRef: id, byteLength: count, truncated: boolean, isDelta: boolean, availability: oneOf('available', 'redacted', 'not-recorded'), tokens: numericMeasurement })
const capability = shape({ kind: oneOf('skill', 'source', 'model-connection', 'local-tool', 'channel-identity'), id, scope: oneOf('workspace', 'project', 'session', 'omp', 'global'), label: string }, { version: string })
const coverage = shape({ state: oneOf('complete', 'partial', 'unavailable'), source: oneOf('runtime', 'reconstructed-from-transcript'), missing: array(string) }, { reason: string })
const model = shape({ confirmed: measurement(id), contextWindow: numericMeasurement }, { requested: string, provider: string, connection: capability })
const block = shape({ id, kind: oneOf('system', 'rules', 'memory', 'source', 'attachment', 'skill', 'history', 'tool-schema', 'user', 'native'), label: string, source: string, order: count, content, included: boolean }, { version: string, hash: string, capability, reduction: oneOf('none', 'truncated', 'summarized', 'unknown') })
const snapshot = shape({ id, version: positive, capturedAt: numericMeasurement, originalPrompt: content, effectivePrompt: content, model, blocks: array(block), inputTokens: numericMeasurement, coverage }, { permissionMode: string, workingDirectory: string })
const task = shape({ id, title: string, dependsOn: array(id), status, criteria: array(string) }, { description: content, parentTaskId: id, agentId: id, authorityRef: string })
const plan = shape({ id, version: positive, tasks: array(task) }, { title: string, content })
const acceptance = shape({ id, criterion: string, status: oneOf('running', 'passed', 'failed', 'unknown'), evidence: array(content) }, { taskId: id, authorityRef: string })
const assignment = shape({ agentId: id, name: string, task: content, prompt: content, nativeKind: oneOf('root', 'rox-session', 'task', 'eval', 'restricted', 'unknown') }, { parentAgentId: id, expectedResult: content, model, contextSnapshotId: id, permissionMode: string, tools: array(string), sessionId: id })
const tool = shape({ name: id }, { input: content, result: content, modelContent: content, status, capability, error: string })
const terminal = shape({ command: string }, { shell: string, cwd: string, stdout: content, stderr: content, exitCode: measurement(number), durationMs: numericMeasurement, timedOut: boolean, error: string, execution: oneOf('local', 'sidecar'), status })
const usage = shape({ providerCallId: id, scope: oneOf('self', 'aggregate'), source: id, inputTokens: numericMeasurement, outputTokens: numericMeasurement, final: boolean }, { cacheReadTokens: numericMeasurement, cacheWriteTokens: numericMeasurement, cost: numericMeasurement, currency: string })
const artifact = shape({ id, label: string }, { kind: string, uri: string, content, evidenceEventIds: array(id) })
const launch = shape({ kind: oneOf('manual', 'scheduled', 'channel', 'delegated', 'unknown') }, { scheduleId: id, triggerId: id, occurrenceId: id, timezone: id, scheduledAt: numericMeasurement, dispatchedAt: numericMeasurement, channel: capability })
/** Declarative telemetry only: validating it never authorizes execution. */
export const isRuntimeLaunch = (value: unknown): value is RuntimeLaunch => launch(value)
const payloads: Record<string, Check> = {
  'run.accepted': shape({ prompt: content, launch }),
  'run.started': shape({ status }), 'run.completed': shape({ status }, { reason: string }),
  'run.interrupted': shape({ status: oneOf('cancelled', 'interrupted', 'failed') }, { reason: string }),
  'context.captured': shape({ snapshot }), 'context.changed': shape({ snapshot }), 'context.compacted': shape({}, { snapshot, summary: content }),
  'model.confirmed': shape({ model }), 'model.changed': shape({ model }),
  'plan.published': shape({ plan }), 'plan.revised': shape({ plan }), 'task.state-changed': shape({ task }),
  'acceptance.started': shape({ acceptance }), 'acceptance.completed': shape({ acceptance }),
  'agent.assigned': shape({ assignment }), 'agent.started': shape({ status }, { name: string }), 'agent.completed': shape({ status }, { result: content }),
  'skill.selected': shape({ capability }, { content }), 'skill.loaded': shape({ capability }, { content }), 'skill.applied': shape({ capability }, { content }),
  'tool.started': tool, 'tool.output': tool, 'tool.completed': tool,
  'terminal.started': terminal, 'terminal.output': terminal, 'terminal.completed': terminal,
  'reasoning.output': shape({ content, provenance: oneOf('provider', 'summary', 'explicit') }, { complete: boolean }),
  'decision.recorded': shape({ content, provenance: oneOf('explicit', 'summary') }, { evidenceEventIds: array(id) }),
  'approval.requested': shape({ id, kind: oneOf('permission', 'credential'), description: string }), 'approval.resolved': shape({ id, approved: boolean }),
  'operation.queued': shape({ description: string }), 'attempt.started': shape({ status }, { description: string }), 'attempt.completed': shape({ status }, { description: string }),
  'memory.retrieved': shape({ id, content }), 'memory.included': shape({ id, content }), 'memory.proposed': shape({ id, content }), 'memory.committed': shape({ id, content }),
  'usage.reported': shape({ usage }), 'artifact.created': shape({ artifact }), 'result.published': shape({ content }, { artifactIds: array(id), evidenceEventIds: array(id) }),
  'trace.coverage': shape({ coverage }), 'trace.gap': shape({ fromSeq: positive, reason: string }, { toSeq: positive }), 'trace.resumed': shape({ afterSeq: count }),
}
const emitter = shape({ sourceEventId: id, sourceId: id, sourceSeq: positive, agentId: id, occurredAt: numericMeasurement, clockDomain: id, origin }, { ...Object.fromEntries(['parentAgentId', 'spanId', 'parentSpanId', 'attemptId', 'providerTurnId', 'providerCallId', 'toolUseId', 'messageId'].map(key => [key, id])), elapsedMs: value => number(value) && (value as number) >= 0 })
const identities = shape({ schemaVersion: oneOf(1), eventId: id, workspaceId: id, rootSessionId: id, rootRunId: id, runId: id }, { sessionId: id, causationEventId: id, payloadRef: id, elapsedMs: value => number(value) && (value as number) >= 0 })
function validPayload(value: unknown): value is Record<string, unknown> {
  return object(value) && typeof value.kind === 'string' && !!payloads[value.kind]?.(value.payload)
}
/** Fail closed before any event reaches disk or renderer state; unknown schema/kinds are rejected. */
export const isRuntimeAgentObservation = (value: unknown): value is RuntimeAgentObservation => emitter(value) && validPayload(value)
export const isRuntimeObservation = (value: unknown): value is RuntimeObservation => isRuntimeAgentObservation(value) && identities(value)
export const isRuntimeEvent = (value: unknown): value is RuntimeEvent => isRuntimeObservation(value) && shape({ seq: positive, receivedAt: number })(value)
export function assertRuntimeEvent(value: unknown): asserts value is RuntimeEvent { if (!isRuntimeEvent(value)) throw new Error('Invalid runtime event shape') }
export function assertRuntimeObservation(value: unknown): asserts value is RuntimeObservation { if (!isRuntimeObservation(value)) throw new Error('Invalid runtime observation shape') }
export function assertRuntimeAgentObservation(value: unknown): asserts value is RuntimeAgentObservation { if (!isRuntimeAgentObservation(value)) throw new Error('Invalid runtime agent observation shape') }

const runSummary = shape({ rootRunId: id, sessionId: id, agentId: id, status, startedAt: number, prompt: string, coverage })
const cursor = shape({ rootRunId: id, seq: count })
export const isRuntimeTraceSnapshot = (value: unknown): value is RuntimeTraceSnapshot => shape({ schemaVersion: oneOf(1), workspaceId: id, sessionId: id, runs: array(runSummary), events: array(isRuntimeEvent), coverage }, { activeRootRunId: id, cursor, hasMore: boolean })(value)
export const isRuntimeEventsPage = (value: unknown): value is RuntimeEventsPage => shape({ events: array(isRuntimeEvent), cursor, hasMore: boolean, coverage })(value)
export const isRuntimePayloadPage = (value: unknown): value is RuntimePayloadPage => shape({ text: string, offset: count, byteLength: count, truncated: boolean }, { nextOffset: count })(value)

export const isTraceCoverage = (value: unknown): value is TraceCoverage => coverage(value)
