/**
 * W1-10 (#1507) — visual + axe gates.
 *
 * Both need rendered screens, which only the wave-2 browser driver
 * produces. Until it exists they report `pending` and say so explicitly
 * (owner decision; packages/test-harness/README.md):
 * - visual: builds the deterministic snapshot plan (1440×900 / 1280×800,
 *   both UI profiles, fixed clock, hover / focus / motion / reduced
 *   motion) but never claims a pass. Requesting execution with
 *   `ROX_VISUAL_DRIVER=1` FAILS, because wave 1 has no driver to execute
 *   the plan (no vacuous pass).
 * - axe: audits explicitly injected HTML documents with the built-in rule
 *   set (self-tests); in CI no documents exist yet, so it is pending.
 *   axe-core itself runs only inside the browser driver (see ../axe.ts).
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { pendingUntilBrowserDriver, gateFromViolations, type GateResult } from './types.ts'
import { planVisualSnapshots, SNAPSHOTS_PER_SCREEN } from '../visual.ts'
import { runAxeAudit } from '../axe.ts'

export function checkVisualGate(opts: { repoRoot?: string; screenIds?: string[]; env?: Record<string, string | undefined> } = {}): GateResult {
  const gate = 'visual-snapshots'
  const env = opts.env ?? process.env
  const screens = opts.screenIds ?? []
  const plan = planVisualSnapshots(screens)
  if (env.ROX_VISUAL_DRIVER === '1') {
    return {
      gate,
      status: 'fail',
      summary: 'ROX_VISUAL_DRIVER=1 requested execution, but wave 1 ships no browser driver',
      violations: [`cannot execute ${plan.length} planned snapshot(s); the driver lands with wave-2 E2E`],
    }
  }
  const what = screens.length === 0
    ? 'the wave-2 screen list'
    : `a driver to execute the ready plan (${plan.length} snapshots = ${screens.length} screen(s) × ${SNAPSHOTS_PER_SCREEN})`
  return pendingUntilBrowserDriver(gate, what)
}

export async function checkAxeGate(opts: {
  repoRoot?: string
  documents?: Array<{ id: string; html: string }>
} = {}): Promise<GateResult> {
  const gate = 'axe'
  const docs = opts.documents ?? []
  if (docs.length === 0) return pendingUntilBrowserDriver(gate, 'rendered screen HTML (wave-2 surfaces)')
  const violations: string[] = []
  for (const doc of docs) {
    const res = await runAxeAudit(doc.html)
    for (const v of res.violations) violations.push(`${doc.id}: [${v.rule}] ${v.message}`)
  }
  return gateFromViolations(gate, violations, `${docs.length} document(s) clean under the built-in rules`)
}

export function visualDriverPresent(): boolean {
  return existsSync(join(import.meta.dir, '..', '..', '..', '..', 'node_modules', 'playwright')) ||
    existsSync(join(import.meta.dir, '..', '..', '..', '..', 'node_modules', '@playwright', 'test'))
}
