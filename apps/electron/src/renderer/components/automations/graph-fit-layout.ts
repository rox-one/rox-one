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
    expression?: string
    /** Matcher node fields (AutomationInfoPage / AutomationGraphMatcherData). */
    name?: string
    matcher?: string
    cron?: string
    /** Webhook action fields. */
    url?: string
    method?: string
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

function firstLine(raw: string | undefined, max = 48): string {
  const line = raw?.split(/\r?\n/, 1)[0]?.trim() ?? ''
  return line ? line.slice(0, max) : ''
}

function compactWebhookUrl(url: string): string {
  const trimmed = url.trim()
  if (!trimmed) return ''
  try {
    const parsed = new URL(trimmed)
    const path = parsed.pathname === '/' ? '' : parsed.pathname
    const hostPath = `${parsed.host}${path}`
    return hostPath.length > 48 ? `${hostPath.slice(0, 45)}…` : hostPath
  } catch {
    return firstLine(trimmed)
  }
}

/**
 * Prefer real automation fields (event / matcher / cron / webhook / prompt)
 * over empty kind chrome so graph nodes stay informative.
 */
export function nodeDisplayLabel(
  node: GraphLabelNode,
  kindLabels: Record<string, string | undefined>,
): string {
  if (node.kind === 'trigger' && node.data?.event) {
    return getEventDisplayName(node.data.event as AutomationTrigger)
  }

  const trimmedLabel = node.label?.trim()
  if (trimmedLabel) return trimmedLabel

  if (node.kind === 'matcher') {
    const name = node.data?.name?.trim()
    if (name) return name
    const matcher = node.data?.matcher?.trim()
    if (matcher) return matcher
    const cron = node.data?.cron?.trim()
    if (cron) return cron
  }

  if (node.kind === 'webhook') {
    const url = node.data?.url ? compactWebhookUrl(node.data.url) : ''
    if (url) {
      const method = node.data?.method?.trim().toUpperCase()
      return method ? `${method} ${url}` : url
    }
  }

  const fromPromptOrText = firstLine(node.data?.prompt ?? node.data?.text)
  if (fromPromptOrText) return fromPromptOrText

  if (node.kind === 'decision') {
    const expression = firstLine(node.data?.expression)
    if (expression) return expression
  }

  return kindLabels[node.kind] ?? ''
}
