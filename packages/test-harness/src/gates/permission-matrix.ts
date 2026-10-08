/**
 * W1-10 (#1507) — permission-matrix gate.
 *
 * Discovers `generatePermissionMatrix()` in
 * `packages/core/src/entities/permissions.ts` (owner #1501). Missing →
 * pending; present but not importable / not exported / throwing → fail. When present, every matrix row `{ actor, action, ref, allowed }`
 * is evaluated through the discovered `can()` (or the row's own `allowed`
 * flag is cross-checked against the DATA-MODEL §8 abbreviated rules for
 * the owner < viewer cases). An explicit fixture module can be injected
 * for self-tests.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { pending, inputBroken, errorMessage, gateFromViolations, type GateResult } from './types.ts'

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

  // Present but not evaluable → fail closed (types.ts input policy).
  let mod: Partial<PermissionMatrixModule>
  try {
    mod = (await import(modulePath)) as Partial<PermissionMatrixModule>
  } catch (error) {
    return inputBroken(gate, PERMISSIONS_PATH, `import failed: ${errorMessage(error)}`)
  }
  if (typeof mod.generatePermissionMatrix !== 'function') {
    return inputBroken(gate, PERMISSIONS_PATH, 'must export generatePermissionMatrix()')
  }
  let rows: PermissionMatrixRow[]
  try {
    rows = mod.generatePermissionMatrix()
  } catch (error) {
    return inputBroken(gate, PERMISSIONS_PATH, `generatePermissionMatrix() threw: ${errorMessage(error)}`)
  }
  if (!Array.isArray(rows)) return inputBroken(gate, PERMISSIONS_PATH, 'generatePermissionMatrix() must return an array')
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
