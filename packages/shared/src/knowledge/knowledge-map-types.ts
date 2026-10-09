/**
 * Knowledge Map DTOs — produced by the server-core builder
 * (`packages/server-core/src/knowledge/knowledge-map.ts`) and rendered by the
 * Electron renderer knowledge-map components. Browser-safe: types only.
 */

export type KnowledgeMapArea = 'context' | 'memory' | 'notes'

export interface KnowledgeMapNode {
  id: string
  label: string
  area: KnowledgeMapArea | 'root'
  kind: 'doc' | 'area' | 'root'
  size: number
  linkCount: number
  relPath: string | null
}

export interface KnowledgeMapEdge {
  source: string
  target: string
  kind: 'link' | 'member'
}

export interface KnowledgeMapStats {
  files: number
  /**
   * Documents discovered before any cap was applied (equals `files` plus the
   * documents dropped by the notes doc-count cap and the memory-history limit).
   * Always `>= files`; the honest denominator for "Показаны N из M".
   */
  total: number
  links: number
  areas: number
  bytes: number
  truncated: boolean
  skipped: number
}

export interface KnowledgeMapDto {
  generatedAt: string
  rootLabel: string
  nodes: KnowledgeMapNode[]
  edges: KnowledgeMapEdge[]
  stats: KnowledgeMapStats
}