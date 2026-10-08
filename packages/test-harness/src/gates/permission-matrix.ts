/**
 * W1-10 (#1507) — permission-matrix gate (DATA-MODEL §8).
 *
 * Input: `generatePermissionMatrix()` from
 * `packages/core/src/entities/permissions.ts` (owner #1501). Missing →
 * pending; present but not importable / not exported / throwing / not an
 * array → fail (fail closed).
 *
 * Row shape = #1501's frozen contract ("Frozen contract (W1-10 consumes
 * it)"): `{ action, role, tags, championAbsent, hasChildren, kind,
 * effectiveRole, allowed, reason? }`. Rows are keyed on
 * kind|action|role|tags|championAbsent|hasChildren (no duplicates).
 *
 * What the gate asserts (independently of #1501's own rule table, from a
 * hand transcription of DATA-MODEL §8.1–§8.3 kept here):
 * 1. shape: known role lattice (`minimal < viewer < commenter < editor <
 *    manager < owner`, `null` = no access), known contextual tags, booleans;
 *    a denied row carries a `reason`, an allowed row does not;
 * 2. `effectiveRole` = `role` raised by the contextual tags (§8.2.2:
 *    owner → owner, champion → manager, reviewer / contributor / assignee →
 *    editor);
 * 3. no access without a tag (`role = null`, no tags) never allows anything;
 * 4. viewer and minimal can never edit; minimal sees only `view_title`;
 *    a manager may not `transfer` (owner only);
 * 5. every row's `allowed` equals the §8.3 transcription (minimum role per
 *    action, champion / reviewer grants, reviewer check-in only while the
 *    champion is absent, goal deletion blocked while children exist). An
 *    action this transcription does not know fails, so a new #1501 action
 *    needs a matching rule here;
 * 6. completeness (#1507 review 3): for every `kind` that appears, every
 *    §8.3 action (SPEC_MIN_ROLE) × every role (SPEC_ROLES plus `null`) ×
 *    the no-tag scenario (`tags: []`, `championAbsent: false`) has a row,
 *    and so does every tag scenario #1501 exports as
 *    `PERMISSION_MATRIX_TAG_SCENARIOS` (`{ tags, championAbsent }[]`, when
 *    exported; malformed = fail). A generator that drops kinds' actions,
 *    roles or scenarios no longer passes on the subset it still emits.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { pending, inputBroken, errorMessage, gateFromViolations, type GateResult } from './types.ts'

/** #1501 frozen row contract. */
export interface PermissionMatrixRow {
  action: string
  role: string | null
  tags: readonly string[]
  championAbsent: boolean
  hasChildren: boolean
  kind: string
  effectiveRole: string | null
  allowed: boolean
  reason?: string
}

export interface PermissionMatrixModule {
  generatePermissionMatrix: () => PermissionMatrixRow[]
  /** Optional #1501 export: the tag scenarios the generator enumerates. */
  PERMISSION_MATRIX_TAG_SCENARIOS?: unknown
}

export interface TagScenario {
  tags: readonly string[]
  championAbsent: boolean
}

/** Always required, whether or not #1501 exports its scenarios. */
export const NO_TAG_SCENARIO: TagScenario = { tags: [], championAbsent: false }

export const PERMISSIONS_PATH = join('packages', 'core', 'src', 'entities', 'permissions.ts')

/** DATA-MODEL §8.1 lattice, ascending. */
export const SPEC_ROLES = ['minimal', 'viewer', 'commenter', 'editor', 'manager', 'owner'] as const
/** DATA-MODEL §8.2.2 contextual tag → implied role. */
export const SPEC_TAG_ROLE: Readonly<Record<string, string>> = {
  owner: 'owner',
  champion: 'manager',
  reviewer: 'editor',
  contributor: 'editor',
  assignee: 'editor',
}
/** DATA-MODEL §8.3 minimum lattice role per action. */
export const SPEC_MIN_ROLE: Readonly<Record<string, string>> = {
  view_title: 'minimal',
  view: 'viewer',
  comment: 'commenter',
  react: 'commenter',
  edit: 'editor',
  check_in: 'manager',
  acknowledge: 'manager',
  close: 'manager',
  delete: 'manager',
  manage_access: 'manager',
  create_child: 'editor',
  transfer: 'owner',
}

const RANK = new Map<string, number>(SPEC_ROLES.map((r, i) => [r, i]))

function atLeast(role: string | null, min: string): boolean {
  if (role === null) return false
  return (RANK.get(role) ?? -1) >= (RANK.get(min) ?? Infinity)
}

