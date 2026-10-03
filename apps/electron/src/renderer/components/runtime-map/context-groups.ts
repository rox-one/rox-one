import type { CapabilityRef, RuntimeContextSnapshot, RuntimeEvent, RuntimeGraph, RuntimeNode, RuntimeStatus } from '@rox/core/runtime-trace'
import { safePreview, measurementText } from './measurements'

export interface ContextGroupRow {
  id: string; title?: string; titleKey?: string; summary?: string; summaryKey?: string
  status?: RuntimeStatus; node: RuntimeNode; sourceEventId: string; sourceAgentId: string; contextSnapshotId?: string; capability?: CapabilityRef
}
export interface ContextGroup { id: string; titleKey: string; column: 0 | 1 | 2; rows: ContextGroupRow[] }
export interface RuntimeContextGroups { agentId?: string; snapshot?: RuntimeContextSnapshot; snapshotNode?: RuntimeNode; groups: ContextGroup[] }

export function runtimeRootAgentId(graph: RuntimeGraph): string | undefined {
  return graph.nodes.flatMap(node => node.events).find(event => event.kind === 'run.accepted' && event.runId === event.rootRunId && !event.parentAgentId)?.agentId
    ?? graph.nodes.flatMap(node => node.events).find(event => event.kind === 'run.started' && event.runId === event.rootRunId && !event.parentAgentId)?.agentId
}

