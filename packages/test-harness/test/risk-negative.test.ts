/**
 * W1-10 self-test: riskClass + negative-test gates against synthetic
 * catalogues in #1500's real shape — `moduleCatalogue(module, flag, [[type,
 * authority], …])` tuples exported as `COMMAND_CATALOGUE`, plus a
 * `createWiredCommandRegistry()` factory (#1507 review 3 contract) that binds
 * every module's handlers / schemas. Command
 * ids use the `zz_fixture.*` namespace so they can never collide with a real
 * catalogue id (the negative-test walk also skips packages/test-harness).
 */
import { describe, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkRiskClassPresence } from '../src/gates/risk-class.ts'
import { checkNegativeTestPresence, collectTestFiles, coveredCommands, EXCLUDED_TEST_DIRS } from '../src/gates/negative-tests.ts'
import { loadCatalogue } from '../src/gates/catalogue.ts'
import { parseAllowlist, shrinkOnlyViolations } from '../src/gates/allowlist.ts'

function dir(prefix: string, files: Record<string, string>): string {
  const d = mkdtempSync(join(tmpdir(), prefix))
  for (const [name, src] of Object.entries(files)) {
    mkdirSync(join(d, name, '..'), { recursive: true })
    writeFileSync(join(d, name), src)
  }
  return d
}

const CAT = 'packages/core/src/commands/catalogue'
const REG = 'packages/server-core/src/commands/registry.ts'

/** Mirrors #1500 catalogue/entry.ts: tuples → CommandDefinition objects with schemaBound: false. */
const ENTRY = `
export function moduleCatalogue(module, flag, entries) {
  return entries.map(([type, authority, verb = 'write', flagOverride]) => {
    const effectiveFlag = flagOverride === undefined ? flag : flagOverride ?? undefined
    const d = { type, module, authority, verb, schema: {}, schemaBound: false }
    if (effectiveFlag) d.flag = effectiveFlag
    return d
  })
}
`
const FIXTURE_MODULE = `
import { moduleCatalogue } from './entry.ts'
export const ZZ_FIXTURE_COMMANDS = moduleCatalogue('zz_fixture', 'zz.fixture.v1', [
  ['zz_fixture.create', 'by-target'],
  ['zz_fixture.delete', 'by-target', 'delete'],
  ['zz_fixture.archive', 'by-target', 'write', null],
])
`
const INDEX = `
import { ZZ_FIXTURE_COMMANDS } from './zz_fixture.ts'
export const COMMAND_CATALOGUE = [...ZZ_FIXTURE_COMMANDS]
`

/**
 * Registry factory in #1500's shape: get(type) / handler(type) / bindSchema.
 * `bindings` lists `[type, { handler?, schema?, riskClass? }]`.
 */
function registrySource(bindings: Array<[string, { handler?: boolean; schema?: boolean; riskClass?: boolean }]>, factory = 'createWiredCommandRegistry'): string {
  return `
import { COMMAND_CATALOGUE } from '../../../core/src/commands/catalogue/index.ts'
export function ${factory}() {
  const defs = new Map(COMMAND_CATALOGUE.map((d) => [d.type, { ...d }]))
  const handlers = new Map()
  const registry = {
    get: (type) => defs.get(type),
    handler: (type) => handlers.get(type),
    list: () => [...defs.values()],
    bind: (type, fn) => { handlers.set(type, fn) },
    bindSchema: (type, schema, opts = {}) => {
      const d = defs.get(type)
      defs.set(type, { ...d, schema, schemaBound: true, ...(opts.riskClass ? { riskClass: opts.riskClass } : {}) })
    },
  }
  for (const [type, b] of ${JSON.stringify(bindings)}) {
    if (b.schema) registry.bindSchema(type, {}, b.riskClass ? { riskClass: () => 'routine' } : {})
    else if (b.riskClass) defs.set(type, { ...defs.get(type), riskClass: () => 'routine' })
    if (b.handler) registry.bind(type, async () => ({ ok: true }))
  }
  return registry
}
`
}

/** `registry`: bindings for a wired registry (default: wired, nothing bound), raw source, or `null` = no registry.ts. */
function repo(opts: { registry?: Parameters<typeof registrySource>[0] | string | null; index?: string; tests?: Record<string, string> } = {}): string {
  const files: Record<string, string> = {
    [`${CAT}/entry.ts`]: ENTRY,
    [`${CAT}/zz_fixture.ts`]: FIXTURE_MODULE,
    [`${CAT}/index.ts`]: opts.index ?? INDEX,
  }
  const registry = opts.registry === undefined ? [] : opts.registry
  if (registry !== null) files[REG] = typeof registry === 'string' ? registry : registrySource(registry)
  for (const [name, src] of Object.entries(opts.tests ?? {})) files[name] = src
  return dir('w1-10-cat-', files)
}

