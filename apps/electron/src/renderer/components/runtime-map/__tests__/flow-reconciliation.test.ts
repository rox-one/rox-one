import { describe, it, expect } from 'bun:test'
import { buildRuntimeGraph, projectRuntimeEvents } from '@rox/core/runtime-trace'
import { createRuntimeTraceFixture } from '@rox/core/runtime-trace/fixture'
import { reconcileFlowNodes, type RuntimeCanvasNode } from '../layout/reconcile-flow-nodes'

describe('controlled canvas local updates', () => {
  it('retains every unchanged flow object while replacing only the changed operation', () => {
    const graph = buildRuntimeGraph(projectRuntimeEvents(createRuntimeTraceFixture()))
    const make = (): RuntimeCanvasNode[] => graph.nodes.map(runtime => ({ id: runtime.id, type: 'runtime', data: { runtime }, position: { x: runtime.seq * 300, y: 0 }, selected: false }))
    const original = reconcileFlowNodes(new Map(), make())
    const next = make()
    const change = next.find(node => node.type === 'runtime' && node.data.runtime.kind === 'tool')!
    if (change.type !== 'runtime') throw new Error('Missing tool')
    change.data = { runtime: { ...change.data.runtime, content: { text: 'A new observed output' } } }
    const updated = reconcileFlowNodes(original.cache, next)
    const replaced = updated.nodes.filter((node, index) => node !== original.nodes[index])
    expect(replaced.map(node => node.id)).toEqual([change.id])
  })
  it('does not retain removed nodes after switching runs or filtered windows', () => {
    const graph = buildRuntimeGraph(projectRuntimeEvents(createRuntimeTraceFixture()))
    const all: RuntimeCanvasNode[] = graph.nodes.map(runtime => ({ id: runtime.id, type: 'runtime', data: { runtime }, position: { x: 0, y: 0 } }))
    const original = reconcileFlowNodes(new Map(), all)
    const narrowed = reconcileFlowNodes(original.cache, all.slice(0, 1))
    expect(narrowed.cache.size).toBe(1)
    expect(narrowed.nodes[0]).toBe(original.nodes[0])
  })
})
