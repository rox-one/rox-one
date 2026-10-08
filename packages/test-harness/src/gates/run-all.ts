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
import { runMicroBenchmarks, type MicroBenchResult } from '../bench.ts'
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

  results.push(await guarded('perf-microbench', () => perfGate(runMicroBenchmarks())))

  return results
}

/**
 * Wall-clock budgets on shared runners are noisy: over-budget medians are
 * report-only (`warn`) unless ROX_BENCH_STRICT=1, which makes them fail.
 */
export function perfGate(bench: MicroBenchResult[], env: Record<string, string | undefined> = process.env): GateResult {
  const gate = 'perf-microbench'
  const strict = env.ROX_BENCH_STRICT === '1'
  const over = bench.filter((b) => !b.pass)
  const line = bench.map((b) => `${b.name}=${b.measuredMs.toFixed(2)}ms/<${b.budgetMs}ms`).join(' ')
  if (over.length === 0) return { gate, status: 'pass', summary: `median of ${bench[0]?.samplesMs.length ?? 0}: ${line}` }
  return {
    gate,
    status: strict ? 'fail' : 'warn',
    summary: `${over.length} budget(s) exceeded${strict ? '' : ' (report-only; ROX_BENCH_STRICT=1 to enforce)'}: ${line}`,
    violations: over.map((b) => `${b.name}: median ${b.measuredMs.toFixed(2)}ms exceeds ${b.budgetMs}ms`),
  }
}

export function gatesExitCode(results: GateResult[]): number {
  return results.some((r) => r.status === 'fail') ? 1 : 0
}

export function formatGateResults(results: GateResult[]): string {
  return results.map((r) => `[${r.status.toUpperCase()}] ${r.gate}: ${r.summary}`).join('\n')
}
