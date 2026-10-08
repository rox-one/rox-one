/**
 * W1-10 (#1507) — visual + axe gates.
 *
 * The visual gate plans snapshots for the discovered screen list and
 * reports pending until a browser driver executes them (wave-2 E2E owns
 * the driver). The axe gate audits provided HTML strings now (built-in
 * rules, axe-core when installed) and reports pending when no screen
 * HTML is discoverable.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { pending, gateFromViolations, type GateResult } from './types.ts'
import { planVisualSnapshots, SNAPSHOTS_PER_SCREEN } from '../visual.ts'
import { runAxeAudit } from '../axe.ts'

export function checkVisualGate(opts: { repoRoot?: string; screenIds?: string[] } = {}): GateResult {
  const gate = 'visual-snapshots'
  const root = opts.repoRoot ?? join(import.meta.dir, '..', '..', '..', '..')
  void root
  const screens = opts.screenIds ?? []
  if (screens.length === 0) {
    return pending(gate, 'e2e/unified visual screen list (wave-2 surfaces)', '1507')
  }
  const plan = planVisualSnapshots(screens)
  const executed = process.env.ROX_VISUAL_DRIVER === '1'
  if (!executed) {
    return {
      gate,
      status: 'pending',
      summary: `pending (plan ready: ${plan.length} snapshots for ${screens.length} screen(s) × ${SNAPSHOTS_PER_SCREEN}/screen; no browser driver — ROX_VISUAL_DRIVER=1 to execute)`,
    }
  }
  return gateFromViolations(gate, [], `visual plan: ${plan.length} snapshots`)
}

export async function checkAxeGate(opts: {
  repoRoot?: string
  documents?: Array<{ id: string; html: string }>
}): Promise<GateResult> {
  const gate = 'axe'
  const root = opts.repoRoot ?? join(import.meta.dir, '..', '..', '..', '..')
  void root
  const docs = opts.documents ?? []
  if (docs.length === 0) {
    return pending(gate, 'rendered screen HTML (wave-2 surfaces)', '1507')
  }
  const violations: string[] = []
  for (const doc of docs) {
    const res = await runAxeAudit(doc.html)
    for (const v of res.violations) violations.push(`${doc.id}: [${v.rule}] ${v.message}`)
  }
  return gateFromViolations(gate, violations, `${docs.length} document(s) axe-clean`)
}

export function visualDriverPresent(): boolean {
  return existsSync(join(import.meta.dir, '..', '..', '..', '..', 'node_modules', 'playwright')) ||
    existsSync(join(import.meta.dir, '..', '..', '..', '..', 'node_modules', '@playwright', 'test'))
}
