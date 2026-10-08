/** W1-10 self-test: riskClass + negative-test gates with synthetic catalogues. */
import { describe, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkRiskClassPresence } from '../src/gates/risk-class.ts'
import { checkNegativeTestPresence } from '../src/gates/negative-tests.ts'

function catalogue(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'w1-10-cat-'))
  mkdirSync(dir, { recursive: true })
  for (const [name, src] of Object.entries(files)) writeFileSync(join(dir, name), src)
  return dir
}

const WITH_RISK = `export const def = { name: 'tasks.create', riskClass: 'routine' as const };`
const WITHOUT_RISK = `export const def = { name: 'tasks.create' };`

describe('risk-class gate', () => {
  test('passes when every definition declares riskClass', () => {
    const dir = catalogue({ 'tasks-create.ts': WITH_RISK })
    expect(checkRiskClassPresence({ catalogueDir: dir }).status).toBe('pass')
  })
  test('fails on a definition without riskClass', () => {
    const dir = catalogue({ 'tasks-create.ts': WITHOUT_RISK })
    const res = checkRiskClassPresence({ catalogueDir: dir })
    expect(res.status).toBe('fail')
    expect(res.violations?.join(' ')).toContain('riskClass')
  })
})

describe('negative-tests gate', () => {
  test('passes when a negative test mentions the command', () => {
    const dir = catalogue({ 'tasks-create.ts': WITH_RISK })
    const tests = mkdtempSync(join(tmpdir(), 'w1-10-neg-'))
    writeFileSync(
      join(tests, 'tasks-create.test.ts'),
      `test('tasks.create permission denied', () => { expect(denied).toBe(true) })`,
    )
    expect(checkNegativeTestPresence({ catalogueDir: dir, testRoots: [tests] }).status).toBe('pass')
  })
  test('fails when no negative test covers the command', () => {
    const dir = catalogue({ 'tasks-create.ts': WITH_RISK })
    const tests = mkdtempSync(join(tmpdir(), 'w1-10-neg-empty-'))
    writeFileSync(join(tests, 'other.test.ts'), `test('unrelated', () => {})`)
    const res = checkNegativeTestPresence({ catalogueDir: dir, testRoots: [tests] })
    expect(res.status).toBe('fail')
    expect(res.violations?.join(' ')).toContain('tasks.create')
  })
})
