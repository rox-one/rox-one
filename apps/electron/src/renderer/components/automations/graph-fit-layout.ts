import { getEventDisplayName, type AutomationTrigger } from './types'

export const NODE_WIDTH = 208
export const NODE_HEIGHT = 64
export const NODE_GAP = 16

const CLUSTER_TOLERANCE = 24

export type GraphFitNode = {
  id: string
  position: { x: number; y: number }
}

export type FittedGraphNode = {
  id: string
  x: number
  y: number
  width: number
}

export type GraphLabelNode = {
  kind: string
  label?: string
  data?: {
    event?: string
    prompt?: string
    text?: string
  }
}

function clusterSorted(values: number[]): number[][] {
  const unique = [...new Set(values)].sort((a, b) => a - b)
  const clusters: number[][] = []
  for (const value of unique) {
    const last = clusters[clusters.length - 1]
    if (last && value - last[last.length - 1]! <= CLUSTER_TOLERANCE) {
      last.push(value)
    } else {
      clusters.push([value])
    }
  }
  return clusters
}

function indexByValue(clusters: number[][]): Map<number, number> {
  const index = new Map<number, number>()
  for (let i = 0; i < clusters.length; i++) {
    for (const value of clusters[i]!) {
      index.set(value, i)
    }
  }
  return index
}

export function fitGraphLayout(
  nodes: GraphFitNode[],
  viewportWidth: number,
): FittedGraphNode[] {
  if (nodes.length === 0) return []

  const colClusters = clusterSorted(nodes.map((node) => node.position.x))
  const rowClusters = clusterSorted(nodes.map((node) => node.position.y))
  const colIndex = indexByValue(colClusters)
  const rowIndex = indexByValue(rowClusters)
  const colCount = Math.max(1, colClusters.length)
  const inner = Math.max(160, viewportWidth - 24)
  const gaps = NODE_GAP * (colCount - 1)
  const computed = Math.floor((inner - gaps) / colCount)
  const nodeWidth = Math.min(NODE_WIDTH, Math.max(168, computed))

  return nodes.map((node) => {
    const column = colIndex.get(node.position.x) ?? 0
    const row = rowIndex.get(node.position.y) ?? 0
    return {
      id: node.id,
      x: column * (nodeWidth + NODE_GAP),
      y: row * (NODE_HEIGHT + NODE_GAP),
      width: nodeWidth,
    }
  })
}

export function nodeDisplayLabel(
  node: GraphLabelNode,
  kindLabels: Record<string, string | undefined>,
): string {
  if (node.kind === 'trigger' && node.data?.event) {
    return getEventDisplayName(node.data.event as AutomationTrigger)
  }

  const trimmedLabel = node.label?.trim()
  if (trimmedLabel) return trimmedLabel

  const raw = node.data?.prompt ?? node.data?.text ?? ''
  const firstLine = raw.split(/\r?\n/, 1)[0]?.trim() ?? ''
  if (firstLine) return firstLine.slice(0, 48)

  return kindLabels[node.kind] ?? ''
}
