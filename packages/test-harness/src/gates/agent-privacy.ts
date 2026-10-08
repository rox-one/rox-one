/**
 * W1-10 (#1507) — agent-panel privacy gate (TECH-SPEC §18.3 negatives).
 *
 * Discovers the W1-15 auto-attach implementation
 * (`packages/core/src/agent-panel/context.ts`, owner #1512). Missing →
 * pending. Present → it must export `decideAttach` | `decideAutoAttach` |
 * `autoAttachDecision` `(ref: string) => { attach: boolean; redacted: boolean }`,
 * which is run over the shipped §18.3 fixtures. An import error, a missing
 * export, a throw or a wrong return shape FAILS the gate (fail closed). An
 * explicit provider can be injected for self-tests.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { pending, inputBroken, errorMessage, gateFromViolations, type GateResult } from './types.ts'
import { PRIVACY_EXPECTATIONS } from '../fixtures/privacy.ts'

export const AGENT_CONTEXT_PATH = join('packages', 'core', 'src', 'agent-panel', 'context.ts')
export const AGENT_PRIVACY_EXPORTS = ['decideAttach', 'decideAutoAttach', 'autoAttachDecision'] as const

export interface AttachDecision {
  attach: boolean
  redacted: boolean
}

export function checkAgentPrivacy(decideAttach: (ref: string) => AttachDecision): GateResult {
  const gate = 'agent-panel-privacy'
  const violations: string[] = []
  for (const exp of PRIVACY_EXPECTATIONS) {
    let got: AttachDecision
    try {
      got = decideAttach(exp.ref)
    } catch (error) {
      violations.push(`${exp.ref}: decideAttach threw ${errorMessage(error)}`)
      continue
    }
    if (!got || typeof got.attach !== 'boolean' || typeof got.redacted !== 'boolean') {
      violations.push(`${exp.ref}: expected { attach: boolean, redacted: boolean }, got ${JSON.stringify(got)}`)
      continue
    }
    if (got.attach !== exp.autoAttach) violations.push(`${exp.ref}: attach=${got.attach}, want ${exp.autoAttach}`)
    if (got.redacted !== exp.redacted) violations.push(`${exp.ref}: redacted=${got.redacted}, want ${exp.redacted}`)
  }
  return gateFromViolations(gate, violations, 'privacy negatives hold')
}

export async function checkAgentPrivacyGate(opts: {
  repoRoot?: string
  decideAttach?: (ref: string) => AttachDecision
} = {}): Promise<GateResult> {
  const gate = 'agent-panel-privacy'
  if (opts.decideAttach) return checkAgentPrivacy(opts.decideAttach)
  const modPath = join(opts.repoRoot ?? join(import.meta.dir, '..', '..', '..', '..'), AGENT_CONTEXT_PATH)
  if (!existsSync(modPath)) return pending(gate, AGENT_CONTEXT_PATH, '1512')
  let mod: Record<string, unknown>
  try {
    mod = (await import(modPath)) as Record<string, unknown>
  } catch (error) {
    return inputBroken(gate, AGENT_CONTEXT_PATH, `import failed: ${errorMessage(error)}`)
  }
  const key = AGENT_PRIVACY_EXPORTS.find((k) => typeof mod[k] === 'function')
  if (!key) return inputBroken(gate, AGENT_CONTEXT_PATH, `exports none of ${AGENT_PRIVACY_EXPORTS.join(', ')}`)
  return checkAgentPrivacy(mod[key] as (ref: string) => AttachDecision)
}
