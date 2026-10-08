/**
 * W1-10 (#1507) — run every gate; the single entry CI calls.
 *
 * Exit code: 0 when every gate passes or is pending (missing sibling
 * input); 1 when any gate fails on a real violation. Pending never fails.
 */
import { checkDdlZodParity } from './ddl-parity.ts'
import { runPermissionMatrixGate } from './permission-matrix.ts'
import { checkRiskClassPresence } from './risk-class.ts'
import { checkNegativeTestPresence } from './negative-tests.ts'
import { runConfigPathsGate } from './config-paths.ts'
import { checkVisualGate, checkAxeGate } from './visual-axe.ts'
import { checkChromeLintGate, checkOneRailGatePending, checkDockLayoutGate } from './chrome-dock.ts'
import { checkAgentPrivacyGate } from './agent-privacy.ts'
import { runMicroBenchmarks } from '../bench.ts'
import type { GateResult } from './types.ts'

export async function runAllGates(opts: { repoRoot?: string } = {}): Promise<GateResult[]> {
  const results: GateResult[] = []
  results.push(checkDdlZodParity(opts))
  results.push(await runPermissionMatrixGate(opts))
  results.push(checkRiskClassPresence(opts))
  results.push(checkNegativeTestPresence(opts))
  results.push(await runConfigPathsGate(opts))
  results.push(checkVisualGate(opts))
  results.push(await checkAxeGate(opts))
  results.push(checkChromeLintGate(opts))
  results.push(checkOneRailGatePending())
  results.push(await checkDockLayoutGate(opts))
  results.push(await checkAgentPrivacyGate(opts))

  const bench = runMicroBenchmarks()
  const benchFail = bench.filter((b) => !b.pass)
  results.push({
    gate: 'perf-microbench',
    status: benchFail.length === 0 ? 'pass' : 'fail',
    summary:
      benchFail.length === 0
        ? bench.map((b) => `${b.name}=${b.measuredMs.toFixed(2)}ms/<${b.budgetMs}ms`).join(' ')
        : `${benchFail.length} budget(s) exceeded`,
    violations: benchFail.map((b) => `${b.name}: ${b.measuredMs.toFixed(2)}ms exceeds ${b.budgetMs}ms`),
  })

  return results
}

export function gatesExitCode(results: GateResult[]): number {
  return results.some((r) => r.status === 'fail') ? 1 : 0
}

export function formatGateResults(results: GateResult[]): string {
  return results.map((r) => `[${r.status.toUpperCase()}] ${r.gate}: ${r.summary}`).join('\n')
}
