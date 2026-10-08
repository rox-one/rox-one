/**
 * W1-10 (#1507) — `riskClass` presence gate (v2 gate).
 *
 * Every command definition under `packages/core/src/commands/catalogue/*`
 * must declare `riskClass` (required by #1508; catalogue owned by #1500).
 * Missing catalogue → pending. A fixture directory can be injected for
 * self-tests. Discovery is file-based (no imports): a definition file
 * passes when it contains a `riskClass` declaration.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { pending, gateFromViolations, type GateResult } from './types.ts'

export const CATALOGUE_PATH = join('packages', 'core', 'src', 'commands', 'catalogue')

export function checkRiskClassPresence(opts: { repoRoot?: string; catalogueDir?: string } = {}): GateResult {
  const gate = 'risk-class'
  const root = opts.repoRoot ?? join(import.meta.dir, '..', '..', '..', '..')
  const dir = opts.catalogueDir ?? join(root, CATALOGUE_PATH)
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return pending(gate, `${CATALOGUE_PATH}/*`, '1500')

  const files = readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
  if (files.length === 0) return pending(gate, `${CATALOGUE_PATH}/*`, '1500')

  const violations: string[] = []
  for (const file of files) {
    const src = readFileSync(join(dir, file), 'utf8')
    if (!/\briskClass\b/.test(src)) violations.push(`${file}: command definition declares no riskClass`)
  }
  return gateFromViolations(gate, violations, `${files.length} command definition(s) declare riskClass`)
}