/** These are presentation containers over observed identities, never runtime events. */
export function buildRuntimeContextGroups(graph: RuntimeGraph, selectedAgentId = runtimeRootAgentId(graph)): RuntimeContextGroups {
  const group = (id: string, titleKey: string, column: 0 | 1 | 2): ContextGroup => ({ id, titleKey, column, rows: [] })
  const request = group('request', 'runtimeMap.kind.run', 1)
  const model = group('model', 'runtimeMap.kind.model', 1)
  const instructions = group('instructions', 'runtimeMap.contextGroup.instructions', 1)
  const memory = group('memory', 'runtimeMap.kind.memory', 0)
  const context = group('context', 'runtimeMap.kind.context', 0)
  const tools = group('tools', 'runtimeMap.filterKind.tool', 2)
  const agents = group('agents', 'runtimeMap.contextGroup.subAgents', 2)
  const skills = group('skills', 'runtimeMap.filterKind.skill', 2)
  const launch = group('launch', 'runtimeMap.launchSource', 0)
  const snapshots = new Map<string, { node: RuntimeNode; event: RuntimeEvent; snapshot: RuntimeContextSnapshot }>()
  for (const node of graph.nodes.filter(node => node.agentId === selectedAgentId)) for (const event of node.events) {
    const snapshot = event.kind === 'context.captured' || event.kind === 'context.changed' || event.kind === 'context.compacted' ? event.payload.snapshot : undefined
    if (snapshot && (!snapshots.has(node.agentId) || snapshots.get(node.agentId)!.event.seq < event.seq)) snapshots.set(node.agentId, { node, event, snapshot })
  }
  // A missing root snapshot remains missing; a child model is never substituted.
  const primary = snapshots.get(selectedAgentId ?? '')
  for (const { node, event, snapshot } of snapshots.values()) {
    const row = (id: string, titleKey: string, summary?: string, summaryKey?: string): ContextGroupRow => ({ id, titleKey, summary: safePreview(summary, 150), summaryKey, node, sourceEventId: event.eventId, sourceAgentId: node.agentId, contextSnapshotId: snapshot.id })
    request.rows.push(row(`${snapshot.id}:original`, 'runtimeMap.originalPrompt', snapshot.originalPrompt.text, snapshot.originalPrompt.text ? undefined : 'runtimeMap.notRecorded'))
    request.rows.push(row(`${snapshot.id}:effective`, 'runtimeMap.effectivePrompt', snapshot.effectivePrompt.text, snapshot.effectivePrompt.text ? undefined : 'runtimeMap.contentInInspector'))
    model.rows.push(row(`${snapshot.id}:requested`, 'runtimeMap.requestedModel', snapshot.model.requested, snapshot.model.requested ? undefined : 'runtimeMap.notRecorded'))
    model.rows.push(row(`${snapshot.id}:confirmed`, 'runtimeMap.confirmedModel', measurementText(snapshot.model.confirmed), snapshot.model.confirmed.state === 'known' ? undefined : 'runtimeMap.notRecorded'))
    if (snapshot.permissionMode) context.rows.push(row(`${snapshot.id}:permission`, 'runtimeMap.permissions', snapshot.permissionMode))
    if (snapshot.workingDirectory) context.rows.push(row(`${snapshot.id}:cwd`, 'runtimeMap.workingDirectory', snapshot.workingDirectory))
    for (const block of [...snapshot.blocks].sort((a, b) => a.order - b.order)) {
      const destination = ['system', 'rules', 'native'].includes(block.kind) ? instructions : block.kind === 'memory' ? memory : block.kind === 'skill' ? skills : block.kind === 'tool-schema' ? tools : context
      destination.rows.push({ id: `${snapshot.id}:${block.id}`, title: safePreview(block.label, 100), summaryKey: block.included ? block.kind === 'tool-schema' ? 'runtimeMap.contextGroup.toolSchema' : 'runtimeMap.included' : 'runtimeMap.notIncluded', node, sourceEventId: event.eventId, sourceAgentId: node.agentId, contextSnapshotId: snapshot.id, capability: block.capability })
    }
  }
  if (!snapshots.size) {
    const accepted = graph.nodes.filter(node => node.agentId === selectedAgentId).flatMap(node => node.events.filter(event => event.kind === 'run.accepted').map(event => ({ node, event }))).at(-1)
    if (accepted && accepted.event.kind === 'run.accepted') request.rows.push({ id: accepted.event.eventId, titleKey: 'runtimeMap.originalPrompt', summary: safePreview(accepted.event.payload.prompt.text, 150), node: accepted.node, sourceEventId: accepted.event.eventId, sourceAgentId: accepted.node.agentId })
  }
  for (const node of graph.nodes.filter(node => node.agentId === selectedAgentId)) {
    const event = node.event
    const provenance = { sourceEventId: event.eventId, sourceAgentId: node.agentId }
    if (event.kind === 'tool.started' || event.kind === 'tool.output' || event.kind === 'tool.completed') tools.rows.push({ id: node.id, title: safePreview(event.payload.name, 100), summaryKey: 'runtimeMap.contextGroup.observedUse', status: node.status, node, ...provenance, capability: event.payload.capability })
    if (event.kind === 'skill.selected' || event.kind === 'skill.loaded' || event.kind === 'skill.applied') skills.rows.push({ id: node.id, title: safePreview(event.payload.capability.label, 100), summaryKey: `runtimeMap.skill.${event.kind.split('.')[1]}`, node, ...provenance, capability: event.payload.capability })
    if (event.kind === 'memory.retrieved' || event.kind === 'memory.included' || event.kind === 'memory.proposed' || event.kind === 'memory.committed') memory.rows.push({ id: node.id, title: safePreview(event.payload.id, 100), summaryKey: `runtimeMap.memoryState.${event.kind.split('.')[1]}`, node, ...provenance })
    const assignment = node.events.find(phase => phase.kind === 'agent.assigned')
    if (assignment?.kind === 'agent.assigned') for (const name of assignment.payload.assignment.tools ?? []) tools.rows.push({ id: `${assignment.eventId}:allow:${name}`, title: safePreview(name, 100), summaryKey: 'runtimeMap.allowedTools', node, sourceEventId: assignment.eventId, sourceAgentId: node.agentId, contextSnapshotId: assignment.payload.assignment.contextSnapshotId })
    for (const accepted of node.events) if (accepted.kind === 'run.accepted' && !launch.rows.length) {
      const data = accepted.payload.launch
      const source = { node, sourceEventId: accepted.eventId, sourceAgentId: node.agentId }
      launch.rows.push({ id: accepted.eventId, titleKey: `runtimeMap.launch.${data.kind}`, ...source })
      if (data.scheduleId) launch.rows.push({ id: `${accepted.eventId}:schedule`, titleKey: 'runtimeMap.schedule', summary: safePreview(data.scheduleId, 120), ...source })
      if (data.triggerId) launch.rows.push({ id: `${accepted.eventId}:trigger`, titleKey: 'runtimeMap.contextGroup.trigger', summary: safePreview(data.triggerId, 120), ...source })
      if (data.channel) launch.rows.push({ id: `${accepted.eventId}:channel`, titleKey: 'runtimeMap.contextGroup.channel', summary: safePreview(data.channel.label, 120), ...source, capability: data.channel })
    }
  }
  for (const lane of graph.lanes) if (lane.parentAgentId === selectedAgentId && selectedAgentId) {
    const node = graph.nodes.find(item => item.agentId === lane.agentId && item.events.some(event => event.kind === 'agent.assigned'))
    const assigned = node?.events.find(event => event.kind === 'agent.assigned')
    if (node && assigned?.kind === 'agent.assigned') {
      agents.rows.push({ id: lane.id, title: safePreview(lane.name, 100), summary: safePreview(assigned.payload.assignment.task.text, 120), status: lane.status, node, sourceEventId: assigned.eventId, sourceAgentId: node.agentId, contextSnapshotId: assigned.payload.assignment.contextSnapshotId })
    }
  }
  // Empty groups honestly indicate absent observations, not unavailable adapters.
  return { agentId: selectedAgentId, snapshot: primary?.snapshot, snapshotNode: primary?.node, groups: [launch, memory, context, request, model, instructions, tools, agents, skills] }
}
