/**
 * W1-10 (#1507) — agent-panel privacy gate (TECH-SPEC §18.3 negatives).
 *
 * Discovers the W1-15 auto-attach implementation
 * (`packages/core/src/agent-panel/context.ts`, owner #1512); missing →
 * pending with the shipped privacy fixtures listed. An explicit provider
 * can be injected for self-tests: `decideAttach(ref)` returns
 * `{ attach, redacted }` per candidate.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { pending, gateFromViolations, type GateResult } from './types.ts'
import { PRIVACY_EXPECTATIONS } from '../fixtures/privacy.ts'

const AGENT_CONTEXT_PATH = join('packages', 'core', 'src', 'agent-panel', 'context.ts')

export interface AttachDecision {
  attach: boolean
  redacted: boolean
}

export function checkAgentPrivacy(
  decideAttach: (ref: string) => AttachDecision,
): GateResult {
  const violations: string[] = []
  for (const exp of PRIVACY_EXPECTATIONS) {
    const got = decideAttach(exp.ref)
    if (got.attach !== exp.autoAttach) {
      violations.push(`${exp.ref}: attach=${got.attach}, want ${exp.autoAttach}`)
    }
    if (got.redacted !== exp.redacted) {
      violations.push(`${exp.ref}: redacted=${got.redacted}, want ${exp.redacted}`)
    }
  }
  return gateFromViolations(violations.length === 0 ? 'agent-panel-privacy' : 'agent-panel-privacy', violations, 'privacy negatives hold')
}

export async function checkAgentPrivacyGate(opts: {
  repoRoot?: string
  decideAttach?: (ref: string) => AttachDecision
} = {}): Promise<GateResult> {
  const gate = 'agent-panel-privacy'
  if (opts.decideAttach) return checkAgentPrivacy(opts.decideAttach)
  const root = opts.repoRoot ?? join(import.meta.dir, '..', '..', '..', '..')
  if (!existsSync(join(root, AGENT_CONTEXT_PATH))) return pending(gate, AGENT_CONTEXT_PATH, '1512')
  return { gate, status: 'pending', summary: 'pending (agent-panel context provider present but not wired to the gate yet)' }
}
