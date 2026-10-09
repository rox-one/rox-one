/**
 * W1-10 (#1507) — gate result contract.
 *
 * Input policy (owner decision, #1507 review 1):
 * - `pending` ONLY while the gate's sibling input is absent (the file /
 *   directory the owner issue will add does not exist yet). CI stays green
 *   and the summary names the input and its owner issue.
 * - Input present → the gate MUST evaluate it. If it cannot (import throws,
 *   expected export missing, wrong shape, nothing parseable), the gate
 *   FAILS with a message saying what it expected: fail closed, never a
 *   silent pending.
 * - Exception: the visual, axe and one-rail DOM gates need rendered screens
 *   from the wave-2 browser driver. They stay `pending` while its capture
 *   artifacts (`../capture.ts`) are absent, and say how to produce them (see
 *   `pendingUntilBrowserDriver`).
 * - `warn` is report-only (e.g. perf micro-benchmarks on PRs) and never
 *   changes the exit code.
 */
export type GateStatus = 'pass' | 'fail' | 'pending' | 'warn'

export interface GateResult {
  gate: string
  status: GateStatus
  summary: string
  violations?: string[]
}

export function pending(gate: string, inputPath: string, ownerIssue: string): GateResult {
  return { gate, status: 'pending', summary: `pending (input not present: ${inputPath} from #${ownerIssue})` }
}

export const BROWSER_DRIVER_NOTE =
  'no capture artifacts yet: run `bun run visual:capture` (the wave-2 browser driver) to produce them, and `bun run visual:capture --update-baselines` to (re)record the committed visual baselines (packages/test-harness/README.md)'

export function pendingUntilBrowserDriver(gate: string, what: string): GateResult {
  return { gate, status: 'pending', summary: `${BROWSER_DRIVER_NOTE}; needs ${what}` }
}

/** The sibling input exists but cannot be wired / evaluated → fail closed. */
export function inputBroken(gate: string, inputPath: string, problem: string): GateResult {
  return {
    gate,
    status: 'fail',
    summary: `input present but not evaluable: ${inputPath}`,
    violations: [`${inputPath}: ${problem}`],
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function gateFromViolations(gate: string, violations: string[], okSummary: string): GateResult {
  if (violations.length === 0) return { gate, status: 'pass', summary: okSummary }
  return { gate, status: 'fail', summary: `${violations.length} violation(s)`, violations }
}
