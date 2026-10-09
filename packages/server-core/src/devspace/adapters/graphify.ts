/**
 * graphify adapter — repository knowledge graph (03-SPEC-features §2.5).
 *
 * `Graphify-Labs/graphify` (`v0.9.82`, Apache-2.0) is a local tree-sitter graph
 * with no vector store and no LLM in the AST path. The invocation and output
 * layout are taken from the vendored `gstack` adapter (verified against graphify
 * 0.9.23): `graphify update <dir>` writes `<dir>/graphify-out/{graph.json,
 * graph.html,GRAPH_REPORT.md}` with all node origins `ast`.
 *
 * `graph.html` is intentionally not published: the manifest format set is
 * `md|json|svg|mp3|srt` and HTML is not a supported artifact format (§7.2).
 */
import type { ToolExecSpec } from './contract.ts'

/** Indexing may take minutes; matches the vendored gstack adapter budget (ADR-0021). */
const GRAPHIFY_TIMEOUT_MS = 2 * 60 * 1000

export const graphifyAdapterSpec: ToolExecSpec = {
  id: 'graphify',
  providerId: 'graphify',
  kind: 'knowledge-graph',
  version: '0.9.82',
  probe: { command: 'graphify', args: ['--version'] },
  run: { command: 'graphify', args: () => ['update', '.'] },
  timeoutMs: GRAPHIFY_TIMEOUT_MS,
  outputs: [
    { source: 'graphify-out/graph.json', name: 'graph.json', format: 'json' },
    { source: 'graphify-out/GRAPH_REPORT.md', name: 'GRAPH_REPORT.md', format: 'md' },
  ],
}