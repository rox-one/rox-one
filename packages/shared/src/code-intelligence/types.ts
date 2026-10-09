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

/**
 * Code-intelligence tools rejected by the selection revision
 * `CI-DEC-EXTEND-EXISTING-02` (RX-ADR-0020). Graphify and Archify were removed
 * from this list: their `unmaintained-duplicate-graph` reasons were refuted by
 * current upstream activity (graphify `v0.9.82`, archify `v3.0.1`, both pushed
 * 2026-10-09). Their successors are registered as provider adapters, not here.
 */
export const REJECTED_CODE_INTEL_TOOLS = [
  { name: 'CodeWiki', reason: 'duplicate-wiki-daemon' },
  { name: 'DeepWiki', reason: 'duplicate-wiki-daemon' },
] as const

/**
 * Base providers that the pack selects directly and therefore exempts from the
 * `unverified-provider-manifest` requirement. The six Developer Space tools
 * (openwiki, understand-anything, codegraph, archify, graphify, groma) are
 * non-base providers: per RX-ADR-0020 they MUST carry `sourceRevision` and
 * `artifactDigest`, so they are intentionally not listed here.
 */
export const SELECTED_CODE_INTEL = ['local-fs-symbols', 'syft-sbom'] as const