export function specEffectiveRole(role: string | null, tags: readonly string[]): string | null {
  let best = role
  for (const tag of tags) {
    const implied = SPEC_TAG_ROLE[tag]
    if (!implied) continue
    if (best === null || atLeast(implied, best)) best = implied
  }
  return best
}

/** §8.3 transcription: is the row's action allowed? */
export function specAllowed(row: PermissionMatrixRow): boolean {
  const effective = specEffectiveRole(row.role, row.tags)
  let allowed = atLeast(effective, SPEC_MIN_ROLE[row.action]!)
  if (row.action === 'check_in' && row.tags.includes('champion')) allowed = true
  if (row.action === 'check_in' && row.tags.includes('reviewer') && row.championAbsent) allowed = true
  if (row.action === 'acknowledge' && row.tags.includes('reviewer')) allowed = true
  if (row.action === 'close' && row.tags.includes('champion')) allowed = true
  if (row.action === 'delete' && row.kind === 'goal' && row.hasChildren) allowed = false
  return allowed
}

function rowKey(row: PermissionMatrixRow): string {
  return `${row.kind}|${row.action}|${row.role ?? 'none'}|${[...(row.tags ?? [])].join('+') || '-'}|ca=${row.championAbsent}|ch=${row.hasChildren}`
}

function scenarioKey(s: TagScenario): string {
  return `${[...s.tags].sort().join('+') || '-'}|ca=${s.championAbsent}`
}

/** Validates #1501's optional PERMISSION_MATRIX_TAG_SCENARIOS export; returns a problem string or the scenarios. */
export function parseTagScenarios(value: unknown): TagScenario[] | string {
  if (!Array.isArray(value)) return 'PERMISSION_MATRIX_TAG_SCENARIOS must be an array of { tags, championAbsent }'
  for (const s of value) {
    if (s === null || typeof s !== 'object' || !Array.isArray((s as TagScenario).tags) ||
      !(s as TagScenario).tags.every((t) => typeof t === 'string' && t in SPEC_TAG_ROLE) ||
      typeof (s as TagScenario).championAbsent !== 'boolean') {
      return `PERMISSION_MATRIX_TAG_SCENARIOS entry ${JSON.stringify(s)?.slice(0, 120)} is not { tags: known tag[], championAbsent: boolean }`
    }
  }
  return value as TagScenario[]
}

/**
 * Completeness (invariant 6): per kind seen, every SPEC_MIN_ROLE action ×
 * SPEC_ROLES + null × (no-tag scenario + `tagScenarios`) needs at least one
 * row (any hasChildren). One violation per kind, with up to 5 examples.
 */
export function checkPermissionMatrixCompleteness(rows: unknown[], tagScenarios: readonly TagScenario[] = []): string[] {
  const present = new Set<string>()
  const kinds = new Set<string>()
  for (const raw of rows) {
    const row = raw as PermissionMatrixRow
    if (row === null || typeof row !== 'object' || typeof row.kind !== 'string' || typeof row.action !== 'string' || !Array.isArray(row.tags)) continue
    kinds.add(row.kind)
    present.add(`${row.kind}|${row.action}|${row.role ?? 'none'}|${scenarioKey({ tags: row.tags, championAbsent: row.championAbsent === true })}`)
  }
  const scenarios = new Map<string, TagScenario>([[scenarioKey(NO_TAG_SCENARIO), NO_TAG_SCENARIO]])
  for (const s of tagScenarios) scenarios.set(scenarioKey(s), s)
  const roles: Array<string | null> = [...SPEC_ROLES, null]
  const violations: string[] = []
  for (const kind of [...kinds].sort()) {
    const missing: string[] = []
    for (const action of Object.keys(SPEC_MIN_ROLE)) {
      for (const role of roles) {
        for (const key of scenarios.keys()) {
          const k = `${kind}|${action}|${role ?? 'none'}|${key}`
          if (!present.has(k)) missing.push(k)
        }
      }
    }
    if (missing.length > 0) {
      const total = Object.keys(SPEC_MIN_ROLE).length * roles.length * scenarios.size
      violations.push(`matrix incomplete for kind '${kind}': ${missing.length} of ${total} action × role (incl. none) × tag-scenario combinations have no row, e.g. ${missing.slice(0, 5).join(', ')}`)
    }
  }
  return violations
}

