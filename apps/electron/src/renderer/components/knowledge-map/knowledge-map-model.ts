/**
 * knowledge-map-model — pure helpers for the knowledge-map UI: node search,
 * area labels/colors mapped to Rox design tokens, degree/stat aggregation and
 * the stats/truncated text builders. No DOM: helpers return i18n KEYS (plan §4)
 * that the components resolve through `t()`; `formatStatItems` takes that `t`
 * as a callback so counts pluralise without the model importing i18next.
 */

import type { TFunction } from 'i18next'
import type {
  KnowledgeMapNode,
  KnowledgeMapEdge,
  KnowledgeMapStats,
} from '@rox/shared/knowledge/knowledge-map-types'
import { formatBytes } from '@/pages/drive/format'

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
  /**
   * Count for plural-sensitive items (`files`/`links`/`areas`). The component
   * resolves the key through `t(key, { count })` so i18next picks the form.
   */
  count?: number
  /** Pre-formatted value for plain `label: value` items (`bytes`). */
  value?: string
}

/** Translator shape the panel passes: `t(key, { count })` for plural items. */
export type StatTranslator = TFunction

/** Plural-safe count fragments: files, links, areas (plan §4). */
export function buildCountItems(stats: KnowledgeMapStats): StatItem[] {
  return [
    { key: 'knowledgeMap.stats.files', count: stats.files },
    { key: 'knowledgeMap.stats.links', count: stats.links },
    { key: 'knowledgeMap.stats.areas', count: stats.areas },
  ]
}

/**
 * Full stat line: the plural-safe counts followed by the source size as a
 * plain `label: value` item formatted with the Drive byte helper (`Б/КБ/МБ`).
 */
export function buildStatItems(stats: KnowledgeMapStats): StatItem[] {
  return [
    ...buildCountItems(stats),
    { key: 'knowledgeMap.stats.bytes', value: formatBytes(stats.bytes) },
  ]
}

/**
 * Renders stat items through the component's translator — pluralising counts
 * and appending the pre-formatted value for plain items — joined with `·`.
 * Shared by the full panel line and the compact settings card headline.
 */
export function formatStatItems(items: StatItem[], translate: StatTranslator): string {
  return items
    .map((item) =>
      item.count === undefined
        ? `${translate(item.key)}: ${item.value ?? ''}`
        : translate(item.key, { count: item.count }),
    )
    .join(' · ')
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