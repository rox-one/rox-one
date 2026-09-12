import type { CodeGraph } from './types.ts'

export interface ExplainerNode {
  id: string
  label: string
  kind: string
  path: string
  startLine: number
  commit: string
  citation: string
}

export function explainWithProvenance(graph: CodeGraph): ExplainerNode[] {
  return graph.symbols.map((symbol) => ({
    id: symbol.id,
    label: symbol.name,
    kind: symbol.kind,
    path: symbol.path,
    startLine: symbol.startLine,
    commit: symbol.commit,
    citation: `${symbol.path}:${symbol.startLine}@${symbol.commit}`,
  }))
}

export function materializeArchitectureNote(graph: CodeGraph): {
  markdown: string
  canvasNodes: ExplainerNode[]
} {
  const nodes = explainWithProvenance(graph)
  const lines = ['# Architecture', '', '## Symbols', '']
  for (const node of nodes) {
    lines.push(`- [${node.label}](${node.citation}) \`${node.kind}\``)
  }
  return { markdown: lines.join('\n'), canvasNodes: nodes }
}

export function assertEveryNodeHasProvenance(graph: CodeGraph): void {
  for (const symbol of graph.symbols) {
    if (!symbol.path || symbol.startLine < 1 || !symbol.commit) {
      throw new Error(`symbol ${symbol.id} missing source provenance`)
    }
  }
  const cited = new Set(graph.citations.map((c) => c.symbolId))
  for (const symbol of graph.symbols) {
    if (!cited.has(symbol.id)) {
      throw new Error(`symbol ${symbol.id} missing citation`)
    }
  }
}
