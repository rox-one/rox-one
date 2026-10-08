import { describe, expect, it } from 'bun:test'
import { getNodesBounds, getViewportForBounds } from '@xyflow/system'
import { buildRuntimeGraph, projectRuntimeEvents, reduceRuntimeEvent } from '@rox/core/runtime-trace'
import { createRuntimePerformanceFixture } from '../../../../../../../tests/fixtures/runtime-map/performance'
import { CARD_WIDTH, layoutRuntimeGraph, layoutRuntimeOverview } from '../layout/stable-layout'
import { initialRuntimeCardGeometry, initialRuntimeLaneGeometry } from '../layout/initial-geometry'
import { overviewMinimumZoom } from '../layout/viewport-policy'

const events = () => createRuntimePerformanceFixture().map(event => ({ ...event, runId: event.agentId === 'load-agent-0' ? event.rootRunId : event.runId }))

describe('bounded presentation overview of actual runtime nodes', () => {
  it('fits 200 actual cards with physical card/header/status geometry above subpixel size', () => {
    const graph = buildRuntimeGraph(projectRuntimeEvents(events())), visible = graph.nodes.slice(-200)
    expect(graph.nodes).toHaveLength(221)
    const layout = layoutRuntimeOverview(graph, visible)
    const nodes = visible.map(node => ({ id: node.id, data: { runtime: node }, position: layout.positions.get(node.id)!, ...initialRuntimeCardGeometry(true) }))
    const lanes = graph.lanes.filter(lane => layout.lanes.has(lane.id)).map(lane => ({ id: `lane:${lane.id}`, data: { lane }, position: layout.lanes.get(lane.id)!, ...initialRuntimeLaneGeometry }))
    const bounds = getNodesBounds([...nodes, ...lanes]), viewport = { width: 834, height: 626 }
    expect(bounds.width).toBeLessThan(3_500)
    expect(bounds.height).toBeLessThan(2_000)
    const camera = getViewportForBounds(bounds, viewport.width, viewport.height, overviewMinimumZoom(bounds, viewport), 1, .18)
    expect(CARD_WIDTH * camera.zoom).toBeGreaterThanOrEqual(40)
    expect(48 * camera.zoom).toBeGreaterThanOrEqual(8)
    expect(13 * camera.zoom).toBeGreaterThanOrEqual(2)
    expect(nodes.every(node => node.position.x * camera.zoom + camera.x >= 0 && (node.position.x + CARD_WIDTH) * camera.zoom + camera.x <= viewport.width && node.position.y * camera.zoom + camera.y >= 0 && (node.position.y + 50) * camera.zoom + camera.y <= viewport.height)).toBe(true)
  })
  it('retains actual node/agent/seq/parent/span/edge data and chronological rank within each lane', () => {
    const graph = buildRuntimeGraph(projectRuntimeEvents(events())), before = JSON.stringify(graph), visible = graph.nodes.slice(-200)
    const normal = layoutRuntimeGraph(graph), overview = layoutRuntimeOverview(graph, visible)
    expect([...overview.positions.keys()].sort()).toEqual(visible.map(node => node.id).sort())
    for (const lane of graph.lanes) {
      const members = visible.filter(node => node.agentId === lane.agentId).sort((a, b) => a.seq - b.seq)
      expect(members.every((node, index) => index === 0 || overview.positions.get(node.id)!.x > overview.positions.get(members[index - 1]!.id)!.x)).toBe(true)
      expect(new Set(members.map(node => overview.positions.get(node.id)!.y)).size).toBe(1)
    }
    expect(JSON.stringify(graph)).toBe(before)
    expect(layoutRuntimeGraph(graph)).toEqual(normal)
    expect(normal.positions).not.toEqual(overview.positions)
  })
  it('does not include filtered/collapsed nodes and keeps geometry stable on text deltas', () => {
    const initial = projectRuntimeEvents(events()), graph = buildRuntimeGraph(initial)
    const visible = graph.nodes.slice(-200).filter(node => node.agentId !== 'load-agent-3')
    const layout = layoutRuntimeOverview(graph, visible)
    expect(layout.positions.size).toBe(190)
    expect(layout.lanes.has('load-agent-3')).toBe(false)
    const collapsed = layoutRuntimeOverview(graph, graph.nodes.slice(-200), new Set(['load-agent-3']))
    expect(collapsed.positions.size).toBe(190)
    expect(collapsed.lanes.has(graph.lanes.find(lane => lane.agentId === 'load-agent-3')!.id)).toBe(true)
    const original = graph.nodes.find(node => node.kind === 'tool')!.event
    if (original.kind !== 'tool.output') throw new Error('Expected actual retained output phase')
    const delta = { ...original, seq: 10_001, sourceSeq: 10_001, eventId: 'overview-test-delta', sourceEventId: 'overview-test-delta', payload: { ...original.payload, result: { text: 'Only actual output changes' } } }
    const next = buildRuntimeGraph(reduceRuntimeEvent(initial, delta))
    const nextVisible = next.nodes.filter(node => layout.positions.has(node.id))
    expect(layoutRuntimeOverview(next, nextVisible)).toEqual(layout)
  })
})
