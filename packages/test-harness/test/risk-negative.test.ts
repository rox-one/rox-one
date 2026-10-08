/** W1-10 self-test: riskClass + negative-test gates with synthetic catalogues. */
import { describe, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkRiskClassPresence } from '../src/gates/risk-class.ts'
import { checkNegativeTestPresence, coveredCommands } from '../src/gates/negative-tests.ts'
import { parseCatalogueSource } from '../src/gates/catalogue.ts'

function dir(prefix: string, files: Record<string, string>): string {
  const d = mkdtempSync(join(tmpdir(), prefix))
  for (const [name, src] of Object.entries(files)) {
    mkdirSync(join(d, name, '..'), { recursive: true })
    writeFileSync(join(d, name), src)
  }
  return d
}

// TECH-SPEC §3.4 shape: id under `type`, nested mcp { name } and emitted events.
const TASKS = `import { z } from 'zod'
export const commands = [
  { type: 'tasks.create', riskClass: 'routine', schema: z.object({ name: z.string() }), mcp: { name: 'tasks.create_tool', description: 'x' } },
  // { type: 'tasks.commented_out' },
  { type: 'tasks.delete', schema: z.object({}), emits: [{ type: 'tasks.deleted' }] },
  { name: 'tasks.update_status', riskClass: 'consequential', field: { type: 'string' } },
]
`
const INDEX = `export * from './tasks.ts'\n`

describe('catalogue parser', () => {
  test('one definition per command object; nested mcp/event objects and comments ignored', () => {
    expect(parseCatalogueSource(TASKS, 'tasks.ts').map((c) => c.id)).toEqual(['tasks.create', 'tasks.delete', 'tasks.update_status'])
  })
})

describe('risk-class gate', () => {
  test('passes when every definition declares riskClass', () => {
    const d = dir('w1-10-cat-', { 'tasks.ts': `export const c = [{ type: 'tasks.create', riskClass: 'routine' }, { type: 'tasks.delete', riskClass: 'privileged' }]`, 'index.ts': INDEX })
    expect(checkRiskClassPresence({ catalogueDir: d }).status).toBe('pass')
  })
  test('checks per definition: one riskClass in the file does not cover the others', () => {
    const res = checkRiskClassPresence({ catalogueDir: dir('w1-10-cat-', { 'tasks.ts': TASKS, 'index.ts': INDEX }) })
    expect(res.status).toBe('fail')
    expect(res.violations).toEqual([`tasks.ts: command 'tasks.delete' declares no riskClass`])
  })
  test('a module file with no discoverable definition fails (fail closed); index.ts alone is absent input', () => {
    const res = checkRiskClassPresence({ catalogueDir: dir('w1-10-cat-', { 'goals.ts': `export const commands = defineAll(['goals.create'])`, 'index.ts': INDEX }) })
    expect(res.status).toBe('fail')
    expect(res.violations?.join(' ')).toContain('no command definition found')
    expect(checkRiskClassPresence({ catalogueDir: dir('w1-10-cat-', { 'index.ts': INDEX }) }).status).toBe('pending')
  })
})

describe('negative-tests gate', () => {
  const catalogue = () => dir('w1-10-cat-', { 'tasks.ts': `export const c = [{ type: 'tasks.create', riskClass: 'routine' }, { type: 'tasks.delete', riskClass: 'routine' }]` })

  test('each command needs its own negative test block', () => {
    const tests = dir('w1-10-neg-', {
      'tasks.test.ts': `
        test('tasks.create permission denied', () => { expect(denied).toBe(true) })
        describe('tasks.delete', () => {
          it('rejects a stale revision with conflict', () => {})
        })`,
    })
    expect(checkNegativeTestPresence({ catalogueDir: catalogue(), testRoots: [tests] }).status).toBe('pass')
  })
  test('id and keyword in different blocks of one file do not count', () => {
    const tests = dir('w1-10-neg-', {
      'tasks.test.ts': `
        test('tasks.create happy path', () => { run('tasks.create') })
        test('tasks.delete happy path', () => {})
        test('some other command is denied', () => { expect(denied).toBe(true) })`,
    })
    const res = checkNegativeTestPresence({ catalogueDir: catalogue(), testRoots: [tests] })
    expect(res.status).toBe('fail')
    expect(res.violations?.length).toBe(2)
  })
  test('one negative test does not cover a sibling command; skip/todo and prefixes do not count', () => {
    const tests = dir('w1-10-neg-', {
      'tasks.test.ts': `
        test('tasks.create quota exceeded', () => {})
        test.todo('tasks.delete permission denied')
        test.skip('tasks.delete conflict', () => {})
        test('tasks.deleteAll conflict', () => {})`,
    })
    const res = checkNegativeTestPresence({ catalogueDir: catalogue(), testRoots: [tests] })
    expect(res.status).toBe('fail')
    expect(res.violations).toEqual([`command 'tasks.delete' has no negative test block (permission/scope/rate-limit/quota/conflict/expiry)`])
  })
  test('the walk ignores symlinks, node_modules and non-test files', () => {
    const real = dir('w1-10-neg-real-', { 'neg.test.ts': `test('tasks.create denied', () => {}); test('tasks.delete denied', () => {})` })
    const roots = dir('w1-10-neg-roots-', {
      'node_modules/pkg/neg.test.ts': `test('tasks.create denied', () => {}); test('tasks.delete denied', () => {})`,
      'src/neg.ts': `test('tasks.create denied', () => {}); test('tasks.delete denied', () => {})`,
    })
    symlinkSync(real, join(roots, 'linked'))
    const res = checkNegativeTestPresence({ catalogueDir: catalogue(), testRoots: [roots] })
    expect(res.status).toBe('fail')
    expect(res.violations?.length).toBe(2)
  })
  test('coveredCommands matches whole ids only', () => {
    expect([...coveredCommands(`test('tasks.create_bulk denied', () => {})`, ['tasks.create'])]).toEqual([])
    expect([...coveredCommands(`test("x", () => { invoke('tasks.create'); expect(r.error.code).toBe('FORBIDDEN') })`, ['tasks.create'])]).toEqual(['tasks.create'])
  })
})