/** No allowlist exceptions, list file absent at base (introducing change): never touches git. */
const NO_ALLOWLIST = { entries: [], baseEntries: null }

describe('runtime catalogue reader', () => {
  test('tuple-form moduleCatalogue entries parse (the real #1500 shape); every entry is unbound while the wired registry binds nothing', async () => {
    const readout = await loadCatalogue({ repoRoot: repo() })
    expect(readout.problems).toEqual([])
    expect(readout.commands.map((c) => [c.type, c.module, c.gated])).toEqual([
      ['zz_fixture.create', 'zz_fixture', false],
      ['zz_fixture.delete', 'zz_fixture', false],
      ['zz_fixture.archive', 'zz_fixture', false],
    ])
    expect(readout.bindingSource).toBe('registry')
  })
  test('bindings and riskClass come from createWiredCommandRegistry() (bindSchema with riskClass, as #1508 does)', async () => {
    const readout = await loadCatalogue({
      repoRoot: repo({ registry: [['zz_fixture.create', { handler: true }], ['zz_fixture.delete', { schema: true, riskClass: true }]] }),
    })
    expect(readout.problems).toEqual([])
    expect(readout.bindingSource).toBe('registry')
    const byType = Object.fromEntries(readout.commands.map((c) => [c.type, c]))
    expect(byType['zz_fixture.create']).toMatchObject({ bound: true, schemaBound: false, gated: true, hasRiskClass: false })
    expect(byType['zz_fixture.delete']).toMatchObject({ bound: false, schemaBound: true, gated: true, hasRiskClass: true })
    expect(byType['zz_fixture.archive']).toMatchObject({ gated: false })
  })
  test('a catalogue that exists but cannot be evaluated is a problem (fail closed)', async () => {
    const throws = await loadCatalogue({ repoRoot: repo({ index: `throw new Error('boom')` }) })
    expect(throws.present).toBe(true)
    expect(throws.problems.join(' ')).toContain('import failed')
    const noExport = await loadCatalogue({ repoRoot: repo({ index: `export const OTHER = []` }) })
    expect(noExport.problems.join(' ')).toContain('must export COMMAND_CATALOGUE')
    const badEntry = await loadCatalogue({ repoRoot: repo({ index: `export const COMMAND_CATALOGUE = [{ type: 'nodot', module: 'x', schemaBound: false }]` }) })
    expect(badEntry.problems.join(' ')).toContain("dotted type")
    const badRegistry = await loadCatalogue({ repoRoot: repo({ registry: `export const nothing = 1` }) })
    expect(badRegistry.problems.join(' ')).toContain('must export createWiredCommandRegistry()')
    const throwing = await loadCatalogue({ repoRoot: repo({ registry: `export function createWiredCommandRegistry() { throw new Error('wiring boom') }` }) })
    expect(throwing.problems.join(' ')).toContain('wiring boom')
    expect(throwing.problems.join(' ')).toContain('createWiredCommandRegistry() failed')
    const unimportable = await loadCatalogue({ repoRoot: repo({ registry: `import './nope.ts'\nexport function createWiredCommandRegistry() {}` }) })
    expect(unimportable.problems.join(' ')).toContain(`${REG}: import failed`)
  })
  test('catalogue present but registry.ts missing fails closed (no silent catalogue-only downgrade)', async () => {
    const root = repo({ registry: null })
    const readout = await loadCatalogue({ repoRoot: root })
    expect(readout.present).toBe(true)
    expect(readout.problems.join(' ')).toContain(`${REG}: missing while ${CAT}/index.ts exists`)
    expect(readout.problems.join(' ')).toContain('merge #1500 before #1507')
    for (const res of [await checkRiskClassPresence({ repoRoot: root, allowlist: NO_ALLOWLIST }), await checkNegativeTestPresence({ repoRoot: root, allowlist: NO_ALLOWLIST })]) {
      expect(res.status).toBe('fail')
      expect(res.violations?.join(' ')).toContain('missing while')
    }
  })
  test('a registry with only the bare createCommandRegistry() (bindings made in callers) fails closed with the contract', async () => {
    const root = repo({ registry: registrySource([['zz_fixture.create', { handler: true, riskClass: true }]], 'createCommandRegistry') })
    const res = await checkRiskClassPresence({ repoRoot: root, allowlist: NO_ALLOWLIST })
    expect(res.status).toBe('fail')
    const text = res.violations?.join(' ') ?? ''
    expect(text).toContain('must export createWiredCommandRegistry()')
    expect(text).toContain('COMMAND_MODULES')
    expect(text).toContain('createCommandRegistry() alone does not see bindings made by callers')
  })
  test('an async createWiredCommandRegistry() is awaited', async () => {
    const src = registrySource([['zz_fixture.create', { handler: true, riskClass: true }]]).replace('export function createWiredCommandRegistry()', 'function wired()')
      + `\nexport async function createWiredCommandRegistry() { return wired() }\n`
    const readout = await loadCatalogue({ repoRoot: repo({ registry: src }) })
    expect(readout.problems).toEqual([])
    expect(readout.commands.find((c) => c.type === 'zz_fixture.create')).toMatchObject({ bound: true, gated: true, hasRiskClass: true })
  })
})

