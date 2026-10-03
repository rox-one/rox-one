import type { RuntimeEvent } from './types'

/** Neither temporal adjacency nor matching text establishes operation identity. */
export function runtimeOperationKey(event: RuntimeEvent): string {
  let identity: string
  const family = event.kind.split('.')[0]!
  switch (family) {
    case 'attempt': identity = event.attemptId ?? event.spanId ?? event.toolUseId ?? event.eventId; break
    case 'tool': case 'terminal':
      identity = event.spanId ?? event.toolUseId ?? event.eventId
      break
    case 'reasoning': identity = JSON.stringify([event.spanId ?? event.providerTurnId ?? event.eventId, event.kind === 'reasoning.output' ? event.payload.provenance : '']); break
    case 'agent': identity = event.kind === 'agent.assigned' ? event.payload.assignment.agentId : event.agentId; break
    case 'skill': identity = 'capability' in event.payload && event.payload.capability ? event.payload.capability.id : event.eventId; break
    case 'task': identity = event.kind === 'task.state-changed' ? event.payload.task.id : event.eventId; break
    case 'acceptance': identity = 'acceptance' in event.payload ? event.payload.acceptance.id : event.eventId; break
    case 'approval': identity = 'id' in event.payload ? event.payload.id : event.eventId; break
    default: identity = event.eventId
  }
  return JSON.stringify([event.workspaceId, event.rootSessionId, event.rootRunId, event.runId, event.agentId, family, identity, event.attemptId ?? ''])
}

export function sourceObservationKey(event: Pick<RuntimeEvent, 'sourceId' | 'sourceEventId' | 'workspaceId' | 'rootSessionId' | 'rootRunId'>): string {
  return JSON.stringify([event.workspaceId, event.rootSessionId, event.rootRunId, event.sourceId, event.sourceEventId])
}
