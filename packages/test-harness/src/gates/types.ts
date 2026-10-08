/**
 * W1-10 (#1507) — gate result contract.
 *
 * Every gate **discovers** its input. Input missing → `pending` with the
 * owner issue named, CI stays green. Input present → violations fail.
 */
export type GateStatus = 'pass' | 'fail' | 'pending'

export interface GateResult {
  gate: string
  status: GateStatus
  summary: string
  violations?: string[]
}

export function pending(gate: string, inputPath: string, ownerIssue: string): GateResult {
  return { gate, status: 'pending', summary: `pending (input not present: ${inputPath} from #${ownerIssue})` }
}

export function gateFromViolations(gate: string, violations: string[], okSummary: string): GateResult {
  if (violations.length === 0) return { gate, status: 'pass', summary: okSummary }
  return { gate, status: 'fail', summary: `${violations.length} violation(s)`, violations }
}