/** Pure per-row check over a matrix (exported for self-tests; completeness is checkPermissionMatrixCompleteness). */
export function checkPermissionMatrixRows(rows: unknown[]): string[] {
  const violations: string[] = []
  if (rows.length === 0) return ['permission matrix is empty']
  const seen = new Set<string>()
  const MAX = 50
  const push = (v: string) => {
    if (violations.length < MAX) violations.push(v)
    else if (violations.length === MAX) violations.push('… further violations truncated')
  }
  for (const raw of rows) {
    const row = raw as PermissionMatrixRow
    const shapeOk =
      row !== null && typeof row === 'object' &&
      typeof row.action === 'string' && typeof row.kind === 'string' &&
      (row.role === null || (typeof row.role === 'string' && RANK.has(row.role))) &&
      (row.effectiveRole === null || (typeof row.effectiveRole === 'string' && RANK.has(row.effectiveRole))) &&
      Array.isArray(row.tags) && row.tags.every((t) => typeof t === 'string' && t in SPEC_TAG_ROLE) &&
      typeof row.championAbsent === 'boolean' && typeof row.hasChildren === 'boolean' && typeof row.allowed === 'boolean'
    if (!shapeOk) {
      push(`row does not match the #1501 contract {action, role, tags, championAbsent, hasChildren, kind, effectiveRole, allowed, reason?}: ${JSON.stringify(raw)?.slice(0, 200)}`)
      continue
    }
    const key = rowKey(row)
    if (seen.has(key)) push(`duplicate matrix row: ${key}`)
    seen.add(key)
    if (!(row.action in SPEC_MIN_ROLE)) {
      push(`${key}: action '${row.action}' has no DATA-MODEL §8.3 rule in the harness transcription`)
      continue
    }
    if (row.allowed && row.reason !== undefined) push(`${key}: allowed row carries reason '${row.reason}'`)
    if (!row.allowed && (typeof row.reason !== 'string' || row.reason === '')) push(`${key}: denied row has no reason`)
    const effective = specEffectiveRole(row.role, row.tags)
    if (row.effectiveRole !== effective) push(`${key}: effectiveRole ${row.effectiveRole} but §8.2.2 tags give ${effective}`)
    if (row.role === null && row.tags.length === 0 && row.allowed) push(`${key}: no access (role null, no tag) must not allow anything`)
    if (row.tags.length === 0 && (row.role === 'viewer' || row.role === 'minimal') && row.action === 'edit' && row.allowed) push(`${key}: ${row.role} must not edit`)
    if (row.tags.length === 0 && row.role === 'minimal' && row.action !== 'view_title' && row.allowed) push(`${key}: minimal may only view titles`)
    if (row.tags.length === 0 && row.role === 'manager' && row.action === 'transfer' && row.allowed) push(`${key}: manager must not transfer (owner only)`)
    const want = specAllowed(row)
    if (row.allowed !== want) push(`${key}: allowed=${row.allowed}, DATA-MODEL §8.3 says ${want}`)
  }
  return violations
}

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
  let rows: unknown
  try {
    rows = mod.generatePermissionMatrix()
  } catch (error) {
    return inputBroken(gate, PERMISSIONS_PATH, `generatePermissionMatrix() threw: ${errorMessage(error)}`)
  }
  if (!Array.isArray(rows)) return inputBroken(gate, PERMISSIONS_PATH, 'generatePermissionMatrix() must return an array')
  let scenarios: TagScenario[] = []
  if (mod.PERMISSION_MATRIX_TAG_SCENARIOS !== undefined) {
    const parsed = parseTagScenarios(mod.PERMISSION_MATRIX_TAG_SCENARIOS)
    if (typeof parsed === 'string') return inputBroken(gate, PERMISSIONS_PATH, parsed)
    scenarios = parsed
  }
  const violations = [...checkPermissionMatrixRows(rows), ...(rows.length > 0 ? checkPermissionMatrixCompleteness(rows, scenarios) : [])]
  const kinds = new Set(rows.map((r) => (r as PermissionMatrixRow)?.kind)).size
  const scenarioCount = new Set([NO_TAG_SCENARIO, ...scenarios].map(scenarioKey)).size
  return gateFromViolations(gate, violations, `${rows.length} matrix row(s) match DATA-MODEL §8 (shape, tag roles, invariants, §8.3 rules) and cover ${kinds} kind(s) × ${Object.keys(SPEC_MIN_ROLE).length} actions × ${SPEC_ROLES.length + 1} roles × ${scenarioCount} tag scenario(s)`)
}
