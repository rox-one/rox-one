/**
 * DX-04 mechanics: bounded-parallel execution, deterministic shards and the
 * known-red baseline that turns "132 red" into "no new failures".
 *
 * These exercise the real CLI where wiring matters (exit codes, --shard,
 * --update-baseline) and the runSuites API where classification matters.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

const runnerPath = join(import.meta.dir, '..', 'test-all.ts')
const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'rox-test-baseline-'))
  roots.push(root)
  return root
}
function file(root: string, path: string, source: string) {
  const absolute = join(root, path)
  mkdirSync(dirname(absolute), { recursive: true })
  writeFileSync(absolute, source)
}
async function runner() {
  return import(pathToFileURL(runnerPath).href) as Promise<typeof import('../test-all')>
}
const PASSING = "import {test} from 'bun:test'; test('passing',()=>{});"
const FAILING = "import {test,expect} from 'bun:test'; test('failing',()=>expect(1).toBe(2));"

describe('shard partitioning', () => {
  test('parseShard accepts k/n and rejects malformed or out-of-range values', async () => {
    const api = await runner()
    expect(api.parseShard('2/4')).toEqual({ index: 2, total: 4 })
    for (const value of ['0/4', '4/0', '1', '1/2/3', '-1/2', '2/1', 'a/b', '']) {
      expect(() => api.parseShard(value)).toThrow()
    }
  })

  test('shards partition the sorted suite list exactly once and deterministically', async () => {
    const api = await runner()
    const root = fixture()
    for (const name of ['a', 'b', 'c', 'd', 'e']) file(root, `tests/${name}.test.ts`, PASSING)
    const suites = (await api.discoverSuites(root)).suites
    const shards = [1, 2, 3].map(index => api.shardSuites(suites, { index, total: 3 }))
    expect(shards.map(s => s.map(suite => suite.path))).toEqual([
      ['tests/a.test.ts', 'tests/d.test.ts'],
      ['tests/b.test.ts', 'tests/e.test.ts'],
      ['tests/c.test.ts'],
    ])
    const union = shards.flat().map(suite => suite.path).sort()
    expect(union).toEqual(suites.map(suite => suite.path))
    expect(new Set(union).size).toBe(suites.length)
  })
})

describe('bounded parallelism', () => {
  test('concurrent suites overlap in time; results stay in manifest order', async () => {
    const root = fixture()
    const marker = join(root, 'marker.txt')
    writeFileSync(marker, '')
    // Each suite (its own OS process) polls for the other's entry marker, so an
    // overlap is proven by cross-process evidence rather than a fixed sleep;
    // fake timers cannot cross the child-process boundary this test measures.
    const peerWaiting = (id: string) => `import {test,expect} from 'bun:test'
import {appendFileSync, readFileSync, existsSync} from 'node:fs'
test('overlap', async () => {
  appendFileSync(${JSON.stringify(marker)}, 'enter ${id}\\n')
  const deadline = Date.now() + 4000
  let sawPeer = false
  while (Date.now() < deadline) {
    if (existsSync(${JSON.stringify(marker)}) && readFileSync(${JSON.stringify(marker)}, 'utf8').includes('enter ${id === 'a' ? 'b' : 'a'}')) { sawPeer = true; break }
    await Bun.sleep(25)
  }
  expect(sawPeer).toBe(true)
});`
    file(root, 'tests/a.test.ts', peerWaiting('a'))
    file(root, 'tests/z.test.ts', peerWaiting('b'))
    const api = await runner()
    const manifest = await api.discoverSuites(root)
    const report = await api.runSuites({ root, manifest, artifactDirectory: join(root, 'evidence'), concurrency: 2 })
    expect(report.status).toBe('passed')
    expect(report.concurrency).toBe(2)
    expect(report.serial).toBe(false)
    expect(report.results.map(result => result.path)).toEqual(['tests/a.test.ts', 'tests/z.test.ts'])
    expect(readFileSync(marker, 'utf8')).toContain('enter a')
    expect(readFileSync(marker, 'utf8')).toContain('enter b')
  }, 30_000)

  test('rejects an out-of-range concurrency before creating any evidence', async () => {
    const root = fixture()
    file(root, 'tests/never.test.ts', PASSING)
    const api = await runner()
    const manifest = await api.discoverSuites(root)
    for (const concurrency of [0, -1, 1.5, api.MAX_CONCURRENCY + 1]) {
      await expect(api.runSuites({ root, manifest, artifactDirectory: join(root, 'evidence'), concurrency })).rejects.toThrow('Concurrency')
    }
    expect(existsSync(join(root, 'evidence'))).toBe(false)
  })
})

describe('known-red baseline', () => {
  test('a baseline suite that fails is expected: the run passes with no new failures', async () => {
    const root = fixture()
    file(root, 'tests/green.test.ts', PASSING)
    file(root, 'tests/red.test.ts', FAILING)
    const api = await runner()
    const manifest = await api.discoverSuites(root)
    const options = { root, manifest, artifactDirectory: join(root, 'evidence') }
    const withoutBaseline = await api.runSuites(options)
    expect(withoutBaseline.status).toBe('failed')
    expect(withoutBaseline.summary).toMatchObject({ failed: 1, passed: 1, newFailures: 1, knownRed: 0 })
    expect(withoutBaseline.baseline.newFailures).toEqual(['tests/red.test.ts'])

    const withBaseline = await api.runSuites({ ...options, baseline: new Set(['tests/red.test.ts']), baselinePath: 'scripts/test-baseline.json' })
    expect(withBaseline.status).toBe('passed')
    expect(withBaseline.summary).toMatchObject({ failed: 1, passed: 1, newFailures: 0, knownRed: 1, stalePass: 0 })
    expect(withBaseline.baseline.path).toBe('scripts/test-baseline.json')
    expect(withBaseline.baseline.knownRed).toEqual(['tests/red.test.ts'])
    expect(withBaseline.results.find(result => result.path === 'tests/red.test.ts')?.knownRed).toBe(true)
    expect(withBaseline.results.find(result => result.path === 'tests/green.test.ts')?.knownRed).toBe(false)
  }, 20_000)

  test('a failure outside the baseline is a regression, and a red baseline entry that now passes is stale', async () => {
    const root = fixture()
    file(root, 'tests/green.test.ts', PASSING)
    file(root, 'tests/red.test.ts', FAILING)
    const api = await runner()
    const manifest = await api.discoverSuites(root)
    const report = await api.runSuites({ root, manifest, artifactDirectory: join(root, 'evidence'), baseline: new Set(['tests/green.test.ts', 'tests/gone.test.ts']) })
    expect(report.status).toBe('failed')
    expect(report.baseline.newFailures).toEqual(['tests/red.test.ts'])
    expect(report.baseline.stalePass).toEqual(['tests/green.test.ts'])
    expect(report.summary).toMatchObject({ newFailures: 1, knownRed: 0, stalePass: 1 })
  }, 20_000)

  test('strict mode fails on any red suite even when the baseline excuses it', async () => {
    const root = fixture()
    file(root, 'tests/red.test.ts', FAILING)
    const api = await runner()
    const manifest = await api.discoverSuites(root)
    const report = await api.runSuites({ root, manifest, artifactDirectory: join(root, 'evidence'), baseline: new Set(['tests/red.test.ts']), strict: true })
    expect(report.status).toBe('failed')
    expect(report.summary.newFailures).toBe(0)
  }, 20_000)

  test('loadBaseline validates schema and writeBaseline round-trips sorted, de-duplicated paths', async () => {
    const root = fixture()
    const api = await runner()
    const path = join(root, 'baseline.json')
    await api.writeBaseline(path, ['b.test.ts', 'a.test.ts', 'b.test.ts'], 'test baseline')
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ schemaVersion: 1, description: 'test baseline', knownRed: ['a.test.ts', 'b.test.ts'] })
    expect(await api.loadBaseline(path)).toEqual({ schemaVersion: 1, description: 'test baseline', knownRed: ['a.test.ts', 'b.test.ts'] })
    expect(await api.loadBaseline(join(root, 'absent.json'))).toBeNull()
    writeFileSync(path, JSON.stringify({ schemaVersion: 2, knownRed: [] }))
    await expect(api.loadBaseline(path)).rejects.toThrow('schemaVersion 1')
    writeFileSync(path, '{ not json')
    await expect(api.loadBaseline(path)).rejects.toThrow('not valid JSON')
  })
})

describe('CLI wiring', () => {
  test('--list reports the sharded file count without executing tests', async () => {
    const root = fixture()
    file(root, 'tests/a.test.ts', "import {test} from 'bun:test'; test('never invoked',()=>{throw Error('listing executed')});")
    file(root, 'tests/b.test.ts', "import {test} from 'bun:test'; test('never invoked either',()=>{throw Error('listing executed')});")
    const api = await runner()
    const run = (args: string[]) => api.captureTestCommand([process.execPath, runnerPath, '--root', root, '--list', ...args], { cwd: import.meta.dir, environment: { ...process.env, ROX_TEST_ARTIFACT_DIR: join(root, 'evidence') } })
    const whole = await run([])
    expect(whole.exitCode).toBe(0)
    expect(JSON.parse(whole.stdout.trim())).toMatchObject({ status: 'listed', files: 2, shard: null })
    const sharded = await run(['--shard=2/2'])
    expect(sharded.exitCode).toBe(0)
    expect(JSON.parse(sharded.stdout.trim())).toMatchObject({ status: 'listed', files: 1, shard: { index: 2, total: 2 } })
  }, 20_000)

  test('--update-baseline records the current red suites and the run then passes', async () => {
    const root = fixture()
    file(root, 'tests/green.test.ts', PASSING)
    file(root, 'tests/red.test.ts', FAILING)
    const api = await runner()
    const baselinePath = join(root, 'scripts', 'test-baseline.json')
    const environment = { ...process.env, ROX_TEST_ARTIFACT_DIR: join(root, 'evidence') }
    const update = await api.captureTestCommand([process.execPath, runnerPath, '--root', root, '--baseline', baselinePath, '--update-baseline'], { cwd: import.meta.dir, environment })
    expect(update.exitCode).toBe(0)
    expect(JSON.parse(update.stdout.trim())).toMatchObject({ status: 'baseline-updated', knownRed: 1 })
    expect(JSON.parse(readFileSync(baselinePath, 'utf8')).knownRed).toEqual(['tests/red.test.ts'])
    const second = await api.captureTestCommand([process.execPath, runnerPath, '--root', root, '--baseline', baselinePath, '--concurrency', '2'], { cwd: import.meta.dir, environment })
    expect(second.exitCode).toBe(0)
    const receipt = JSON.parse(second.stdout.trim())
    expect(receipt).toMatchObject({ status: 'passed', concurrency: 2 })
    expect(receipt.summary).toMatchObject({ passed: 1, failed: 1, newFailures: 0, knownRed: 1 })
    expect(receipt.baseline.knownRed).toEqual(['tests/red.test.ts'])
    // The progress log lives on stderr so stdout stays one deterministic JSON receipt.
    expect(second.stderr).toContain('known-red')
  }, 30_000)

  test('--strict fails the CLI on a baseline-excused red suite', async () => {
    const root = fixture()
    file(root, 'tests/red.test.ts', FAILING)
    const api = await runner()
    const baselinePath = join(root, 'baseline.json')
    writeFileSync(baselinePath, JSON.stringify({ schemaVersion: 1, knownRed: ['tests/red.test.ts'] }))
    const lenient = await api.captureTestCommand([process.execPath, runnerPath, '--root', root, '--baseline', baselinePath], { cwd: import.meta.dir, environment: { ...process.env, ROX_TEST_ARTIFACT_DIR: join(root, 'evidence') } })
    expect(lenient.exitCode).toBe(0)
    const strict = await api.captureTestCommand([process.execPath, runnerPath, '--root', root, '--baseline', baselinePath, '--strict'], { cwd: import.meta.dir, environment: { ...process.env, ROX_TEST_ARTIFACT_DIR: join(root, 'evidence') } })
    expect(strict.exitCode).toBe(1)
    expect(JSON.parse(strict.stdout.trim()).status).toBe('failed')
  }, 30_000)
})

describe('fixed-port ownership', () => {
  test('fixedPorts extracts owned literal ports and ignores dynamic or out-of-range values', async () => {
    const api = await runner()
    expect(api.fixedPorts("use: { baseURL: 'http://127.0.0.1:4176' }\nwebServer: { port: 4177 }\nconst playgroundPort = 5192\n--port', '5189'"))
      .toEqual([4176, 4177, 5189, 5192])
    expect(api.fixedPorts("--port','0'\nport: 80\nlocalhost:70000")).toEqual([])
  })

  test('discovery records a Playwright config port and a spawning Bun fixture port, but not a client-only URL', async () => {
    const root = fixture()
    file(root, 'e2e/playwright.config.ts', "export default { use: { baseURL: 'http://127.0.0.1:61234' } }")
    file(root, 'e2e/one.spec.ts', "import {test} from '@playwright/test'; test('x',()=>{});")
    // Split the marker so this test file's own text is not itself read as a
    // spawning fixture; the written file still contains a real child-process call.
    const spawnName = 'sp' + 'awn'
    file(root, 'bun/owns.test.ts', `import {test} from 'bun:test'\nimport {${spawnName}} from 'node:child_process'\nconst origin='http://127.0.0.1:61235'\ntest('x',()=>{ void ${spawnName}(process.execPath); void origin });`)
    file(root, 'bun/client.test.ts', "import {test} from 'bun:test'\nconst endpoint='http://127.0.0.1:61236'\ntest('x',()=>{void endpoint});")
    const api = await runner()
    const suites = (await api.discoverSuites(root)).suites
    const ports = (path: string) => suites.find(suite => suite.path === path)?.ports
    expect(ports('e2e/one.spec.ts')).toEqual([61234])
    expect(ports('bun/owns.test.ts')).toEqual([61235])
    // A client-only reference is not ownership: the suite stays parallel.
    expect(ports('bun/client.test.ts')).toEqual([])
  }, 20_000)

  test('two suites that own the same fixed port never overlap at --concurrency 2', async () => {
    const root = fixture()
    const marker = join(root, 'windows.txt')
    writeFileSync(marker, '')
    // Each suite runs in its own OS process, so an overlap can only be observed
    // through real elapsed time across the process boundary; fake timers cannot
    // reach the children this lease is meant to separate.
    const windowed = (id: string) => `import {test} from 'bun:test'
import {appendFileSync} from 'node:fs'
test('window', async () => {
  appendFileSync(${JSON.stringify(marker)}, 'start ${id}\\n')
  await Bun.sleep(600)
  appendFileSync(${JSON.stringify(marker)}, 'end ${id}\\n')
});`
    file(root, 'tests/a.test.ts', windowed('a'))
    file(root, 'tests/z.test.ts', windowed('z'))
    const api = await runner()
    const manifest = await api.discoverSuites(root)
    for (const suite of manifest.suites) suite.ports = [61301]
    const report = await api.runSuites({ root, manifest, artifactDirectory: join(root, 'evidence'), concurrency: 2 })
    expect(report.status).toBe('passed')
    const events = readFileSync(marker, 'utf8').trim().split('\n')
    expect(events).toHaveLength(4)
    const active = new Set<string>()
    for (const event of events) {
      const [kind, id] = event.split(' ')
      if (kind === 'start') { expect(active.size).toBe(0); active.add(id!) }
      else { expect(active.has(id!)).toBe(true); active.delete(id!) }
    }
  }, 30_000)

  test('suites that own different ports still overlap at --concurrency 2', async () => {
    const root = fixture()
    const marker = join(root, 'overlap.txt')
    writeFileSync(marker, '')
    const peerWaiting = (id: string) => `import {test,expect} from 'bun:test'
import {appendFileSync, readFileSync, existsSync} from 'node:fs'
test('overlap', async () => {
  appendFileSync(${JSON.stringify(marker)}, 'enter ${id}\\n')
  const deadline = Date.now() + 4000
  let sawPeer = false
  while (Date.now() < deadline) {
    if (existsSync(${JSON.stringify(marker)}) && readFileSync(${JSON.stringify(marker)}, 'utf8').includes('enter ${id === 'a' ? 'z' : 'a'}')) { sawPeer = true; break }
    await Bun.sleep(25)
  }
  expect(sawPeer).toBe(true)
});`
    file(root, 'tests/a.test.ts', peerWaiting('a'))
    file(root, 'tests/z.test.ts', peerWaiting('z'))
    const api = await runner()
    const manifest = await api.discoverSuites(root)
    manifest.suites[0]!.ports = [61302]
    manifest.suites[1]!.ports = [61303]
    const report = await api.runSuites({ root, manifest, artifactDirectory: join(root, 'evidence'), concurrency: 2 })
    expect(report.status).toBe('passed')
  }, 30_000)
})

describe('update-baseline guard', () => {
  test('--update-baseline refuses a sharded or filtered subset unless forced', async () => {
    const root = fixture()
    file(root, 'tests/red.test.ts', FAILING)
    const api = await runner()
    const baselinePath = join(root, 'baseline.json')
    const environment = { ...process.env, ROX_TEST_ARTIFACT_DIR: join(root, 'evidence') }
    const run = (args: string[]) => api.captureTestCommand([process.execPath, runnerPath, '--root', root, '--baseline', baselinePath, ...args], { cwd: import.meta.dir, environment })
    const sharded = await run(['--update-baseline', '--shard=1/2'])
    expect(sharded.exitCode).not.toBe(0)
    expect(sharded.stderr).toContain('--force-subset-baseline')
    expect(existsSync(baselinePath)).toBe(false)
    const filtered = await run(['--update-baseline', '--filter', 'red'])
    expect(filtered.exitCode).not.toBe(0)
    expect(existsSync(baselinePath)).toBe(false)
    const forced = await run(['--update-baseline', '--shard=1/2', '--force-subset-baseline'])
    expect(forced.exitCode).toBe(0)
    expect(JSON.parse(readFileSync(baselinePath, 'utf8')).knownRed).toEqual(['tests/red.test.ts'])
  }, 30_000)
})