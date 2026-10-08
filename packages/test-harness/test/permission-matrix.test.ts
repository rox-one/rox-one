/**
 * W1-10 self-test: permission-matrix gate against fixture modules in #1501's
 * frozen row shape, and the DATA-MODEL §8 invariants it asserts.
 */
import { describe, expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkPermissionMatrixRows, runPermissionMatrixGate, specAllowed, specEffectiveRole, type PermissionMatrixRow } from '../src/gates/permission-matrix.ts'

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
    expect(res.summary).toContain('14 matrix row(s) match DATA-MODEL §8')
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
  test('present but not evaluable fails closed', async () => {
    expect((await runPermissionMatrixGate({ fixtureModulePath: moduleFile(`export const x = 1`) })).status).toBe('fail')
    expect((await runPermissionMatrixGate({ fixtureModulePath: moduleFile(`export function generatePermissionMatrix() { throw new Error('x') }`) })).status).toBe('fail')
    expect((await runPermissionMatrixGate({ fixtureModulePath: moduleFile(`export function generatePermissionMatrix() { return {} }`) })).status).toBe('fail')
  })
})
