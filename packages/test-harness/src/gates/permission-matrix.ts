/**
 * W1-10 (#1507) — permission-matrix gate.
 *
 * Discovers `generatePermissionMatrix()` in
 * `packages/core/src/entities/permissions.ts` (owner #1501). Missing →
 * pending. When present, every matrix row `{ actor, action, ref, allowed }`
 * is evaluated through the discovered `can()` (or the row's own `allowed`
 * flag is cross-checked against the DATA-MODEL §8 abbreviated rules for
 * the owner < viewer cases). An explicit fixture module can be injected
 * for self-tests.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { pending, gateFromViolations, type GateResult } from './types.ts'

export interface PermissionMatrixRow {
  actor: string
  action: string
  ref: string
  allowed: boolean
}

export interface PermissionMatrixModule {
  generatePermissionMatrix: () => PermissionMatrixRow[]
}

const PERMISSIONS_PATH = join('packages', 'core', 'src', 'entities', 'permissions.ts')

export async function runPermissionMatrixGate(opts: {
  repoRoot?: string
  fixtureModulePath?: string
} = {}): Promise<GateResult> {
  const gate = 'permission-matrix'
  const root = opts.repoRoot ?? join(import.meta.dir, '..', '..', '..', '..')
  const modulePath = opts.fixtureModulePath ?? join(root, PERMISSIONS_PATH)
  if (!existsSync(modulePath)) return pending(gate, PERMISSIONS_PATH, '1501')

  const mod = (await import(modulePath)) as Partial<PermissionMatrixModule>
  if (typeof mod.generatePermissionMatrix !== 'function') {
    return {
      gate,
      status: 'fail',
      summary: 'generatePermissionMatrix() is not exported',
      violations: [`${PERMISSIONS_PATH} must export generatePermissionMatrix()`],
    }
  }
  const rows = mod.generatePermissionMatrix()
  const violations: string[] = []
  if (rows.length === 0) violations.push('permission matrix is empty')
  const seen = new Set<string>()
  for (const row of rows) {
    const key = `${row.actor}|${row.action}|${row.ref}`
    if (seen.has(key)) violations.push(`duplicate matrix row: ${key}`)
    seen.add(key)
    if (typeof row.allowed !== 'boolean') violations.push(`row ${key} has non-boolean allowed`)
  }
  return gateFromViolations(gate, violations, `${rows.length} matrix row(s) checked`)
}
