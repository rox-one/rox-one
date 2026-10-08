/**
 * W1-10 (#1507) — run every gate; the single entry CI calls.
 *
 * Exit code: 0 when every gate passes, warns (report-only) or is pending;
 * 1 when any gate fails. Pending means the sibling input is absent (or,
 * for visual / axe / one-rail, the wave-2 browser driver is); an input
 * that exists but cannot be evaluated fails (see types.ts).
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
import { errorMessage, type GateResult } from './types.ts'

/** A gate that throws is a failure (fail closed), never a crash of the whole run. */
async function guarded(gate: string, run: () => GateResult | Promise<GateResult>): Promise<GateResult> {
  try {
    return await run()
  } catch (error) {
    return { gate, status: 'fail', summary: 'gate threw', violations: [errorMessage(error)] }
  }
}

export async function runAllGates(opts: { repoRoot?: string } = {}): Promise<GateResult[]> {
  const results: GateResult[] = []
  results.push(await guarded('ddl-zod-parity', () => checkDdlZodParity(opts)))
  results.push(await guarded('permission-matrix', () => runPermissionMatrixGate(opts)))
  results.push(await guarded('risk-class', () => checkRiskClassPresence(opts)))
  results.push(await guarded('negative-tests', () => checkNegativeTestPresence(opts)))
  results.push(await guarded('config-paths', () => runConfigPathsGate(opts)))
  results.push(await guarded('visual-snapshots', () => checkVisualGate(opts)))
  results.push(await guarded('axe', () => checkAxeGate(opts)))
  results.push(await guarded('chrome-schema-lint', () => checkChromeLintGate(opts)))
  results.push(await guarded('one-rail-dom', () => checkOneRailGatePending()))
  results.push(await guarded('dock-layout', () => checkDockLayoutGate(opts)))
  results.push(await guarded('agent-panel-privacy', () => checkAgentPrivacyGate(opts)))

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