describe('risk-class gate', () => {
  test('pending (never failing) while every command is an unbound placeholder', async () => {
    const res = await checkRiskClassPresence({ repoRoot: repo(), allowlist: NO_ALLOWLIST })
    expect(res.status).toBe('pending')
    expect(res.summary).toContain('3 unbound command(s) pending')
  })
  test('passes when every gated command has riskClass; unbound ones stay out of scope', async () => {
    const root = repo({ registry: [['zz_fixture.create', { handler: true, riskClass: true }], ['zz_fixture.delete', { schema: true, riskClass: true }]] })
    const res = await checkRiskClassPresence({ repoRoot: root, allowlist: NO_ALLOWLIST })
    expect(res.status).toBe('pass')
    expect(res.summary).toContain('2 gated command(s) declare riskClass')
    expect(res.summary).toContain('1 unbound command(s) pending')
  })
  test('a gated command (handler bound or schemaBound) without riskClass fails', async () => {
    const root = repo({ registry: [['zz_fixture.create', { handler: true }], ['zz_fixture.delete', { schema: true }]] })
    const res = await checkRiskClassPresence({ repoRoot: root, allowlist: NO_ALLOWLIST })
    expect(res.status).toBe('fail')
    expect(res.violations).toEqual([
      "command 'zz_fixture.create' (zz_fixture) is gated (handler bound) but has no riskClass",
      "command 'zz_fixture.delete' (zz_fixture) is gated (schemaBound) but has no riskClass",
    ])
  })
  test('pending without a catalogue module', async () => {
    const res = await checkRiskClassPresence({ repoRoot: dir('w1-10-empty-', {}) })
    expect(res.status).toBe('pending')
    expect(res.summary).toContain('#1500')
  })
})

describe('command allowlist (shrink-only)', () => {
  const root = () => repo({ registry: [['zz_fixture.create', { handler: true }], ['zz_fixture.delete', { handler: true, riskClass: true }]] })
  test('an allowlisted gated command is exempt while the entry existed at the merge-base', async () => {
    const res = await checkRiskClassPresence({ repoRoot: root(), allowlist: { entries: ['zz_fixture.create'], baseEntries: ['zz_fixture.create'] } })
    expect(res.status).toBe('pass')
    expect(res.summary).toContain('(1 allowlisted)')
  })
  test('an entry added since the merge-base fails (the list only shrinks)', async () => {
    const res = await checkRiskClassPresence({ repoRoot: root(), allowlist: { entries: ['zz_fixture.create'], baseEntries: [] } })
    expect(res.status).toBe('fail')
    expect(res.violations?.join(' ')).toContain("'zz_fixture.create' was added; the allowlist may only shrink")
  })
  test('stale entries fail: unknown id, not gated yet, or now passing', async () => {
    const entries = ['zz_fixture.create', 'zz_fixture.gone', 'zz_fixture.archive', 'zz_fixture.delete']
    const res = await checkRiskClassPresence({ repoRoot: root(), allowlist: { entries, baseEntries: entries } })
    expect(res.status).toBe('fail')
    expect(res.violations).toEqual([
      "allowlist entry 'zz_fixture.gone' is not a registered command; remove it",
      "allowlist entry 'zz_fixture.archive' is not gated yet (no bound handler, schemaBound false); remove it",
      "allowlist entry 'zz_fixture.delete' now passes; remove it (the allowlist only shrinks)",
    ])
  })
  test('a missing or malformed checked-in list fails closed', async () => {
    const res = await checkRiskClassPresence({ repoRoot: root() })
    expect(res.status).toBe('fail')
    expect(res.violations?.join(' ')).toContain('command-gates.json#riskClass: missing')
    expect(parseAllowlist('{"riskClass": "x"}', 'riskClass').ok).toBe(false)
    expect(parseAllowlist('{"riskClass": ["a", "a"]}', 'riskClass').ok).toBe(false)
    expect(parseAllowlist('{"$comment": "c", "riskClass": []}', 'riskClass')).toEqual({ ok: true, entries: [] })
  })
  test('shrinkOnlyViolations: removals are fine, additions fail, no base file means nothing to grow from', () => {
    expect(shrinkOnlyViolations('l', ['a'], ['a', 'b'])).toEqual([])
    expect(shrinkOnlyViolations('l', ['a', 'c'], ['a'])).toHaveLength(1)
    expect(shrinkOnlyViolations('l', ['a', 'c'], null)).toEqual([])
  })
})

