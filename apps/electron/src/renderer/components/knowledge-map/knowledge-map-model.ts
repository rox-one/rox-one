/**
 * knowledge-map-model — pure helpers for the knowledge-map UI: node search,
 * area labels/colors mapped to Rox design tokens, degree/stat aggregation and
 * the stats/truncated text builders. No DOM, no i18n coupling — helpers return
 * i18n KEYS (plan §4) that the components resolve through `t()`.
 */

import type {
  KnowledgeMapNode,
  KnowledgeMapEdge,
  KnowledgeMapStats,
} from '@rox/shared/knowledge/knowledge-map-types'

export type KnowledgeMapAreaKey = KnowledgeMapNode['area']

/** i18n keys for the three areas + the root/other bucket (plan §4). */
export const AREA_LABEL_KEYS: Record<KnowledgeMapAreaKey, string> = {
  context: 'knowledgeMap.area.context',
  memory: 'knowledgeMap.area.memory',
  notes: 'knowledgeMap.area.notes',
  root: 'knowledgeMap.area.other',
}

/**
 * Area colours as Rox design tokens. `--c1`…`--c6` are not defined by the
 * shipped theme, so the distinct semantic tokens below are used instead.
 */
export const AREA_COLORS: Record<KnowledgeMapAreaKey, string> = {
  context: 'var(--accent)',
  memory: 'var(--success)',
  notes: 'var(--info)',
  root: 'var(--foreground)',
}

/** Stable legend order. */
export const AREA_ORDER: KnowledgeMapAreaKey[] = ['context', 'memory', 'notes']

/** Case-insensitive match over label, relative path and node id. */
export function nodeMatchesQuery(node: KnowledgeMapNode, query: string): boolean {
  const needle = query.trim().toLowerCase()
  if (!needle) return true
  return (
    node.label.toLowerCase().includes(needle) ||
    node.id.toLowerCase().includes(needle) ||
    (node.relPath?.toLowerCase().includes(needle) ?? false)
  )
}

export interface FilteredGraph {
  nodes: KnowledgeMapNode[]
  edges: KnowledgeMapEdge[]
}

/**
 * Filter documents by query, keeping the group nodes (root/area) so the tree
 * and graph stay connected; edges survive only when both endpoints remain.
 */
export function filterGraph(
  nodes: KnowledgeMapNode[],
  edges: KnowledgeMapEdge[],
  query: string,
): FilteredGraph {
  const needle = query.trim()
  if (!needle) return { nodes, edges }
  const shown = nodes.filter(
    (node) => node.kind !== 'doc' || nodeMatchesQuery(node, needle),
  )
  const ids = new Set(shown.map((node) => node.id))
  return { nodes: shown, edges: edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target)) }
}

/** Degree (undirected edge count) for a node id. */
export function degreeOf(nodeId: string, edges: KnowledgeMapEdge[]): number {
  let degree = 0
  for (const edge of edges) {
    if (edge.source === nodeId || edge.target === nodeId) degree += 1
  }
  return degree
}

export interface StatItem {
  /** i18n key from plan §4. */
  key: string
  value: string
}

/** One stat line item per format-count token, formatted with a locale. */
export function buildStatItems(stats: KnowledgeMapStats, locale: string): StatItem[] {
  return [
    { key: 'knowledgeMap.stats.files', value: formatCount(stats.files, locale) },
    { key: 'knowledgeMap.stats.links', value: formatCount(stats.links, locale) },
    { key: 'knowledgeMap.stats.areas', value: formatCount(stats.areas, locale) },
    { key: 'knowledgeMap.stats.bytes', value: formatCount(stats.bytes, locale) },
  ]
}

export interface TruncatedSummary {
  /** i18n key from plan §4. */
  key: 'knowledgeMap.truncated'
  /** Documents present in the map. */
  shown: number
  /** Documents discovered before the caps were applied (`stats.total`). */
  total: number
}

/**
 * Summary shown when the corpus hit a scan limit. `null` when nothing was
 * truncated. `total` is the DTO's pre-limit discovered count, so "N of M" is
 * exact and does not fold unreadable/oversized files into the denominator.
 */
export function truncatedSummary(stats: KnowledgeMapStats): TruncatedSummary | null {
  if (!stats.truncated) return null
  return { key: 'knowledgeMap.truncated', shown: stats.files, total: stats.total }
}

export interface TreeArea {
  area: KnowledgeMapAreaKey
  labelKey: string
  color: string
  nodes: KnowledgeMapNode[]
}

/** Group documents by area (stable order, empty areas dropped). */
export function buildTree(nodes: KnowledgeMapNode[]): TreeArea[] {
  const docs = nodes.filter((node) => node.kind === 'doc')
  const groups: TreeArea[] = []
  for (const area of AREA_ORDER) {
    const areaDocs = docs
      .filter((node) => node.area === area)
      .sort((a, b) => a.label.localeCompare(b.label))
    if (areaDocs.length === 0) continue
    groups.push({ area, labelKey: AREA_LABEL_KEYS[area], color: AREA_COLORS[area], nodes: areaDocs })
  }
  const otherDocs = docs
    .filter((node) => node.area !== 'context' && node.area !== 'memory' && node.area !== 'notes')
    .sort((a, b) => a.label.localeCompare(b.label))
  if (otherDocs.length > 0) {
    groups.push({
      area: 'root',
      labelKey: AREA_LABEL_KEYS.root,
      color: AREA_COLORS.root,
      nodes: otherDocs,
    })
  }
  return groups
}

/** Grouped integer formatting; falls back to the raw value on bad locales. */
export function formatCount(value: number, locale: string): string {
  try {
    return new Intl.NumberFormat(locale).format(value)
  } catch {
    return String(value)
  }
}