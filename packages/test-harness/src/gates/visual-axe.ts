/**
 * W1-10 (#1507) — visual + axe gates.
 *
 * Both consume the capture artifacts the wave-2 browser driver
 * (`scripts/visual-capture.ts`, `bun run visual:capture`) writes under
 * `.visual-artifacts/` (shape in ../capture.ts; README.md). The runner loads
 * them once per run (`run-all.ts`, `readArtifacts` / `readBaselines`) and
 * injects them through `gateOpts`; without artifacts (default CI) these gates
 * stay `pending` and say how to produce them.
 * - visual: builds the deterministic snapshot plan (1440×900 / 1280×800,
 *   both UI profiles, fixed clock, hover / focus / motion / reduced motion)
 *   from the captured screen ids and passes only when every planned
 *   `snapshotKey(plan)` is present in the artifacts AND in the committed
 *   baselines with an identical `pixelHash`. Missing / changed keys fail (the
 *   first few are listed) — run `bun run visual:capture --update-baselines`
 *   when the change is intended. Requesting execution with
 *   `ROX_VISUAL_DRIVER=1` while artifacts / baselines are absent FAILS: no
 *   vacuous pass.
 * - axe: audits the captured screen HTML with the built-in rule set (see
 *   ../axe.ts); axe-core itself runs only inside the browser driver.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { pendingUntilBrowserDriver, gateFromViolations, type GateResult } from './types.ts'
import { planVisualSnapshots, SNAPSHOTS_PER_SCREEN } from '../visual.ts'
import { runAxeAudit } from '../axe.ts'
import { readArtifacts, snapshotKey, type CaptureArtifacts, type VisualBaselines } from '../capture.ts'

/** Run the wave-2 browser driver to (re)produce `.visual-artifacts/`. */
export const VISUAL_CAPTURE_COMMAND = 'bun run visual:capture'
/** Regenerate the committed baselines after an intended visual change. */
export const VISUAL_CAPTURE_UPDATE_COMMAND = `${VISUAL_CAPTURE_COMMAND} --update-baselines`
/** Most offending snapshot keys named in one failure before the rest are elided. */
export const MAX_REPORTED_KEYS = 5

export function checkVisualGate(opts: {
  repoRoot?: string
  screenIds?: string[]
  env?: Record<string, string | undefined>
  artifacts?: CaptureArtifacts | null
  baselines?: VisualBaselines | null
} = {}): GateResult {
  const gate = 'visual-snapshots'
  const env = opts.env ?? process.env
  const artifacts = opts.artifacts ?? null
  const baselines = opts.baselines ?? null
  const screens = artifacts ? artifacts.screens.map((s) => s.id) : opts.screenIds ?? []
  const plan = planVisualSnapshots(screens)
  if (!artifacts || !baselines) {
    const missing = artifacts ? 'committed baselines' : 'capture artifacts'
    if (env.ROX_VISUAL_DRIVER === '1') {
      return {
        gate,
        status: 'fail',
        summary: `ROX_VISUAL_DRIVER=1 requested execution, but ${missing} are absent`,
        violations: [`no ${missing} for ${plan.length} planned snapshot(s); produce them with \`${VISUAL_CAPTURE_COMMAND}\``],
      }
    }
    const what = screens.length === 0
      ? 'the wave-2 screen list'
      : `capture artifacts to execute the ready plan (${plan.length} snapshots = ${screens.length} screen(s) × ${SNAPSHOTS_PER_SCREEN})`
    return pendingUntilBrowserDriver(gate, what)
  }
  const captured = new Map(artifacts.snapshots.map((s) => [s.key, s]))
  const offending: string[] = []
  for (const p of plan) {
    const key = snapshotKey(p)
    const snap = captured.get(key)
    const baseline = baselines.hashes[key]
    if (!snap) offending.push(`${key} (not captured)`)
    else if (baseline === undefined) offending.push(`${key} (no baseline)`)
    else if (baseline !== snap.pixelHash) offending.push(`${key} (hash changed)`)
  }
  if (offending.length > 0) {
    const shown = offending.slice(0, MAX_REPORTED_KEYS)
    const elided = offending.length - shown.length
    return {
      gate,
      status: 'fail',
      summary: `${offending.length} of ${plan.length} planned snapshot(s) missing or changed; regenerate with \`${VISUAL_CAPTURE_UPDATE_COMMAND}\``,
      violations: [...shown, ...(elided > 0 ? [`… ${elided} more`] : [])],
    }
  }
  return { gate, status: 'pass', summary: `${plan.length} snapshot(s) match the committed baselines (${screens.length} screen(s))` }
}

export async function checkAxeGate(opts: {
  repoRoot?: string
  documents?: Array<{ id: string; html: string }>
  artifacts?: CaptureArtifacts | null
} = {}): Promise<GateResult> {
  const gate = 'axe'
  const artifacts = opts.artifacts !== undefined ? opts.artifacts : await readArtifacts(opts.repoRoot ?? join(import.meta.dir, '..', '..', '..', '..'))
  const docs = opts.documents ?? (artifacts?.screens ?? []).map((s) => ({ id: s.id, html: s.html }))
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