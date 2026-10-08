/**
 * W1-10 self-test: permission-matrix gate against fixture modules in #1501's
 * frozen row shape, and the DATA-MODEL §8 invariants it asserts.
 */
import { describe, expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkPermissionMatrixCompleteness, checkPermissionMatrixRows, runPermissionMatrixGate, specAllowed, specEffectiveRole, type PermissionMatrixRow } from '../src/gates/permission-matrix.ts'

const dir = join(import.meta.dir, 'fixture-data')

function row(over: Partial<PermissionMatrixRow>): PermissionMatrixRow {
  const r: PermissionMatrixRow = { action: 'view', role: 'viewer', tags: [], championAbsent: false, hasChildren: false, kind: 'goal', effectiveRole: 'viewer', allowed: true, ...over }
  if (r.allowed) delete r.reason
  return r
}

function moduleFile(src: string): string {
  const d = mkdtempSync(join(tmpdir(), 'w1-10-perm-'))
  const p = join(d, 'permissions.ts')
  writeFileSync(p, src)
  return p
}

describe('permission-matrix gate', () => {
  test('passes on a correct matrix in the #1501 row shape', async () => {
    const res = await runPermissionMatrixGate({ fixtureModulePath: join(dir, 'matrix-good.ts') })
    expect(res.violations).toBeUndefined()
    expect(res.status).toBe('pass')
    expect(res.summary).toContain('4704 matrix row(s) match DATA-MODEL §8')
    expect(res.summary).toContain('cover 4 kind(s) × 12 actions × 7 roles × 7 tag scenario(s) × 2 hasChildren')
  })
  test('fails on a well-formed but wrong matrix, naming each broken invariant', async () => {
    const res = await runPermissionMatrixGate({ fixtureModulePath: join(dir, 'matrix-bad.ts') })
    expect(res.status).toBe('fail')
    const text = res.violations?.join('\n') ?? ''
    expect(text).toContain('viewer must not edit')
    expect(text).toContain('manager must not transfer (owner only)')
    expect(text).toContain('effectiveRole viewer but §8.2.2 tags give manager')
    expect(text).toContain('no access (role null, no tag) must not allow anything')
    expect(text).toContain('duplicate matrix row')
  })
  test('rows are keyed on the #1501 dimensions (kind, action, role, tags, championAbsent, hasChildren), so distinct rows are not duplicates', () => {
    const rows: PermissionMatrixRow[] = []
    for (const kind of ['goal', 'project', 'task']) {
      for (const role of ['viewer', 'commenter', 'editor'] as const) {
        for (const championAbsent of [false, true]) {
          rows.push(row({ kind, role, effectiveRole: role, championAbsent, action: 'view' }))
        }
      }
    }
    expect(checkPermissionMatrixRows(rows)).toEqual([])
  })
  test('the old {actor, action, ref, allowed} shape and unknown actions/roles/tags are rejected', () => {
    expect(checkPermissionMatrixRows([{ actor: 'owner', action: 'read', ref: 'goal:g1', allowed: true }])[0]).toContain('does not match the #1501 contract')
    expect(checkPermissionMatrixRows([row({ role: 'admin' as string })])[0]).toContain('does not match the #1501 contract')
    expect(checkPermissionMatrixRows([row({ tags: ['watcher'] })])[0]).toContain('does not match the #1501 contract')
    expect(checkPermissionMatrixRows([row({ action: 'teleport' })])[0]).toContain("action 'teleport' has no DATA-MODEL §8.3 rule")
    expect(checkPermissionMatrixRows([])).toEqual(['permission matrix is empty'])
  })
  test('reason discipline: denied rows explain, allowed rows do not', () => {
    expect(checkPermissionMatrixRows([row({ action: 'edit', allowed: false })])).toContain('goal|edit|viewer|-|ca=false|ch=false: denied row has no reason')
    expect(checkPermissionMatrixRows([{ ...row({}), reason: 'x' }])[0]).toContain("allowed row carries reason 'x'")
  })
  test('§8.3 special cases: reviewer check-in only while the champion is absent; goals with children cannot be deleted', () => {
    expect(specAllowed(row({ action: 'check_in', tags: ['reviewer'], championAbsent: false }))).toBe(false)
    expect(specAllowed(row({ action: 'check_in', tags: ['reviewer'], championAbsent: true }))).toBe(true)
    expect(specAllowed(row({ action: 'delete', role: 'owner', hasChildren: true }))).toBe(false)
    expect(specAllowed(row({ action: 'delete', role: 'owner', hasChildren: true, kind: 'project' }))).toBe(true)
    expect(specEffectiveRole(null, ['contributor'])).toBe('editor')
    expect(specEffectiveRole('owner', ['assignee'])).toBe('owner')
    expect(specEffectiveRole(null, [])).toBeNull()
  })
  test('violations are truncated so a broken generator does not flood CI', () => {
    const rows = Array.from({ length: 80 }, (_, i) => row({ action: 'edit', kind: `k${i}`, allowed: true }))
    const v = checkPermissionMatrixRows(rows)
    expect(v.length).toBe(51)
    expect(v.at(-1)).toContain('truncated')
  })
  const good = join(dir, 'matrix-good.ts')
  /** A module that re-exports the complete fixture through a row filter (and optionally its own scenarios). */
  function filtered(filter: string, scenarios = 'export { PERMISSION_MATRIX_TAG_SCENARIOS }'): string {
    return moduleFile(`import { generatePermissionMatrix as all, PERMISSION_MATRIX_TAG_SCENARIOS } from ${JSON.stringify(good)}
${scenarios}
export function generatePermissionMatrix() { return all().filter((r) => ${filter}) }`)
  }
  test('completeness: a subset of correct rows fails (#1507 review 3)', async () => {
    // only no-access denied rows: every row is individually correct.
    const onlyNull = await runPermissionMatrixGate({ fixtureModulePath: filtered('r.role === null && r.tags.length === 0') })
    expect(onlyNull.status).toBe('fail')
    expect(onlyNull.violations?.join('\n')).toContain("matrix incomplete for kind 'goal'")
    expect(onlyNull.violations?.join('\n')).toContain('goal|view_title|minimal|-|ca=false')
    // a dropped action for one kind.
    const noProjectTransfer = await runPermissionMatrixGate({ fixtureModulePath: filtered("!(r.kind === 'project' && r.action === 'transfer')") })
    expect(noProjectTransfer.violations).toEqual([expect.stringContaining("matrix incomplete for kind 'project' (pinned kind): 98 of 1176")])
    // a dropped role.
    const noCommenter = await runPermissionMatrixGate({ fixtureModulePath: filtered("r.role !== 'commenter'") })
    expect(noCommenter.violations?.join('\n')).toContain('|commenter|-|ca=false')
    // a dropped tag scenario that #1501 exports.
    const noAbsentReviewer = await runPermissionMatrixGate({ fixtureModulePath: filtered('!(r.tags.includes("reviewer") && r.championAbsent)') })
    expect(noAbsentReviewer.status).toBe('fail')
    expect(noAbsentReviewer.violations?.join('\n')).toContain('|reviewer|ca=true')
  })
  test('completeness is pinned, not read back from #1501 alone (#1507 review 4)', async () => {
    // dropping a whole kind: the remaining kinds are complete, but 'note' is pinned.
    const noNote = await runPermissionMatrixGate({ fixtureModulePath: filtered("r.kind !== 'note'") })
    expect(noNote.status).toBe('fail')
    expect(noNote.violations).toEqual([expect.stringContaining("matrix incomplete for kind 'note' (pinned kind): 1176 of 1176")])
    // dropping the reviewer + championAbsent scenario from the generator AND the export.
    const scenariosWithout = `const PERMISSION_MATRIX_TAG_SCENARIOS_ALL = PERMISSION_MATRIX_TAG_SCENARIOS
export const PERMISSION_MATRIX_TAG_SCENARIOS_OUT = PERMISSION_MATRIX_TAG_SCENARIOS_ALL.filter((s) => !(s.tags.includes('reviewer') && s.championAbsent))
export { PERMISSION_MATRIX_TAG_SCENARIOS_OUT as PERMISSION_MATRIX_TAG_SCENARIOS }`
    const noAbsentReviewer = await runPermissionMatrixGate({ fixtureModulePath: filtered('!(r.tags.includes("reviewer") && r.championAbsent)', scenariosWithout) })
    expect(noAbsentReviewer.status).toBe('fail')
    expect(noAbsentReviewer.violations?.join(' ')).toContain('lacks the pinned scenario(s) DATA-MODEL §8.3 depends on: reviewer|ca=true')
    // the same generator with an export that still lists it fails on the missing rows.
    const rowsOnly = await runPermissionMatrixGate({ fixtureModulePath: filtered('!(r.tags.includes("reviewer") && r.championAbsent)') })
    expect(rowsOnly.violations?.join('\n')).toContain('|reviewer|ca=true|ch=')
    // and the gate's own required set catches it even if the export were not consulted.
    const { generatePermissionMatrix } = await import(join(dir, 'matrix-good.ts'))
    const withoutRows = (generatePermissionMatrix() as PermissionMatrixRow[]).filter((r) => !(r.tags.includes('reviewer') && r.championAbsent))
    expect(checkPermissionMatrixCompleteness(withoutRows, [])).toHaveLength(4)
    // only hasChildren=false rows: the goal-delete blocker is never exercised.
    const noChildren = await runPermissionMatrixGate({ fixtureModulePath: filtered('r.hasChildren === false') })
    expect(noChildren.status).toBe('fail')
    expect(noChildren.violations).toHaveLength(4)
    expect(noChildren.violations?.join('\n')).toContain("matrix incomplete for kind 'goal' (pinned kind): 588 of 1176")
    expect(noChildren.violations?.join('\n')).toContain('goal|view_title|minimal|-|ca=false|ch=true')
    const noGoalDeleteChildren = await runPermissionMatrixGate({ fixtureModulePath: filtered("!(r.kind === 'goal' && r.action === 'delete' && r.hasChildren)") })
    expect(noGoalDeleteChildren.violations).toEqual([expect.stringContaining("kind 'goal' (pinned kind): 49 of 1176")])
    expect(noGoalDeleteChildren.violations?.[0]).toContain('goal|delete|minimal|-|ca=false|ch=true')
  })
  test('PERMISSION_MATRIX_TAG_SCENARIOS is required once permissions.ts exists: missing or renamed fails closed', async () => {
    const missing = await runPermissionMatrixGate({ fixtureModulePath: filtered('true', '') })
    expect(missing.status).toBe('fail')
    expect(missing.violations?.join(' ')).toContain('must export PERMISSION_MATRIX_TAG_SCENARIOS')
    const renamed = await runPermissionMatrixGate({ fixtureModulePath: filtered('true', 'export const PERMISSION_MATRIX_SCENARIOS = PERMISSION_MATRIX_TAG_SCENARIOS') })
    expect(renamed.status).toBe('fail')
    expect(renamed.violations?.join(' ')).toContain('a missing or renamed export fails')
  })
  test('completeness: malformed PERMISSION_MATRIX_TAG_SCENARIOS fails closed', async () => {
    const bad = await runPermissionMatrixGate({ fixtureModulePath: filtered('true', "export const PERMISSION_MATRIX_TAG_SCENARIOS = [{ tags: ['watcher'], championAbsent: false }]") })
    expect(bad.status).toBe('fail')
    expect(bad.violations?.join(' ')).toContain('PERMISSION_MATRIX_TAG_SCENARIOS entry')
  })
  test('checkPermissionMatrixCompleteness reports one violation per incomplete kind, pinned kinds and extra kinds alike', () => {
    const rows = [row({ kind: 'goal' }), row({ kind: 'space', action: 'edit', role: 'editor', effectiveRole: 'editor' })]
    // champion is pinned anyway: no-tag + champion + reviewer ca=false/true = 4 scenarios × 12 × 7 × 2 = 672 per kind.
    const v = checkPermissionMatrixCompleteness(rows, [{ tags: ['champion'], championAbsent: false }])
    expect(v).toHaveLength(5)
    expect(v[0]).toContain("kind 'goal' (pinned kind): 671 of 672")
    expect(v[1]).toContain("kind 'note' (pinned kind): 672 of 672")
    expect(v[2]).toContain("kind 'project' (pinned kind): 672 of 672")
    expect(v[3]).toContain("kind 'space': 671 of 672")
    expect(v[4]).toContain("kind 'task' (pinned kind): 672 of 672")
  })
  test('present but not evaluable fails closed', async () => {
    expect((await runPermissionMatrixGate({ fixtureModulePath: moduleFile(`export const x = 1`) })).status).toBe('fail')
    expect((await runPermissionMatrixGate({ fixtureModulePath: moduleFile(`export function generatePermissionMatrix() { throw new Error('x') }`) })).status).toBe('fail')
    expect((await runPermissionMatrixGate({ fixtureModulePath: moduleFile(`export function generatePermissionMatrix() { return {} }`) })).status).toBe('fail')
  })
})
