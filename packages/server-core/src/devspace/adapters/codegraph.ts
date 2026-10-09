/**
 * codegraph adapter — canonical code-graph provider for Dev Space (ADR-0020 O1).
 *
 * Canonical provider is `CodeGraphContext` (`codegraphcontext==0.6.13`, embedded
 * LadybugDB), already catalogued as builtin-MCP `codegraph`; the ColbyMcHenry
 * `@colbymchenry/codegraph` is explicitly NOT used (default-on watcher + telemetry
 * violate D4/D6). On-demand only, no daemon, no install.
 *
 * ASSUMPTIONs (not pinned by the D4 audit):
 * - probe binary is `codegraphcontext` (the uvx-managed entrypoint on PATH); we do
 *   NOT run `uvx …` during detection, because uvx would fetch the pinned wheel when
 *   absent — that is an install, which the stage must never trigger.
 * - index argv is `codegraphcontext index .` and the normalized JSON export lands at
 *   `<cwd>/.codegraph/graph.json`; the embedded DB itself is not a manifest artifact.
 */
import { join } from 'node:path'
import { devSpaceArtifactDirectory } from '../artifacts.ts'
import type { ToolExecSpec } from './contract.ts'

/** Indexing a large repo legitimately exceeds the 20 s `shell:exec` budget (ADR-0021). */
const CODEGRAPH_TIMEOUT_MS = 5 * 60 * 1000

export const codegraphAdapterSpec: ToolExecSpec = {
  id: 'codegraph',
  providerId: 'codegraph',
  kind: 'code-graph',
  version: '0.6.13',
  probe: { command: 'codegraphcontext', args: ['--version'] },
  run: { command: 'codegraphcontext', args: () => ['index', '.'] },
  env: context => ({
    CGC_RUNTIME_DB_TYPE: 'ladybugdb',
    CGC_RUNTIME_DB_PATH: join(devSpaceArtifactDirectory(context.root, context.projectSlug, 'code-graph'), 'graph-db'),
    CGC_EMBEDDED_BUFFER_POOL_MB: '256',
  }),
  timeoutMs: CODEGRAPH_TIMEOUT_MS,
  outputs: [{ source: '.codegraph/graph.json', name: 'graph.json', format: 'json' }],
}