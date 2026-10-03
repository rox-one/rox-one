import type { RuntimeGraph, RuntimeNode } from '@rox/core/runtime-trace'

export const CARD_WIDTH = 268
export const COLUMN_WIDTH = 302
export const LANE_HEIGHT = 218
export type TimelineMode = 'compact' | 'time'
export interface RuntimePosition { x: number; y: number }
export interface RuntimeLayout { positions: Map<string, RuntimePosition>; lanes: Map<string, RuntimePosition>; topologyVersion: number; comparableTime: boolean }

/** Text/status changes deliberately do not participate in topology or position. */
export function layoutRuntimeGraph(graph: RuntimeGraph, mode: TimelineMode = 'compact'): RuntimeLayout {
  const positions = new Map<string, RuntimePosition>()
  const lanes = new Map<string, RuntimePosition>()
  const sorted = [...graph.nodes].sort((a, b) => a.seq - b.seq || a.id.localeCompare(b.id))
  const order = new Map(sorted.map((node, index) => [node.id, index]))
  const knownTimes = sorted.filter(node => node.startedAt.state === 'known')
  const domains = new Set(knownTimes.map(node => node.event.clockDomain))
  const comparableTime = knownTimes.length === sorted.length && domains.size <= 1
  const start = knownTimes.length ? Math.min(...knownTimes.map(node => node.startedAt.state === 'known' ? node.startedAt.value : Infinity)) : 0
  let y = 44
  for (const lane of graph.lanes) {
    lanes.set(lane.id, { x: -292 + lane.depth * 14, y })
    const members = sorted.filter(node => node.agentId === lane.agentId)
    // Concurrent spans stack within the lane in true-time mode rather than moving time.
    const rowEnds: number[] = []
    let rows = 1
    for (const node of members) {
      const x = mode === 'time' && comparableTime && node.startedAt.state === 'known'
        ? Math.max(0, (node.startedAt.value - start) / 1000 * 90)
        : (order.get(node.id) ?? 0) * COLUMN_WIDTH
      let row = 0
      if (mode === 'time' && comparableTime) {
        while (rowEnds[row] !== undefined && rowEnds[row]! > x) row++
        rowEnds[row] = x + COLUMN_WIDTH
        rows = Math.max(rows, row + 1)
      }
      positions.set(node.id, { x, y: y + row * LANE_HEIGHT })
    }
    y += rows * LANE_HEIGHT + 34
  }
  return { positions, lanes, topologyVersion: graph.topologyVersion, comparableTime }
}

export function nodeMatches(node: RuntimeNode, query: string, filter: string): boolean {
  if (filter === 'errors' && node.status !== 'failed' && node.status !== 'interrupted') return false
  if (filter === 'waiting' && node.status !== 'waiting-approval' && node.status !== 'queued' && node.kind !== 'approval') return false
  if (filter !== 'all' && filter !== 'errors' && filter !== 'waiting' && node.kind !== filter) return false
  if (!query.trim()) return true
  const payload = JSON.stringify(node.event.payload)
  return `${node.kind} ${node.agentId} ${payload}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
}

/** Render a bounded window; callers can navigate every window without dropping history. */
export function windowRuntimeNodes(nodes: RuntimeNode[], page: number, size = 200): RuntimeNode[] {
  const start = Math.max(0, Math.floor(page)) * size
  return nodes.slice(start, start + size)
}
