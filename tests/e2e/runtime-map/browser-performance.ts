/** Browser measurements on explicit test load, using the production ingress and cards. */
import type { createStore } from 'jotai/vanilla'
import type { RuntimeEvent } from '../../../packages/core/src/runtime-trace/types'
import { known } from '../../../packages/core/src/runtime-trace/types'
import { buildRuntimeGraph } from '../../../packages/core/src/runtime-trace/projector'
import { ingressRuntimeTraceEvent } from '../../../apps/electron/src/renderer/event-processor/runtime-trace-ingress'
import { runtimeTraceScopeKey, runtimeTraceSessionAtomFamily } from '../../../apps/electron/src/renderer/atoms/runtime-trace'
import { createRuntimePerformanceFixture } from '../../fixtures/runtime-map/performance'

type Store = ReturnType<typeof createStore>
const paint = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))

export function createBrowserPerformanceHarness(store: Store, scope: { workspaceId: string; sessionId: string }) {
  let events: RuntimeEvent[] = []
  let seq = 0
  let frameId = 0
  let frameTimes: number[] = []
  return {
    async load() {
      events = createRuntimePerformanceFixture().map(event => ({ ...event, workspaceId: scope.workspaceId, sessionId: scope.sessionId,
        rootSessionId: scope.sessionId, runId: event.agentId === 'load-agent-0' ? event.rootRunId : event.runId }))
      const start = performance.now()
      for (const event of events) ingressRuntimeTraceEvent(store, event, scope.workspaceId)
      seq = events.length
      const ingressMs = performance.now() - start
      await paint()
      const projection = store.get(runtimeTraceSessionAtomFamily(runtimeTraceScopeKey(scope))).projections['load-run']!
      const graph = buildRuntimeGraph(projection)
      return { fixtureEvents: events.length, projectedNodes: graph.nodes.length, agents: graph.lanes.length, ingressMs,
        mountedCards: document.querySelectorAll('[data-testid="runtime-node"]').length }
    },
    async measureVisibleUpdate() {
      const card = [...document.querySelectorAll<HTMLElement>('.runtime-node-tool')].find(item => {
        const rect = item.getBoundingClientRect()
        return rect.right > 0 && rect.left < innerWidth && rect.bottom > 0 && rect.top < innerHeight
      })
      if (!card) throw new Error('No visible production tool card to measure')
      const identity = card.dataset.runtimeId!
      const startEvent = events.find(event => event.kind === 'tool.started' && identity.includes(`"${event.spanId}"`))
      if (!startEvent || startEvent.kind !== 'tool.started') throw new Error('Visible card has no source span')
      const marker = `Paint measurement ${++seq}`
      const event: RuntimeEvent = { ...startEvent, eventId: `paint-${seq}`, sourceEventId: `paint-${seq}`, seq, sourceSeq: seq,
        kind: 'tool.completed', payload: { name: startEvent.payload.name, result: { text: marker }, status: 'succeeded' },
        occurredAt: known(Date.now(), 'performance-fixture'), receivedAt: Date.now() }
      const start = performance.now()
      return await new Promise<number>((resolve, reject) => {
        const timeout = setTimeout(() => { observer.disconnect(); reject(new Error('Visible card did not render the runtime delta')) }, 3_000)
        const observer = new MutationObserver(() => {
          const updatedCard = [...document.querySelectorAll<HTMLElement>('.runtime-node-tool')].find(item => item.dataset.runtimeId === identity)
          if (!updatedCard?.textContent?.includes(marker)) return
          observer.disconnect()
          requestAnimationFrame(() => { clearTimeout(timeout); resolve(performance.now() - start) })
        })
        observer.observe(document.querySelector('[data-testid="runtime-map-dock"]')!, { childList: true, subtree: true, characterData: true })
        ingressRuntimeTraceEvent(store, event, scope.workspaceId)
      })
    },
    startFrameMeasurement() {
      cancelAnimationFrame(frameId)
      frameTimes = []
      let previous: number | undefined
      const frame = (now: number) => { if (previous !== undefined) frameTimes.push(now - previous); previous = now; frameId = requestAnimationFrame(frame) }
      frameId = requestAnimationFrame(frame)
    },
    stopFrameMeasurement() { cancelAnimationFrame(frameId); return frameTimes },
  }
}
