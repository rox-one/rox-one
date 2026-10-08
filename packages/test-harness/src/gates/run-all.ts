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
import { benchRunsFromEnv, runMicroBenchmarks, type MicroBenchResult } from '../bench.ts'
import { errorMessage, type GateResult } from './types.ts'

/** A gate that throws is a failure (fail closed), never a crash of the whole run. */
async function guarded(gate: string, run: () => GateResult | Promise<GateResult>): Promise<GateResult> {
  try {
    return await run()
  } catch (error) {
    return { gate, status: 'fail', summary: 'gate threw', violations: [errorMessage(error)] }
  }
}

/** Every gate in run order; `only` selects a subset by name. */
export const GATE_NAMES = [
  'ddl-zod-parity',
  'permission-matrix',
  'risk-class',
  'negative-tests',
  'config-paths',
  'visual-snapshots',
  'axe',
  'chrome-schema-lint',
  'one-rail-dom',
  'dock-layout',
  'agent-panel-privacy',
  'perf-microbench',
] as const
export type GateName = (typeof GATE_NAMES)[number]

export async function runAllGates(
  opts: { repoRoot?: string; env?: Record<string, string | undefined>; only?: readonly string[] } = {},
): Promise<GateResult[]> {
  const env = opts.env ?? process.env
  const gateOpts = { repoRoot: opts.repoRoot }
  const unknown = (opts.only ?? []).filter((name) => !(GATE_NAMES as readonly string[]).includes(name))
  if (unknown.length > 0) throw new Error(`unknown gate(s): ${unknown.join(', ')} (known: ${GATE_NAMES.join(', ')})`)
  const runners: Record<GateName, () => GateResult | Promise<GateResult>> = {
    'ddl-zod-parity': () => checkDdlZodParity(gateOpts),
    'permission-matrix': () => runPermissionMatrixGate(gateOpts),
    'risk-class': () => checkRiskClassPresence(gateOpts),
    'negative-tests': () => checkNegativeTestPresence(gateOpts),
    'config-paths': () => runConfigPathsGate(gateOpts),
    'visual-snapshots': () => checkVisualGate(gateOpts),
    axe: () => checkAxeGate(gateOpts),
    'chrome-schema-lint': () => checkChromeLintGate(gateOpts),
    'one-rail-dom': () => checkOneRailGatePending(),
    'dock-layout': () => checkDockLayoutGate(gateOpts),
    'agent-panel-privacy': () => checkAgentPrivacyGate(gateOpts),
    'perf-microbench': () => perfGate(runMicroBenchmarks({ runs: benchRunsFromEnv(env) }), env),
  }
  const results: GateResult[] = []
  for (const name of GATE_NAMES) {
    if (opts.only && !opts.only.includes(name)) continue
    results.push(await guarded(name, runners[name]))
  }
  return results
}

/**
 * Wall-clock budgets on shared runners are noisy: over-budget medians are
 * report-only (`warn`) unless ROX_BENCH_STRICT=1, which makes them fail.
 * Strict mode runs on push to main and nightly (bench-strict.yml) with
 * ROX_BENCH_RUNS=3, i.e. the median of 3 run medians. Every bench is
 * labelled `real` or `synthetic` in the summary (see bench.ts).
 */
export function perfGate(bench: MicroBenchResult[], env: Record<string, string | undefined> = process.env): GateResult {
  const gate = 'perf-microbench'
  if (bench.length === 0) return { gate, status: 'fail', summary: 'no benchmark results', violations: ['perf-microbench ran no benches'] }
  const strict = env.ROX_BENCH_STRICT === '1'
  const over = bench.filter((b) => !b.pass)
  const line = bench.map((b) => `${b.name}[${b.kind}]=${b.measuredMs.toFixed(2)}ms/<${b.budgetMs}ms`).join(' ')
  const first = bench[0]!
  const runs = first.runMediansMs.length
  const perRun = runs > 0 ? first.samplesMs.length / runs : 0
  const synthetic = bench.filter((b) => b.kind === 'synthetic').map((b) => b.name)
  const basis =
    `${runs > 1 ? `median of ${runs} run medians` : 'median'} (${perRun} samples/run)` +
    (synthetic.length > 0 ? `; synthetic (no product code yet): ${synthetic.join(', ')}` : '')
  if (over.length === 0) return { gate, status: 'pass', summary: `${basis}: ${line}` }
  return {
    gate,
    status: strict ? 'fail' : 'warn',
    summary: `${over.length} budget(s) exceeded${strict ? '' : ' (report-only; ROX_BENCH_STRICT=1 to enforce)'}; ${basis}: ${line}`,
    violations: over.map((b) => `${b.name} [${b.kind}]: median ${b.measuredMs.toFixed(2)}ms exceeds ${b.budgetMs}ms`),
  }
}

export function gatesExitCode(results: GateResult[]): number {
  return results.some((r) => r.status === 'fail') ? 1 : 0
}

export function formatGateResults(results: GateResult[]): string {
  return results.map((r) => `[${r.status.toUpperCase()}] ${r.gate}: ${r.summary}`).join('\n')
}
