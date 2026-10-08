/**
 * W1-10 (#1507) — `riskClass` presence gate (v2 gate).
 *
 * Every GATED command (bound handler or `schemaBound: true`, see
 * catalogue.ts) must carry a `riskClass` function on its registry
 * definition. #1508 sets it through `registry.bindSchema(type, schema,
 * { riskClass })`, so the check reads the runtime registry from
 * `createWiredCommandRegistry()` (catalogue.ts), not catalogue source. Unbound placeholders
 * are reported as pending. Exceptions: `riskClass` in
 * `packages/test-harness/allowlists/command-gates.json` (shrink-only).
 */
import { join } from 'node:path'
import type { GateResult } from './types.ts'
import { CATALOGUE_PATH, COMMAND_ALLOWLIST_PATH, commandGateResult, loadCatalogue, type CatalogueInputs } from './catalogue.ts'
import { resolveAllowlist, type AllowlistInputs } from './allowlist.ts'

export { CATALOGUE_PATH }

export async function checkRiskClassPresence(opts: CatalogueInputs & { allowlist?: AllowlistInputs } = {}): Promise<GateResult> {
  const root = opts.repoRoot ?? join(import.meta.dir, '..', '..', '..', '..')
  const readout = await loadCatalogue(opts)
  const allowlist = readout.present ? resolveAllowlist(root, COMMAND_ALLOWLIST_PATH, 'riskClass', opts.allowlist) : { entries: [], problems: [] }
  return commandGateResult({
    gate: 'risk-class',
    readout,
    allowlist,
    okNoun: 'declare riskClass',
    check: (cmd) => (cmd.hasRiskClass ? null : `command '${cmd.type}' (${cmd.module}) is gated (${cmd.bound ? 'handler bound' : 'schemaBound'}) but has no riskClass`),
  })
}