describe('negative-tests gate', () => {
  const registry: Parameters<typeof registrySource>[0] = [['zz_fixture.create', { handler: true }], ['zz_fixture.delete', { schema: true }]]

  test('each gated command needs its own negative block; unbound commands are pending, not failures', async () => {
    const root = repo({
      registry,
      tests: {
        'apps/workspace-service/test/zz.test.ts': `
          test('zz_fixture.create rejects a viewer', async () => { const r = await run('zz_fixture.create'); expect(r.error.code).toBe('FORBIDDEN') })
          describe('zz_fixture.delete', () => {
            it('fails on a stale revision with conflict', () => {})
          })`,
      },
    })
    const res = await checkNegativeTestPresence({ repoRoot: root, allowlist: NO_ALLOWLIST })
    expect(res.status).toBe('pass')
    expect(res.summary).toContain('2 gated command(s) have negative tests')
    expect(res.summary).toContain('1 unbound command(s) pending')
  })
  test('id and negative outcome in different blocks do not count', async () => {
    const root = repo({
      registry,
      tests: {
        'e2e/zz.test.ts': `
          test('zz_fixture.create happy path', () => { run('zz_fixture.create') })
          test('zz_fixture.delete happy path', () => {})
          test('some other command is denied', () => { expect(code).toBe('FORBIDDEN') })`,
      },
    })
    const res = await checkNegativeTestPresence({ repoRoot: root, allowlist: NO_ALLOWLIST })
    expect(res.status).toBe('fail')
    expect(res.violations?.length).toBe(2)
  })
  test('keywords count in titles or as exact error-code tokens, not as identifier substrings in a body', async () => {
    const root = repo({
      registry,
      tests: {
        'e2e/zz.test.ts': `
          test('zz_fixture.create merges', () => { resolveConflict(); const quotaBytes = 1; expect(notExpired).toBe(true); run('zz_fixture.create') })
          test('zz_fixture.delete happy', () => { const deniedCount = 0; expect(r.status).toBe(200) })`,
      },
    })
    const res = await checkNegativeTestPresence({ repoRoot: root, allowlist: NO_ALLOWLIST })
    expect(res.status).toBe('fail')
    expect(res.violations?.length).toBe(2)
    expect([...coveredCommands(`test('x', async () => { expect((await run('zz_fixture.create')).status).toBe(403) })`, ['zz_fixture.create'])]).toEqual(['zz_fixture.create'])
    expect([...coveredCommands(`test('zz_fixture.create is rate limited', () => {})`, ['zz_fixture.create'])]).toEqual(['zz_fixture.create'])
  })
  test('setup calls do not count: only ids in a title or inside the negative assertion call (#1507 review 3)', async () => {
    const ids = ['zz_fixture.create', 'zz_fixture.delete', 'zz_fixture.archive']
    const viewerCannotDelete = `
      test('viewer cannot remove a task', async () => {
        const created = await run('zz_fixture.create', owner)
        await run('zz_fixture.archive', owner, created.id)
        await expect(run('zz_fixture.delete', viewer, created.id)).rejects.toMatchObject({ code: 'FORBIDDEN' })
      })`
    expect([...coveredCommands(viewerCannotDelete, ids)]).toEqual(['zz_fixture.delete'])
    // id asserted in a later statement: no longer counts (name it in the title or inside the assertion).
    expect([...coveredCommands(`test('x', async () => { const r = await run('zz_fixture.create'); expect(r.error.code).toBe('FORBIDDEN') })`, ids)]).toEqual([])
    // a title keyword covers only ids named in titles, not ids in the body.
    expect([...coveredCommands(`describe('zz_fixture.delete', () => { test('is denied for a viewer', async () => { await run('zz_fixture.create'); await run('zz_fixture.delete') }) })`, ids)]).toEqual(['zz_fixture.delete'])
    // helper assertions count like expect(): the id must be inside the helper call.
    expect([...coveredCommands(`test('y', async () => { await run('zz_fixture.create'); await expectDenied(run('zz_fixture.archive'), 'FORBIDDEN') })`, ids)]).toEqual(['zz_fixture.archive'])
    const root = repo({ registry, tests: { 'e2e/zz.test.ts': viewerCannotDelete } })
    const res = await checkNegativeTestPresence({ repoRoot: root, allowlist: NO_ALLOWLIST })
    expect(res.violations).toEqual([
      "command 'zz_fixture.create' (zz_fixture) is gated but has no negative test block (permission/scope/rate-limit/quota/conflict/expiry)",
    ])
  })
  test('a 403 / error code in a mocked response fixture is not a negative outcome', async () => {
    const ids = ['zz_fixture.create', 'zz_fixture.delete']
    const fixture = `
      test('zz_fixture.create renders the response', async () => {
        const server = mockServer({ 'zz_fixture.delete': { status: 403, body: { code: 'FORBIDDEN' } } })
        const r = await run('zz_fixture.create', server)
        expect(r.ok).toBe(true)
      })`
    expect([...coveredCommands(fixture, ids)]).toEqual([])
    const root = repo({ registry, tests: { 'e2e/zz.test.ts': fixture } })
    const res = await checkNegativeTestPresence({ repoRoot: root, allowlist: NO_ALLOWLIST })
    expect(res.violations?.length).toBe(2)
    // a status asserted inside expect() still counts, object-literal matcher included.
    expect([...coveredCommands(`test('z', async () => { expect(await run('zz_fixture.delete')).toMatchObject({ status: 403 }) })`, ids)]).toEqual(['zz_fixture.delete'])
  })
  test('skip/todo blocks and id prefixes do not count', async () => {
    const root = repo({
      registry,
      tests: {
        'e2e/zz.test.ts': `
          test('zz_fixture.create quota exceeded', () => {})
          test.todo('zz_fixture.delete permission denied')
          test.skip('zz_fixture.delete conflict', () => {})
          test('zz_fixture.deleteAll conflict', () => {})`,
      },
    })
    const res = await checkNegativeTestPresence({ repoRoot: root, allowlist: NO_ALLOWLIST })
    expect(res.status).toBe('fail')
    expect(res.violations).toEqual([
      "command 'zz_fixture.delete' (zz_fixture) is gated but has no negative test block (permission/scope/rate-limit/quota/conflict/expiry)",
    ])
    expect([...coveredCommands(`test('zz_fixture.create_bulk denied', () => {})`, ['zz_fixture.create'])]).toEqual([])
  })
  test('the walk skips packages/test-harness (self-test fixtures), symlinks, node_modules and non-test files', async () => {
    const covering = `test('zz_fixture.create denied', () => {}); test('zz_fixture.delete denied', () => {})`
    const outside = dir('w1-10-neg-real-', { 'neg.test.ts': covering })
    const root = repo({
      registry,
      tests: {
        'packages/test-harness/test/neg.test.ts': covering,
        'packages/pkg/node_modules/dep/neg.test.ts': covering,
        'packages/pkg/src/neg.ts': covering,
      },
    })
    symlinkSync(outside, join(root, 'packages', 'linked'))
    const res = await checkNegativeTestPresence({ repoRoot: root, allowlist: NO_ALLOWLIST })
    expect(res.status).toBe('fail')
    expect(res.violations?.length).toBe(2)
    const files: string[] = []
    collectTestFiles(join(root, 'packages'), files, { root, exclude: EXCLUDED_TEST_DIRS })
    expect(files).toEqual([])
  })
  test('the negativeTests allowlist exempts a gated command (shrink-only)', async () => {
    const root = repo({ registry, tests: { 'e2e/zz.test.ts': `test('zz_fixture.create denied', () => {})` } })
    const res = await checkNegativeTestPresence({ repoRoot: root, allowlist: { entries: ['zz_fixture.delete'], baseEntries: ['zz_fixture.delete'] } })
    expect(res.status).toBe('pass')
    expect(res.summary).toContain('(1 allowlisted)')
  })
})
