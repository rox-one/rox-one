/**
 * groma adapter — C4/OKF architecture source (ADR-0020 O2, 03-SPEC-features §2.6).
 *
 * `MrLesk/Groma.md` (`groma.md@0.6.6`) is a deterministic, AI-free generator that
 * commits the C4 model as OKF markdown; it is kept separate from archify because
 * its artifact is a diffable markdown source, not a rendered diagram.
 *
 * ASSUMPTIONs (not pinned by the D4 audit):
 * - the npm bin is `groma` and it answers `groma --version` (confirmed by the
 *   vendored `rox-integrations/groma` skill).
 * - generation argv is `groma generate .`, emitting `groma/architecture.md`.
 */
import type { ToolExecSpec } from './contract.ts'

/** Local, AI-free generation still scans the tree; beyond the `shell:exec` budget. */
const GROMA_TIMEOUT_MS = 2 * 60 * 1000

export const gromaAdapterSpec: ToolExecSpec = {
  id: 'groma',
  providerId: 'groma',
  kind: 'c4',
  version: '0.6.6',
  probe: { command: 'groma', args: ['--version'] },
  run: { command: 'groma', args: () => ['generate', '.'] },
  timeoutMs: GROMA_TIMEOUT_MS,
  outputs: [{ source: 'groma/architecture.md', name: 'architecture.md', format: 'md' }],
}