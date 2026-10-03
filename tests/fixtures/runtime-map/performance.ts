/** Synthetic load belongs only to tests; each output updates an existing span. */
import { known, type RuntimeEvent, type RuntimeEventKind, type RuntimeEventPayloads } from '../../../packages/core/src/runtime-trace/types'

export function createRuntimePerformanceFixture(eventCount = 10_000, agentCount = 20, spanCount = 200): RuntimeEvent[] {
  if (eventCount < agentCount + spanCount + 2 || agentCount < 3) throw new Error('Invalid performance profile')
  const events: RuntimeEvent[] = []
  function add<K extends RuntimeEventKind>(kind: K, payload: RuntimeEventPayloads[K], agentId = 'load-agent-0', spanId?: string) {
    const seq = events.length + 1
    events.push({ schemaVersion: 1, eventId: `load-${seq}`, sourceEventId: `load-${seq}`, sourceId: 'performance-fixture', sourceSeq: seq,
      workspaceId: 'load-workspace', rootSessionId: 'load-session', sessionId: 'load-session', rootRunId: 'load-run', runId: `load-run-${agentId}`,
      agentId, parentAgentId: agentId === 'load-agent-0' ? undefined : agentId === 'load-agent-2' ? 'load-agent-1' : 'load-agent-0',
      seq, occurredAt: known(1_000 + seq, 'performance-fixture'), receivedAt: 1_000 + seq, clockDomain: 'performance-fixture',
      origin: 'observed', spanId, toolUseId: spanId, kind, payload } as RuntimeEvent)
  }
  add('run.accepted', { prompt: { text: 'Explicit synthetic performance profile' }, launch: { kind: 'manual' } })
  add('run.started', { status: 'running' })
  for (let i = 1; i < agentCount; i++) add('agent.assigned', { assignment: {
    agentId: `load-agent-${i}`, parentAgentId: i === 2 ? 'load-agent-1' : 'load-agent-0', name: `Load agent ${i}`,
    task: { text: `Deterministic load partition ${i}` }, prompt: { text: `Deterministic load partition ${i}` }, nativeKind: 'task',
  } }, `load-agent-${i}`)
  for (let i = 0; i < spanCount; i++) add('tool.started', { name: 'fixture_read', input: { text: `{"partition":${i}}` }, status: 'running' }, `load-agent-${i % agentCount}`, `load-span-${i}`)
  while (events.length < eventCount) {
    const i = events.length % spanCount
    add('tool.output', { name: 'fixture_read', result: { text: `Increment ${events.length}` }, status: 'running' }, `load-agent-${i % agentCount}`, `load-span-${i}`)
  }
  return events
}
