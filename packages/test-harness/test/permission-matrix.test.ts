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
    expect(res.summary).toContain('2352 matrix row(s) match DATA-MODEL §8')
    expect(res.summary).toContain('cover 2 kind(s) × 12 actions × 7 roles × 7 tag scenario(s)')
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
    expect(noProjectTransfer.violations).toEqual([expect.stringContaining("matrix incomplete for kind 'project': 49 of 588")])
    // a dropped role.
    const noCommenter = await runPermissionMatrixGate({ fixtureModulePath: filtered("r.role !== 'commenter'") })
    expect(noCommenter.violations?.join('\n')).toContain('|commenter|-|ca=false')
    // a dropped tag scenario that #1501 exports.
    const noAbsentReviewer = await runPermissionMatrixGate({ fixtureModulePath: filtered('!(r.tags.includes("reviewer") && r.championAbsent)') })
    expect(noAbsentReviewer.status).toBe('fail')
    expect(noAbsentReviewer.violations?.join('\n')).toContain('|reviewer|ca=true')
    // without the scenarios export only the no-tag scenario is required.
    const noExport = await runPermissionMatrixGate({ fixtureModulePath: filtered('!(r.tags.includes("reviewer") && r.championAbsent)', '') })
    expect(noExport.status).toBe('pass')
    expect(noExport.summary).toContain('× 1 tag scenario(s)')
  })
  test('completeness: malformed PERMISSION_MATRIX_TAG_SCENARIOS fails closed', async () => {
    const bad = await runPermissionMatrixGate({ fixtureModulePath: filtered('true', "export const PERMISSION_MATRIX_TAG_SCENARIOS = [{ tags: ['watcher'], championAbsent: false }]") })
    expect(bad.status).toBe('fail')
    expect(bad.violations?.join(' ')).toContain('PERMISSION_MATRIX_TAG_SCENARIOS entry')
  })
  test('checkPermissionMatrixCompleteness reports one violation per incomplete kind', () => {
    const rows = [row({ kind: 'goal' }), row({ kind: 'task', action: 'edit', role: 'editor', effectiveRole: 'editor' })]
    const v = checkPermissionMatrixCompleteness(rows, [{ tags: ['champion'], championAbsent: false }])
    expect(v).toHaveLength(2)
    expect(v[0]).toContain("kind 'goal': 167 of 168")
    expect(v[1]).toContain("kind 'task': 167 of 168")
  })
  test('present but not evaluable fails closed', async () => {
    expect((await runPermissionMatrixGate({ fixtureModulePath: moduleFile(`export const x = 1`) })).status).toBe('fail')
    expect((await runPermissionMatrixGate({ fixtureModulePath: moduleFile(`export function generatePermissionMatrix() { throw new Error('x') }`) })).status).toBe('fail')
    expect((await runPermissionMatrixGate({ fixtureModulePath: moduleFile(`export function generatePermissionMatrix() { return {} }`) })).status).toBe('fail')
  })
})
