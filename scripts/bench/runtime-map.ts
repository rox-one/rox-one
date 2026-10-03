/** Measures pure projection only; renderer frame/event-to-paint measurements live in Playwright. */
import { cpus, platform, arch, totalmem } from 'node:os'
import { mkdir, writeFile } from 'node:fs/promises'
import { performance } from 'node:perf_hooks'
import { createRuntimeProjection, reduceRuntimeEvent, buildRuntimeGraph } from '../../packages/core/src/runtime-trace/projector'
import { createRuntimePerformanceFixture } from '../../tests/fixtures/runtime-map/performance'

const events = createRuntimePerformanceFixture()
const heapBefore = process.memoryUsage().heapUsed
const started = performance.now()
const updates: number[] = []
let state = createRuntimeProjection()
for (const event of events) {
  const received = performance.now()
  state = reduceRuntimeEvent(state, event)
  updates.push(performance.now() - received)
}
const projectionMs = performance.now() - started
const graphStart = performance.now()
const graph = buildRuntimeGraph(state)
const graphMs = performance.now() - graphStart
const topology = state.topologyVersion
const final = events.at(-1)!
state = reduceRuntimeEvent(state, { ...final, seq: final.seq + 1, sourceSeq: final.sourceSeq + 1,
  eventId: 'load-final-delta', sourceEventId: 'load-final-delta' })
const sorted = [...updates].sort((a, b) => a - b)
const report = {
  class: 'unit-projection-benchmark', syntheticFixture: true, timestamp: new Date().toISOString(),
  runtime: process.versions.bun ? `Bun ${process.versions.bun}` : `Node ${process.versions.node}`,
  environment: { platform: platform(), arch: arch(), cpu: cpus()[0]?.model, cpuCount: cpus().length, totalMemoryBytes: totalmem() },
  profile: { events: events.length, agents: graph.lanes.length, nodes: graph.nodes.length, maxDepth: Math.max(...graph.lanes.map(lane => lane.depth)) },
  projectionMs, graphMs, updateP95Ms: sorted[Math.floor(sorted.length * 0.95)], updateMaxMs: sorted.at(-1),
  retainedHeapDeltaBytes: process.memoryUsage().heapUsed - heapBefore,
  outputPreservesTopology: state.topologyVersion === topology,
  rendererEventToPaint: 'not-measured-by-this-command', rendererPanFrameTime: 'not-measured-by-this-command',
}
await mkdir('docs/evidence/runtime-map', { recursive: true })
await writeFile('docs/evidence/runtime-map/projection-benchmark.json', JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify(report, null, 2))
if (state.eventCount !== 10_001 || graph.lanes.length !== 20 || graph.nodes.length > 230 || !report.outputPreservesTopology || report.profile.maxDepth < 2) process.exit(1)
