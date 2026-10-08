/**
 * W1-10 (#1507) — agent-panel privacy gate (TECH-SPEC §18.3 negatives).
 *
 * Discovers the W1-15 auto-attach implementation
 * (`packages/core/src/agent-panel/context.ts`, owner #1512). Missing →
 * pending. Present → it must export `decideAttach` | `decideAutoAttach` |
 * `autoAttachDecision` with the contract
 *
 *   (candidate: PrivacyCandidate, actor: PrivacyActor) => { attach: boolean; redacted: boolean }
 *
 * `candidate` carries every fact the §18.3 decision depends on (ref,
 * entityKind, authority, isFocus, isDm, isOpenDm, canRead), `actor` is the
 * acting user (`{ principalId, workspaceId }`), so an implementation never
 * needs to recognise fixture ids. It is run over the shipped fixtures; an
 * import error, a missing export, a throw or a wrong return shape FAILS
 * the gate (fail closed). An explicit provider can be injected for
 * self-tests.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { pending, inputBroken, errorMessage, gateFromViolations, type GateResult } from './types.ts'
import { PRIVACY_ACTOR, PRIVACY_EXPECTATIONS, PRIVACY_FIXTURES, type PrivacyActor, type PrivacyCandidate } from '../fixtures/privacy.ts'

export const AGENT_CONTEXT_PATH = join('packages', 'core', 'src', 'agent-panel', 'context.ts')
export const AGENT_PRIVACY_EXPORTS = ['decideAttach', 'decideAutoAttach', 'autoAttachDecision'] as const

export interface AttachDecision {
  attach: boolean
  redacted: boolean
}

export type AttachProvider = (candidate: PrivacyCandidate, actor: PrivacyActor) => AttachDecision

export function checkAgentPrivacy(decideAttach: AttachProvider): GateResult {
  const gate = 'agent-panel-privacy'
  const violations: string[] = []
  const expected = new Map(PRIVACY_EXPECTATIONS.map((e) => [e.ref, e]))
  for (const fixture of PRIVACY_FIXTURES) {
    const exp = expected.get(fixture.ref)
    if (!exp) {
      violations.push(`${fixture.ref}: fixture has no expectation (harness bug)`)
      continue
    }
    let got: AttachDecision
    try {
      // Fresh copies: a provider cannot mutate the shared fixtures.
      got = decideAttach({ ...fixture }, { ...PRIVACY_ACTOR })
    } catch (error) {
      violations.push(`${fixture.ref}: decideAttach threw ${errorMessage(error)}`)
      continue
    }
    if (!got || typeof got.attach !== 'boolean' || typeof got.redacted !== 'boolean') {
      violations.push(`${fixture.ref}: expected { attach: boolean, redacted: boolean }, got ${JSON.stringify(got)}`)
      continue
    }
    if (got.attach !== exp.autoAttach) violations.push(`${fixture.ref}: attach=${got.attach}, want ${exp.autoAttach}`)
    if (got.redacted !== exp.redacted) violations.push(`${fixture.ref}: redacted=${got.redacted}, want ${exp.redacted}`)
  }
  return gateFromViolations(gate, violations, `privacy negatives hold (${PRIVACY_FIXTURES.length} candidates)`)
}

export async function checkAgentPrivacyGate(opts: {
  repoRoot?: string
  decideAttach?: AttachProvider
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
  return checkAgentPrivacy(mod[key] as AttachProvider)
}
