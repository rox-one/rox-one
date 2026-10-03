import { describe, expect, it } from 'bun:test'
import { buildRuntimeGraph, projectRuntimeEvents, known, type RuntimeEvent } from '@rox/core/runtime-trace'
import { createRuntimeTraceFixture } from '@rox/core/runtime-trace/fixture'
import { buildRuntimeContextGroups, runtimeRootAgentId } from '../context-groups'

function fixture(): RuntimeEvent[] {
  const events = createRuntimeTraceFixture()
  const root = events.find(event => event.kind === 'context.captured')!
  if (root.kind !== 'context.captured') throw new Error('Fixture needs a root snapshot')
  root.payload.snapshot.blocks = Array.from({ length: 6 }, (_, index) => ({ id: `rule-${index}`, kind: index < 3 ? 'system' as const : 'rules' as const, label: `Root rule ${index}`, source: 'explicit-test', order: index, content: { text: `ROOT_RULE_${index}` }, included: true }))
  root.payload.snapshot.blocks.push({ id: 'schema', kind: 'tool-schema', label: 'Root tool schema', source: 'explicit-test', order: 6, content: { text: 'ACTUAL_SCHEMA' }, included: true })
  events.push({ ...root, eventId: 'child-context-event', sourceEventId: 'child-context-event', sourceSeq: 17, seq: 17, agentId: 'fixture-child-a', parentAgentId: 'fixture-parent', runId: 'fixture-child-run-a', payload: { snapshot: { ...root.payload.snapshot, id: 'child-context', model: { ...root.payload.snapshot.model, confirmed: known('child/model', 'explicit-test') }, blocks: [{ id: 'child-rule', kind: 'system', label: 'Child rule', source: 'explicit-test', order: 0, content: { text: 'CHILD_RULE' }, included: true }] } } })
  return events
}
describe('observed context presentation groups', () => {
  it('preserves source identities and ordered real rows without modifying the graph', () => {
    const graph = buildRuntimeGraph(projectRuntimeEvents(fixture())), before = JSON.stringify(graph)
    const data = buildRuntimeContextGroups(graph)
    expect(runtimeRootAgentId(graph)).toBe('fixture-parent')
    expect(data.snapshot?.id).toBe('fixture-context')
    const rows = data.groups.find(group => group.id === 'instructions')!.rows
    expect(rows).toHaveLength(6)
    expect(rows.map(row => row.id)).toEqual(Array.from({ length: 6 }, (_, index) => `fixture-context:rule-${index}`))
    expect(rows.every(row => row.sourceEventId === 'fixture:3' && row.sourceAgentId === 'fixture-parent' && row.contextSnapshotId === 'fixture-context' && graph.nodes.includes(row.node))).toBe(true)
    expect(data.groups.find(group => group.id === 'tools')!.rows).toHaveLength(1)
    expect(data.groups.find(group => group.id === 'tools')!.rows[0]!.summaryKey).toBe('runtimeMap.contextGroup.toolSchema')
    expect(data.groups.find(group => group.id === 'agents')!.rows).toHaveLength(2)
    expect(data.groups.find(group => group.id === 'launch')!.rows).toHaveLength(2)
    expect(JSON.stringify(graph)).toBe(before)
  })
  it('separates child snapshot/model, allowed tools and actual calls from root configuration', () => {
    const graph = buildRuntimeGraph(projectRuntimeEvents(fixture())), data = buildRuntimeContextGroups(graph, 'fixture-child-a')
    expect(data.snapshot?.id).toBe('child-context')
    expect(data.groups.find(group => group.id === 'model')!.rows[1]!.summary).toBe('child/model')
    expect(data.groups.find(group => group.id === 'instructions')!.rows.map(row => row.title)).toEqual(['Child rule'])
    const tools = data.groups.find(group => group.id === 'tools')!.rows
    expect(tools.map(row => row.summaryKey)).toContain('runtimeMap.allowedTools')
    expect(tools.map(row => row.summaryKey)).toContain('runtimeMap.contextGroup.observedUse')
    expect(data.groups.find(group => group.id === 'skills')!.rows[0]!.summaryKey).toBe('runtimeMap.skill.loaded')
    expect(data.groups.flatMap(group => group.rows).every(row => row.sourceAgentId === 'fixture-child-a')).toBe(true)
  })
  it('never borrows another agent snapshot and never fabricates a schedule or trigger', () => {
    const events = fixture().filter(event => event.eventId !== 'fixture:3'), graph = buildRuntimeGraph(projectRuntimeEvents(events))
    expect(buildRuntimeContextGroups(graph).snapshot).toBeUndefined()
    expect(buildRuntimeContextGroups(graph).groups.find(group => group.id === 'model')!.rows).toHaveLength(0)
    expect(buildRuntimeContextGroups(graph, 'fixture-child-b').snapshot).toBeUndefined()
    expect(buildRuntimeContextGroups(graph, 'fixture-child-b').groups.find(group => group.id === 'instructions')!.rows).toHaveLength(0)
    const launch = buildRuntimeContextGroups(graph).groups.find(group => group.id === 'launch')!.rows
    expect(launch.map(row => row.titleKey)).toEqual(['runtimeMap.launch.manual', 'runtimeMap.dispatchTime'])
    expect(launch[1]!.summaryKey).toBe('runtimeMap.unknown')
  })
  it('does not infer root identity from an orphan snapshot in a shared native run', () => {
    const event = fixture().find(item => item.eventId === 'child-context-event')!
    const graph = buildRuntimeGraph(projectRuntimeEvents([{ ...event, runId: event.rootRunId, parentAgentId: undefined }]))
    expect(runtimeRootAgentId(graph)).toBeUndefined()
    expect(buildRuntimeContextGroups(graph).snapshot).toBeUndefined()
    expect(buildRuntimeContextGroups(graph, event.agentId).snapshot?.id).toBe('child-context')
  })
})
