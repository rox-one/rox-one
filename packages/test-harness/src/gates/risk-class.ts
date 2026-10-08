/**
 * W1-10 (#1507) — `riskClass` presence gate (v2 gate).
 *
 * Every command definition under `packages/core/src/commands/catalogue/*`
 * must declare `riskClass` (required by #1508; catalogue owned by #1500).
 * Checked per definition object, not per file: one `riskClass` in a module
 * file no longer covers its other commands. Catalogue absent → pending; a
 * module file with no discoverable definition fails (see catalogue.ts).
 */
import { join } from 'node:path'
import { pending, gateFromViolations, type GateResult } from './types.ts'
import { CATALOGUE_PATH, readCatalogue } from './catalogue.ts'

export { CATALOGUE_PATH }

export function checkRiskClassPresence(opts: { repoRoot?: string; catalogueDir?: string } = {}): GateResult {
  const gate = 'risk-class'
  const root = opts.repoRoot ?? join(import.meta.dir, '..', '..', '..', '..')
  const catalogue = readCatalogue(opts.catalogueDir ?? join(root, CATALOGUE_PATH))
  if (!catalogue.present) return pending(gate, `${CATALOGUE_PATH}/*`, '1500')

  const violations = [...catalogue.problems]
  for (const cmd of catalogue.commands) {
    if (!/\briskClass\s*:/.test(cmd.body)) violations.push(`${cmd.file}: command '${cmd.id}' declares no riskClass`)
  }
  return gateFromViolations(gate, violations, `${catalogue.commands.length} command definition(s) declare riskClass`)
}
