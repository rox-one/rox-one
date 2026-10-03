import type { AgentAssignment, Measurement, RuntimeContent, RuntimeContextSnapshot, RuntimeEvent, RuntimePlan, RuntimeStatus, RuntimeTask, RuntimeToolPayload, RuntimeTerminalPayload, TraceCoverage } from './types'
import { unknown, known } from './types'
import { runtimeOperationKey, sourceObservationKey } from './correlation'
import { initialTraceCoverage, mergeTraceCoverage } from './coverage'
import { isRuntimeEvent } from './validation'

export interface RuntimeProjectionScope { workspaceId?: string; sessionId?: string; rootRunId?: string; upToSeq?: number }
export interface RuntimeNode {
  id: string; agentId: string; runId: string; kind: string; status?: RuntimeStatus
  seq: number; endSeq: number; event: RuntimeEvent; events: RuntimeEvent[]; content?: RuntimeContent
  spanId?: string; attemptId?: string; toolUseId?: string; messageId?: string
  tool?: RuntimeToolPayload; terminal?: RuntimeTerminalPayload
  startedAt: Measurement<number>; endedAt?: Measurement<number>; durationMs: Measurement<number>
}
export interface RuntimeAgent {
  id: string; parentAgentId?: string; name: string; assignment?: AgentAssignment; status?: RuntimeStatus
  firstSeq: number; completedSeq?: number
}
export interface RuntimeAgentLane {
  id: string; agentId: string; parentAgentId?: string; depth: number; name: string
  assignment?: AgentAssignment; status?: RuntimeStatus; nodeIds: string[]; orphan: boolean
}
export interface RuntimeGraphEdge { id: string; source: string; target: string; kind: 'parent-child' | 'causal' | 'data-dependency' | 'span-parent' }
export interface RuntimeGraph { nodes: RuntimeNode[]; edges: RuntimeGraphEdge[]; lanes: RuntimeAgentLane[]; topologyVersion: number }
export interface RuntimeProjection {
  scope: RuntimeProjectionScope
  /** Persistent pages/buckets bound copying to a page, instead of copying 10k records per delta. */
  eventPages: readonly (readonly RuntimeEvent[])[]
  identityBuckets: Readonly<Record<number, readonly string[]>>
  sequenceBuckets: Readonly<Record<number, readonly number[]>>
  nodes: Readonly<Record<string, RuntimeNode>>
  agents: Readonly<Record<string, RuntimeAgent>>
  contextSnapshots: Readonly<Record<string, RuntimeContextSnapshot>>
  plans: Readonly<Record<string, RuntimePlan>>
  tasks: Readonly<Record<string, RuntimeTask>>
  coverage: TraceCoverage; highestSeq: number; contiguousSeq: number; eventCount: number; topologyVersion: number
}
const PAGE_SIZE = 256
const terminalStates = new Set<RuntimeStatus>(['succeeded', 'failed', 'cancelled', 'interrupted'])
export const isTerminalRuntimeStatus = (status?: RuntimeStatus): boolean => status !== undefined && terminalStates.has(status)
export function createRuntimeProjection(scope: RuntimeProjectionScope = {}): RuntimeProjection {
  return { scope, eventPages: [], identityBuckets: {}, sequenceBuckets: {}, nodes: {}, agents: {}, contextSnapshots: {}, plans: {}, tasks: {}, coverage: initialTraceCoverage(), highestSeq: 0, contiguousSeq: 0, eventCount: 0, topologyVersion: 0 }
}
function bucket(key: string): number { let hash = 2166136261; for (let i = 0; i < key.length; i++) hash = Math.imul(hash ^ key.charCodeAt(i), 16777619); return (hash >>> 0) % 256 }
function addIdentity(buckets: RuntimeProjection['identityBuckets'], keys: string[]): RuntimeProjection['identityBuckets'] {
  const next = { ...buckets }
  for (const key of keys) { const index = bucket(key); next[index] = [...(next[index] ?? []), key] }
  return next
}
function hasIdentity(state: RuntimeProjection, key: string): boolean { return !!state.identityBuckets[bucket(key)]?.includes(key) }
function eventContent(event: RuntimeEvent): RuntimeContent | undefined {
  const payload = event.payload
  if ('content' in payload) return payload.content
  if ('result' in payload) return payload.result
  if ('stdout' in payload) return payload.stdout
  if ('prompt' in payload) return payload.prompt
  if ('summary' in payload && typeof payload.summary === 'object') return payload.summary
  return undefined
}
function statusOf(event: RuntimeEvent): RuntimeStatus | undefined {
  if ('status' in event.payload && event.payload.status) return event.payload.status
  if (event.kind === 'acceptance.started') return 'running'
  if (event.kind === 'acceptance.completed') return event.payload.acceptance.status === 'passed' ? 'succeeded' : event.payload.acceptance.status === 'failed' ? 'failed' : undefined
  if (event.kind === 'tool.completed' && event.payload.error) return 'failed'
  if (event.kind === 'terminal.completed' && event.payload.exitCode?.state === 'known' && event.payload.exitCode.value !== 0) return 'failed'
  if (event.kind === 'approval.requested') return 'waiting-approval'
  if (event.kind === 'approval.resolved') return event.payload.approved ? 'succeeded' : 'failed'
  if (event.kind === 'task.state-changed') return event.payload.task.status
  if (event.kind.startsWith('tool.') || event.kind.startsWith('terminal.')) return event.kind.endsWith('.completed') ? 'succeeded' : 'running'
  return undefined
}
function isOutput(event: RuntimeEvent): boolean { return event.kind === 'tool.output' || event.kind === 'terminal.output' || event.kind === 'reasoning.output' }
function retainPhases(previous: RuntimeEvent[], event: RuntimeEvent): RuntimeEvent[] {
  if (isOutput(event)) { const index = previous.findIndex(item => item.kind === event.kind); if (index !== -1) return previous.map((item, i) => i === index ? event : item) }
  return [...previous, event]
}
function mergeContent(previous: RuntimeContent | undefined, incoming: RuntimeContent | undefined, append: boolean): RuntimeContent | undefined {
  if (!incoming) return previous
  if (!append || incoming.isDelta === false || previous?.text === undefined || incoming.text === undefined) return incoming
  return {...incoming, text: previous.text + incoming.text, byteLength: undefined, tokens: previous.tokens || incoming.tokens ? unknown('partial') : undefined}
}
function updateNode(previous: RuntimeNode | undefined, event: RuntimeEvent, id: string): RuntimeNode {
  const older = previous && event.seq < previous.endSeq
  const incomingStatus = statusOf(event)
  const sticky = previous && isTerminalRuntimeStatus(previous.status) && (!incomingStatus || !isTerminalRuntimeStatus(incomingStatus))
  const status = older || sticky ? previous?.status : incomingStatus ?? previous?.status
  const first = !previous || event.seq < previous.seq
  const startedAt = first ? event.occurredAt : previous.startedAt
  const endedAt = isTerminalRuntimeStatus(incomingStatus) && !older ? event.occurredAt : previous?.endedAt
  let durationMs: Measurement<number> = previous?.durationMs ?? unknown()
  const startEvent = [...(previous?.events ?? []), event].find(item => item.kind.endsWith('.started'))
  if (isTerminalRuntimeStatus(incomingStatus) && !older && startEvent && startEvent.seq < event.seq && endedAt?.state === 'known' && startEvent.occurredAt.state === 'known' && startEvent.clockDomain === event.clockDomain && event.occurredAt.state === 'known') {
    const elapsed = event.elapsedMs !== undefined && startEvent.elapsedMs !== undefined ? event.elapsedMs - startEvent.elapsedMs : endedAt.value - startEvent.occurredAt.value
    durationMs = elapsed >= 0 ? known(elapsed, event.elapsedMs !== undefined && startEvent.elapsedMs !== undefined ? 'monotonic elapsed' : 'same-domain timestamps', 'derived') : unknown('partial')
  }
  let content = older ? previous?.content : eventContent(event) ?? previous?.content
  if (!older && previous?.content?.text !== undefined && content?.text !== undefined && isOutput(event)) {
    // complete reasoning payload is an authoritative replacement, all other deltas append.
    content = mergeContent(previous.content, content, !(event.kind === 'reasoning.output' && event.payload.complete))
  }
  let tool = previous?.tool; let terminal = previous?.terminal
  if (!older && (event.kind === 'tool.started' || event.kind === 'tool.output' || event.kind === 'tool.completed')) { const payload = event.payload; tool = {...tool, ...payload, status, input: payload.input ?? tool?.input, result: mergeContent(tool?.result, payload.result, event.kind === 'tool.output'), modelContent: payload.modelContent ?? tool?.modelContent} }
  if (!older && (event.kind === 'terminal.started' || event.kind === 'terminal.output' || event.kind === 'terminal.completed')) { const payload = event.payload; terminal = {...terminal, ...payload, status, stdout: mergeContent(terminal?.stdout, payload.stdout, event.kind === 'terminal.output'), stderr: mergeContent(terminal?.stderr, payload.stderr, event.kind === 'terminal.output'), exitCode: payload.exitCode ?? terminal?.exitCode} }
  return { id, agentId: event.kind === 'agent.assigned' ? event.payload.assignment.agentId : event.agentId, runId: event.runId, kind: event.kind.split('.')[0]!, status,
    seq: Math.min(previous?.seq ?? event.seq, event.seq), endSeq: Math.max(previous?.endSeq ?? 0, event.seq), event: older ? previous!.event : event,
    events: retainPhases(previous?.events ?? [], event), content, spanId: event.spanId ?? previous?.spanId, attemptId: event.attemptId ?? previous?.attemptId,
    tool, terminal, toolUseId: event.toolUseId ?? previous?.toolUseId, messageId: event.messageId ?? previous?.messageId, startedAt, endedAt, durationMs }
}
/** Deterministic geometry token: replay and reordered delivery agree, deltas do not invalidate layout. */
function topologyToken(nodes: RuntimeProjection['nodes'], agents: RuntimeProjection['agents']): number {
  let hash = 2166136261
  const parts = [...Object.values(nodes).map(node=>JSON.stringify([node.id,node.seq,node.agentId])), ...Object.values(agents).map(agent=>JSON.stringify([agent.id,agent.parentAgentId ?? '',agent.firstSeq]))].sort()
  for (const part of parts) for (let i=0;i<part.length;i++) hash=Math.imul(hash ^ part.charCodeAt(i),16777619)
  return hash >>> 0
}
/** Pure, replayable projection. Scope violations and malformed input never enter state. */
export function reduceRuntimeEvent(state: RuntimeProjection, event: RuntimeEvent): RuntimeProjection {
  if (!isRuntimeEvent(event)) return state
  const scope = state.scope
  if ((scope.workspaceId && scope.workspaceId !== event.workspaceId) || (scope.sessionId && scope.sessionId !== event.rootSessionId) || (scope.rootRunId && scope.rootRunId !== event.rootRunId) || (scope.upToSeq !== undefined && event.seq > scope.upToSeq)) return state
  const eventKey = `event:${event.eventId}`; const sourceKey = `source:${sourceObservationKey(event)}`
  if (hasIdentity(state, eventKey) || hasIdentity(state, sourceKey)) return state
  // An out-of-order arrival replays in collector order. This rare path also rebuilds deltas deterministically.
  if (event.seq < state.highestSeq && !state.sequenceBuckets[event.seq % 256]?.includes(event.seq)) return projectRuntimeEvents([...runtimeProjectionEvents(state), event], scope)
  // A collector cannot own two different events at the same sequence.
  if (state.sequenceBuckets[event.seq % 256]?.includes(event.seq)) return { ...state, coverage: mergeTraceCoverage(state.coverage, { state: 'partial', source: 'runtime', missing: ['sequence-conflict'], reason: 'Collector sequence collision' }) }
  const pages = state.eventPages.slice(); const last = pages.at(-1)
  if (last && last.length < PAGE_SIZE) pages[pages.length - 1] = [...last, event]; else pages.push([event])
  const sequences = { ...state.sequenceBuckets, [event.seq % 256]: [...(state.sequenceBuckets[event.seq % 256] ?? []), event.seq] }
  let contiguousSeq = state.contiguousSeq
  while (sequences[(contiguousSeq + 1) % 256]?.includes(contiguousSeq + 1)) contiguousSeq++
  const id = runtimeOperationKey(event); const existing = state.nodes[id]; const node = updateNode(existing, event, id)
  let agents = state.agents
  const assignment = event.kind === 'agent.assigned' ? event.payload.assignment : undefined
  const agentId = assignment?.agentId ?? event.agentId
  const oldAgent = agents[agentId]
  const agentStatus = event.kind === 'agent.completed' || event.kind === 'agent.started' ? event.payload.status : event.kind === 'run.completed' || event.kind === 'run.interrupted' || event.kind === 'run.started' ? event.payload.status : undefined
  const newAgent: RuntimeAgent = { id: agentId, firstSeq: Math.min(oldAgent?.firstSeq ?? event.seq, event.seq), name: assignment?.name ?? (event.kind === 'agent.started' ? event.payload.name : undefined) ?? oldAgent?.name ?? agentId,
    parentAgentId: assignment?.parentAgentId ?? event.parentAgentId ?? oldAgent?.parentAgentId, assignment: assignment ?? oldAgent?.assignment,
    status: oldAgent?.completedSeq && oldAgent.completedSeq > event.seq || isTerminalRuntimeStatus(oldAgent?.status) && !isTerminalRuntimeStatus(agentStatus) ? oldAgent?.status : agentStatus ?? oldAgent?.status,
    completedSeq: isTerminalRuntimeStatus(agentStatus) ? Math.max(oldAgent?.completedSeq ?? 0, event.seq) : oldAgent?.completedSeq }
  agents = { ...agents, [agentId]: newAgent }
  let coverage = state.coverage
  if (event.kind === 'trace.coverage') coverage = mergeTraceCoverage(coverage, event.payload.coverage)
  if (event.kind === 'trace.gap') coverage = mergeTraceCoverage(coverage, { state: 'partial', source: 'runtime', missing: [`recorded-gap:${event.payload.fromSeq}-${event.payload.toSeq ?? '?'}`], reason: event.payload.reason })
  let contextSnapshots = state.contextSnapshots; let plans = state.plans; let tasks = state.tasks
  if ('snapshot' in event.payload && event.payload.snapshot) { const snapshot = event.payload.snapshot; contextSnapshots = { ...contextSnapshots, [`${snapshot.id}:${snapshot.version}`]: snapshot }; coverage = mergeTraceCoverage(coverage, snapshot.coverage) }
  if (event.kind === 'plan.published' || event.kind === 'plan.revised') { const plan = event.payload.plan; plans = { ...plans, [`${plan.id}:${plan.version}`]: plan }; tasks = { ...tasks }; for (const task of plan.tasks) (tasks as Record<string, RuntimeTask>)[task.id] = task }
  if (event.kind === 'task.state-changed') tasks = { ...tasks, [event.payload.task.id]: event.payload.task }
  return { ...state, scope: { ...scope, workspaceId: scope.workspaceId ?? event.workspaceId, sessionId: scope.sessionId ?? event.rootSessionId, rootRunId: scope.rootRunId ?? event.rootRunId }, eventPages: pages,
    identityBuckets: addIdentity(state.identityBuckets, [eventKey, sourceKey]), sequenceBuckets: sequences, nodes: { ...state.nodes, [id]: node }, agents,
    coverage, contextSnapshots, plans, tasks, highestSeq: Math.max(state.highestSeq, event.seq), contiguousSeq, eventCount: state.eventCount + 1,
    topologyVersion: !existing || !oldAgent || existing.seq !== node.seq || existing.agentId !== node.agentId || oldAgent.firstSeq !== newAgent.firstSeq || oldAgent.parentAgentId !== newAgent.parentAgentId ? topologyToken({ ...state.nodes, [id]: node }, agents) : state.topologyVersion }
}
export function runtimeProjectionEvents(state: RuntimeProjection): RuntimeEvent[] { return state.eventPages.flat().sort((a, b) => a.seq - b.seq) }
export function projectRuntimeEvents(events: readonly RuntimeEvent[], scope: RuntimeProjectionScope = {}): RuntimeProjection {
  return [...events].sort((a, b) => a.seq - b.seq).reduce(reduceRuntimeEvent, createRuntimeProjection(scope))
}
export function runtimeProjectionCoverage(state: RuntimeProjection): TraceCoverage {
  return state.contiguousSeq < state.highestSeq ? mergeTraceCoverage(state.coverage, { state: 'partial', source: 'runtime', missing: [`delivery-gap:${state.contiguousSeq + 1}`] }) : state.coverage
}
export function buildAgentLanes(state: RuntimeProjection): RuntimeAgentLane[] {
  const result: RuntimeAgentLane[] = []; const agents = Object.values(state.agents).sort((a, b) => a.firstSeq - b.firstSeq || a.id.localeCompare(b.id)); const visited = new Set<string>()
  const add = (agent: RuntimeAgent, depth: number, orphan: boolean) => { if (visited.has(agent.id)) return; visited.add(agent.id)
    result.push({ id: agent.id, agentId: agent.id, parentAgentId: agent.parentAgentId, name: agent.name, assignment: agent.assignment, status: agent.status, depth, orphan,
      nodeIds: Object.values(state.nodes).filter(node => node.agentId === agent.id).sort((a,b)=>a.seq-b.seq).map(node=>node.id) })
    for (const child of agents.filter(item => item.parentAgentId === agent.id)) add(child, depth + 1, orphan)
  }
  for (const agent of agents.filter(item => !item.parentAgentId)) add(agent, 0, false)
  for (const agent of agents.filter(item => item.parentAgentId && !state.agents[item.parentAgentId])) add(agent, 0, true)
  for (const agent of agents) add(agent, 0, true) // cyclic/unknown parentage is explicitly incomplete.
  return result
}
export function buildRuntimeGraph(state: RuntimeProjection): RuntimeGraph {
  const nodes = Object.values(state.nodes).sort((a,b)=>a.seq-b.seq); const edges: RuntimeGraphEdge[] = []; const eventNodes = new Map<string,string>(); const spanNodes = new Map<string,string>(); const assignments = new Map<string,string>(); const agentNodes = new Map<string,string>(); const taskNodes = new Map<string,string>(); const artifactNodes = new Map<string,string>()
  for (const node of nodes) { if (!agentNodes.has(node.agentId)) agentNodes.set(node.agentId,node.id); for (const event of node.events) eventNodes.set(event.eventId,node.id); if (node.event.kind === 'task.state-changed') taskNodes.set(node.event.payload.task.id,node.id); if (node.event.kind === 'artifact.created') artifactNodes.set(node.event.payload.artifact.id,node.id); if (node.spanId) spanNodes.set(node.spanId,node.id); const assignmentEvent = node.events.find(event=>event.kind==='agent.assigned'); if (assignmentEvent?.kind==='agent.assigned') assignments.set(assignmentEvent.payload.assignment.agentId,node.id) }
  if (nodes.some(node=>node.events.some(event=>event.causationEventId || ('evidenceEventIds' in event.payload && event.payload.evidenceEventIds?.length) || event.kind === 'artifact.created' && event.payload.artifact.evidenceEventIds?.length))) for (const page of state.eventPages) for (const event of page) { const id = runtimeOperationKey(event); if (state.nodes[id]) eventNodes.set(event.eventId,id) }
  const seen = new Set<string>()
  const edge = (source: string | undefined, target: string, kind: RuntimeGraphEdge['kind']) => { if(!source||source===target)return; const id=JSON.stringify([source,target,kind]); if(!seen.has(id)){seen.add(id);edges.push({id,source,target,kind})} }
  for(const node of nodes) { const event=node.event; for(const phase of node.events) { edge(phase.causationEventId ? eventNodes.get(phase.causationEventId) : undefined,node.id,'causal'); edge(phase.parentSpanId ? spanNodes.get(phase.parentSpanId) : undefined,node.id,'span-parent')
      if(phase.kind==='agent.assigned') edge(assignments.get(phase.payload.assignment.parentAgentId ?? '') ?? agentNodes.get(phase.payload.assignment.parentAgentId ?? ''),node.id,'parent-child')
    }
    if(event.kind==='task.state-changed') { for (const dependency of event.payload.task.dependsOn) edge(taskNodes.get(dependency),node.id,'data-dependency'); if (event.payload.task.parentTaskId) edge(taskNodes.get(event.payload.task.parentTaskId),node.id,'parent-child') }
    if(event.kind==='decision.recorded'||event.kind==='result.published') for(const evidence of event.payload.evidenceEventIds ?? []) edge(eventNodes.get(evidence),node.id,'data-dependency')
    if(event.kind==='artifact.created') for(const evidence of event.payload.artifact.evidenceEventIds ?? []) edge(eventNodes.get(evidence),node.id,'data-dependency')
    if(event.kind==='result.published') for(const artifact of event.payload.artifactIds ?? []) edge(artifactNodes.get(artifact),node.id,'data-dependency')
  }
  return {nodes,edges,lanes:buildAgentLanes(state),topologyVersion:state.topologyVersion}
}
