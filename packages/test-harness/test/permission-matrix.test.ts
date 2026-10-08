/** W1-10 self-test: permission-matrix gate with fixture modules. */
import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { runPermissionMatrixGate } from '../src/gates/permission-matrix.ts'

const dir = join(import.meta.dir, 'fixture-data')

describe('permission-matrix gate', () => {
  test('passes on a well-formed matrix', async () => {
    const res = await runPermissionMatrixGate({ fixtureModulePath: join(dir, 'matrix-good.ts') })
    expect(res.status).toBe('pass')
  })
  test('fails on duplicate rows', async () => {
    const res = await runPermissionMatrixGate({ fixtureModulePath: join(dir, 'matrix-bad.ts') })
    expect(res.status).toBe('fail')
    expect(res.violations?.join(' ')).toContain('duplicate')
  })
})
