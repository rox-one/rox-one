/**
 * W1-10 (#1507) — config-path grep gate runner (W1-13 input).
 *
 * Wraps `scripts/check-config-paths.ts` (owned by #1510 — **this package
 * must not author it**). Script missing → pending. Present → executed via
 * `bun` and its exit code decides pass/fail.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { pending, type GateResult } from './types.ts'

export const CONFIG_PATHS_SCRIPT = join('scripts', 'check-config-paths.ts')

export async function runConfigPathsGate(opts: { repoRoot?: string } = {}): Promise<GateResult> {
  const gate = 'config-paths'
  const root = opts.repoRoot ?? join(import.meta.dir, '..', '..', '..', '..')
  const script = join(root, CONFIG_PATHS_SCRIPT)
  if (!existsSync(script)) return pending(gate, CONFIG_PATHS_SCRIPT, '1510')

  const proc = Bun.spawnSync(['bun', script], { cwd: root, stdout: 'pipe', stderr: 'pipe' })
  const output = `${proc.stdout?.toString() ?? ''}${proc.stderr?.toString() ?? ''}`.trim()
  if (proc.exitCode === 0) {
    return { gate, status: 'pass', summary: output.slice(0, 300) || 'config-path grep gate green' }
  }
  return {
    gate,
    status: 'fail',
    summary: 'config-path grep gate failed',
    violations: output.split('\n').filter(Boolean).slice(0, 20),
  }
}
