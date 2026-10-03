import { describe, it, expect } from 'bun:test'
import { buildRuntimeGraph, projectRuntimeEvents, reduceRuntimeEvent, type RuntimeEvent } from '@rox/core/runtime-trace'
import { createRuntimeTraceFixture } from '@rox/core/runtime-trace/fixture'
import { layoutRuntimeGraph, nodeMatches, windowRuntimeNodes, COLUMN_WIDTH } from '../layout/stable-layout'

describe('runtime canvas real-observation layout', () => {
  it('places actual workers below parent and gives each assignment a lane', () => {
    const graph = buildRuntimeGraph(projectRuntimeEvents(createRuntimeTraceFixture()))
    const layout = layoutRuntimeGraph(graph)
    const parent = graph.lanes.find(lane => lane.agentId === 'fixture-parent')!
    const child = graph.lanes.find(lane => lane.agentId === 'fixture-child-a')!
    expect(layout.lanes.get(child.id)!.y).toBeGreaterThan(layout.lanes.get(parent.id)!.y)
    expect(child.assignment?.task.text).toBe('Проверь первый источник')
    const root = graph.nodes.find(node => node.kind === 'run')!
    const tool = graph.nodes.find(node => node.kind === 'tool')!
    expect(layout.positions.get(tool.id)!.x).toBeGreaterThan(layout.positions.get(root.id)!.x)
  })
  it('token deltas update one correlated node without changing topology or old positions', () => {
    const fixture = createRuntimeTraceFixture()
    const initial = projectRuntimeEvents(fixture.slice(0, 9))
    const graph = buildRuntimeGraph(initial)
    const original = fixture[8]!
    const delta = { ...original, kind: 'tool.output', seq: 10, eventId: 'extra-output', sourceEventId: 'extra-output', sourceSeq: 10, payload: { name: 'read', result: { text: 'data' } } } as RuntimeEvent
    const next = buildRuntimeGraph(reduceRuntimeEvent(initial, delta))
    expect(next.topologyVersion).toBe(graph.topologyVersion)
    expect(layoutRuntimeGraph(next).positions).toEqual(layoutRuntimeGraph(graph).positions)
  })
  it('true time uses source timestamps only within a single known clock domain', () => {
    const fixture = createRuntimeTraceFixture()
    const known = layoutRuntimeGraph(buildRuntimeGraph(projectRuntimeEvents(fixture)), 'time')
    expect(known.comparableTime).toBe(true)
    const changed = fixture.map((event, index) => index === 0 ? { ...event, clockDomain: 'different-clock' } : event)
    expect(layoutRuntimeGraph(buildRuntimeGraph(projectRuntimeEvents(changed)), 'time').comparableTime).toBe(false)
  })
  it('bounds rendered cards while retaining navigation to every page', () => {
    const base = buildRuntimeGraph(projectRuntimeEvents(createRuntimeTraceFixture())).nodes[0]!
    const nodes = Array.from({ length: 10_000 }, (_, index) => ({ ...base, id: `node:${index}`, seq: index + 1 }))
    expect(windowRuntimeNodes(nodes, 0)).toHaveLength(200)
    expect(windowRuntimeNodes(nodes, 49).at(-1)?.id).toBe('node:9999')
    expect(windowRuntimeNodes(nodes, 50)).toHaveLength(0)
  })
  it('filters observations without turning terminal output into actions', () => {
    const graph = buildRuntimeGraph(projectRuntimeEvents(createRuntimeTraceFixture()))
    const terminal = graph.nodes.find(node => node.kind === 'terminal')!
    expect(nodeMatches(terminal, 'printf', 'terminal')).toBe(true)
    expect(nodeMatches(terminal, '', 'errors')).toBe(false)
    expect(terminal.events.some(event => event.kind === 'terminal.completed')).toBe(true)
  })
})
