export type SymbolKind = 'file' | 'function' | 'class' | 'type'

export interface CodeSymbol {
  id: string
  name: string
  kind: SymbolKind
  path: string
  startLine: number
  commit: string
}

export interface CodeEdge {
  from: string
  to: string
  kind: 'contains' | 'imports'
}

export interface CodeCitation {
  symbolId: string
  path: string
  startLine: number
  commit: string
}

export interface CodeGraph {
  symbols: CodeSymbol[]
  edges: CodeEdge[]
  citations: CodeCitation[]
  summaries: Record<string, string>
}

export interface SourceFile {
  path: string
  content: string
  commit: string
}

export interface CodeIntelAdapter {
  id: string
  alwaysOn: false
  index(files: readonly SourceFile[]): CodeGraph
}

export interface CapabilityPack {
  id: string
  alwaysOn: false
  agentDiscoverable: true
  tools: readonly string[]
  activateWhen: string
}

export const CODE_INTEL_PACK: CapabilityPack = {
  id: 'code-intelligence',
  alwaysOn: false,
  agentDiscoverable: true,
  tools: ['local-fs-symbols', 'syft-sbom'],
  activateWhen: 'repository-architecture-or-citation-task',
}

export const REJECTED_CODE_INTEL_TOOLS = [
  { name: 'CodeWiki', reason: 'duplicate-wiki-daemon' },
  { name: 'DeepWiki', reason: 'duplicate-wiki-daemon' },
  { name: 'Graphify', reason: 'unmaintained-duplicate-graph' },
  { name: 'Archify', reason: 'unmaintained-duplicate-graph' },
] as const

export const SELECTED_CODE_INTEL = ['local-fs-symbols', 'syft-sbom'] as const
