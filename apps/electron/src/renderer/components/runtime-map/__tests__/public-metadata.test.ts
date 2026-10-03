import { describe, expect, it } from 'bun:test'
import { buildRuntimeGraph, projectRuntimeEvents, type EvidenceOrigin, type TraceCoverage } from '@rox/core/runtime-trace'
import { createRuntimeTraceFixture } from '@rox/core/runtime-trace/fixture'
import { publicRuntimeMetadata, serializeRuntimeMetadata } from '../public-metadata'

describe('public runtime metadata export', () => {
  it('retains graph references and observed values with export-scoped opaque identities', () => {
    const events = createRuntimeTraceFixture().map(event => event.kind === 'terminal.completed'
      ? { ...event, payload: { ...event.payload, durationMs: { state: 'known' as const, value: 24, origin: 'observed' as const, source: 'private-executor-path' } } } : event)
    const graph = buildRuntimeGraph(projectRuntimeEvents(events))
    const output = publicRuntimeMetadata(graph, { state: 'partial', source: 'runtime', missing: ['not-public', 'also-private'] }, 'fixture-run')
    expect(output.coverage).toEqual({ state: 'partial', source: 'runtime', missingCount: 2 })
    expect(output.rootRunId).toBe('run-1')
    expect(output.nodes).toHaveLength(graph.nodes.length)
    const ids = new Set(output.nodes.map(node => node.id))
    expect(output.edges.every(edge => ids.has(edge.source) && ids.has(edge.target))).toBe(true)
    const terminal = output.nodes.find(node => node.kind === 'terminal')!
    expect(terminal.durationMs).toMatchObject({ state: 'known', value: 24, provenance: 'observed' })
    expect(JSON.stringify(output)).not.toContain('fixture-parent')
    expect(JSON.stringify(output)).not.toContain('private-executor-path')
  })
  it('never exports malicious provenance, coverage reasons, payloads, names or identity paths', () => {
    const secret = '/Users/private/api_key=do-not-publish'
    const graph = buildRuntimeGraph(projectRuntimeEvents(createRuntimeTraceFixture()))
    graph.nodes[0] = { ...graph.nodes[0]!, id: secret, agentId: secret, runId: secret, content: { text: secret },
      kind: secret, durationMs: { state: 'known', value: 7, origin: secret as EvidenceOrigin, source: secret, algorithm: secret } }
    graph.nodes[1] = { ...graph.nodes[1]!, durationMs: { state: 'known', value: 17, origin: 'observed', source: secret, algorithm: secret } }
    const output = serializeRuntimeMetadata(graph, { state: 'partial', source: secret as TraceCoverage['source'], missing: [secret], reason: secret }, secret)
    expect(output).not.toContain(secret)
    expect(output).not.toContain('Сравни два источника')
    expect(output).not.toContain('Первый источник проверен')
    expect(JSON.parse(output).nodes[0]).toMatchObject({ id: 'node-1', agentId: 'agent-1', runId: 'run-1', kind: 'unknown', durationMs: { state: 'unknown' } })
    expect(output).not.toContain('algorithm')
    expect(output).not.toContain('reason')
    expect(JSON.parse(output).coverage).toEqual({ state: 'partial', missingCount: 1 })
  })
  it('does not turn unsupported or invalid measurements into exact zero or JSON null', () => {
    const graph = buildRuntimeGraph(projectRuntimeEvents(createRuntimeTraceFixture()))
    graph.nodes[0] = { ...graph.nodes[0]!, durationMs: { state: 'known', value: NaN, origin: 'observed', source: 'private-path' } }
    expect(publicRuntimeMetadata(graph, { state: 'unavailable', source: 'runtime', missing: [] }).nodes[0]!.durationMs).toEqual({ state: 'unknown' })
  })
})
