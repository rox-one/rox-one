import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

const runnerPath = join(import.meta.dir, 'test-all.ts')
const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'rox-test-runner-'))
  roots.push(root)
  return root
}
function file(root: string, path: string, source: string) {
  const absolute = join(root, path)
  mkdirSync(dirname(absolute), { recursive: true })
  writeFileSync(absolute, source)
}
async function runner() {
  // A missing runner is an observable missing feature, not an import-time error.
  expect(existsSync(runnerPath)).toBe(true)
  return import(pathToFileURL(runnerPath).href) as Promise<typeof import('./test-all')>
}

describe('UI-001 repository test runner', () => {
  test('actual fast-exit Git, Node and Bun commands retain stdout, stderr and real failure codes', async () => {
    const root = fixture(), api = await runner()
    const git = await api.captureTestCommand(['git', '--version'], { cwd: root })
    expect(git.exitCode).toBe(0)
    expect(git.stdout).toMatch(/^git version .+\n$/)
    expect(git.stderr).toBe('')
    for (const executable of ['node', process.execPath]) {
      const source = "const {writeSync}=require('node:fs'); writeSync(1,'fast-stdout-é\\n'); writeSync(2,'fast-stderr-é\\n'); process.exit(7)"
      const child = await api.captureTestCommand([executable, '--eval', source], { cwd: root })
      expect({ exit: child.exitCode, signal: child.signal, stdout: child.stdout, stderr: child.stderr })
        .toEqual({ exit: 7, signal: null, stdout: 'fast-stdout-é\n', stderr: 'fast-stderr-é\n' })
      expect(child.nodeVersion).toMatch(/^v\d+\.\d+\.\d+$/)
    }
    const payload = 'drained-output-'.repeat(20_000)
    const drained = await api.captureTestCommand(['node', '--eval', "process.stdout.write('drained-output-'.repeat(20000)); process.stderr.write('stderr-drained'); process.exitCode=3"], { cwd: root })
    expect({ exit: drained.exitCode, stdout: drained.stdout, stderr: drained.stderr })
      .toEqual({ exit: 3, stdout: payload, stderr: 'stderr-drained' })
    await expect(api.captureTestCommand([join(root, 'missing-executable')])).rejects.toThrow('Command capture failed')
  }, 20_000)

  test('Git inventory retains tracked and new source suites while excluding ignored generated copies', async () => {
    const root = fixture()
    const git = (...args: string[]) => {
      const child = Bun.spawnSync(['git', ...args], { cwd: root, stdout: 'pipe', stderr: 'pipe' })
      expect({ exit: child.exitCode, stderr: child.stderr.toString() }).toMatchObject({ exit: 0 })
    }
    git('init', '--quiet')
    const bun = "import {test} from 'bun:test'; test('source coverage',()=>{});"
    file(root, '.gitignore', 'dist/\nwork/\n')
    file(root, 'src/tracked.test.ts', bun)
    file(root, 'src/.hidden/required.isolated.ts', bun)
    file(root, 'src/.hidden/ordinary.test.ts', bun)
    file(root, 'dist/intentional.isolated.ts', bun)
    git('add', '--force', '.gitignore', 'src/tracked.test.ts', 'src/.hidden/required.isolated.ts', 'src/.hidden/ordinary.test.ts', 'dist/intentional.isolated.ts')
    // Actual source copies remain separate suites, even with identical bytes.
    file(root, 'src/new-copy.test.ts', bun)
    file(root, 'src/name with space.test.ts', bun)
    const unusualName = process.platform === 'win32' ? 'src/name-é.test.ts' : 'src/name\nwith newline.test.ts'
    file(root, unusualName, bun)
    file(root, 'dist/resources/skills/copied.test.ts', bun)
    file(root, 'work/native-profile/config/skills/copied.test.ts', bun)
    file(root, 'node_modules/dependency/copied.test.ts', bun)
    const manifest = await (await runner()).discoverSuites(root)
    expect(manifest.suites.map(suite => suite.path)).toEqual([
      'dist/intentional.isolated.ts', 'src/.hidden/required.isolated.ts',
      unusualName, 'src/name with space.test.ts', 'src/new-copy.test.ts', 'src/tracked.test.ts',
    ].sort())
    expect(manifest.discovery).toMatchObject({ inventory: 'git-ls-files', hiddenStandardFiles: 1 })
    expect(new Set(manifest.suites.map(suite => suite.sha256)).size).toBe(1)
    expect(manifest.suites.every(suite => suite.runner === 'bun')).toBe(true)
  })

  test('a damaged Git inventory fails instead of executing ignored copies through filesystem fallback', async () => {
    const root = fixture()
    const git = (...args: string[]) => {
      const child = Bun.spawnSync(['git', ...args], { cwd: root, stdout: 'pipe', stderr: 'pipe' })
      expect({ exit: child.exitCode, stderr: child.stderr.toString() }).toMatchObject({ exit: 0 })
    }
    git('init', '--quiet')
    file(root, '.gitignore', 'dist/\n')
    file(root, 'src/required.test.ts', "import {test} from 'bun:test'; test('required',()=>{});")
    file(root, 'dist/generated.test.ts', "import {test} from 'bun:test'; test('must not discover',()=>{});")
    git('add', '.gitignore', 'src/required.test.ts')
    writeFileSync(join(root, '.git/index'), 'damaged-index-negative-control')
    await expect((await runner()).discoverSuites(root)).rejects.toThrow('Git test inventory unavailable')
  })

  test('an empty Git inventory or direct API manifest cannot become an empty successful run', async () => {
    const root = fixture(), api = await runner()
    const manifest = await api.discoverSuites(root)
    expect(manifest.suites).toEqual([])
    await expect(api.runSuites({ root, manifest, artifactDirectory: join(root, 'evidence') })).rejects.toThrow('refusing an empty green run')
    expect(existsSync(join(root, 'evidence'))).toBe(false)
    const git = Bun.spawnSync(['git', 'init', '--quiet'], { cwd: root, stdout: 'pipe', stderr: 'pipe' })
    expect(git.exitCode).toBe(0)
    await expect(api.discoverSuites(root)).rejects.toThrow('Git test inventory is empty')
  })

  test('keeps all Bun filename forms and supplemental isolated files while routing actual Playwright tests', async () => {
    const root = fixture()
    const bun = "import {test} from 'bun:test'; test('covered',()=>{});"
    for (const name of ['a.test.js', 'b_test.jsx', 'c.spec.ts', 'd_spec.tsx', 'e.test.mjs', 'f.test.cjs', 'g.spec.mts', 'h_spec.cts', 'i.isolated.ts']) file(root, 'tests/' + name, bun)
    file(root, 'tests/browser/playwright.config.ts', 'export default {testDir: "."}')
    file(root, 'tests/browser/live.spec.ts', "import {test as e2e} from '@playwright/test'; e2e('real runner',async()=>{});")
    file(root, 'tests/browser/library.test.ts', "import {test} from 'bun:test'; import {chromium} from '@playwright/test'; test('library',()=>{});")
    file(root, 'tests/.hidden/hidden.test.ts', bun)
    file(root, 'tests/.hidden/supplemental.isolated.ts', bun)
    file(root, 'node_modules/dependency/dependency.test.ts', bun)
    file(root, 'tests/browser/not-a-test.ts', bun)
    const manifest = await (await runner()).discoverSuites(root)
    expect(manifest.discovery.inventory).toBe('filesystem-fallback')
    expect(manifest.suites.filter(suite => suite.runner === 'bun').map(suite => suite.path)).toEqual([
      'tests/.hidden/supplemental.isolated.ts', 'tests/a.test.js', 'tests/b_test.jsx', 'tests/browser/library.test.ts',
      'tests/c.spec.ts', 'tests/d_spec.tsx', 'tests/e.test.mjs', 'tests/f.test.cjs', 'tests/g.spec.mts', 'tests/h_spec.cts', 'tests/i.isolated.ts',
    ])
    expect(manifest.suites.filter(suite => suite.runner === 'playwright')).toMatchObject([
      { path: 'tests/browser/live.spec.ts', config: 'tests/browser/playwright.config.ts' },
    ])
    expect(manifest.suites.some(suite => suite.path.includes('dependency') || suite.path.includes('hidden.test'))).toBe(false)
    expect(manifest.suites.every(suite => /^[a-f0-9]{64}$/.test(suite.sha256))).toBe(true)
  })

  test('a missing Playwright configuration stays an explicit failed prerequisite instead of becoming Bun or disappearing', async () => {
    const root = fixture()
    file(root, 'tests/live.spec.ts', "import {test} from '@playwright/test'; test('required',()=>{});")
    const api = await runner()
    const manifest = await api.discoverSuites(root)
    expect(manifest.suites).toMatchObject([{ runner: 'playwright', path: 'tests/live.spec.ts', prerequisiteError: expect.stringContaining('config') }])
    const report = await api.runSuites({ root, manifest, artifactDirectory: join(root, 'evidence') })
    expect(report.status).toBe('failed')
    expect(report.results).toMatchObject([{ status: 'blocked', path: 'tests/live.spec.ts' }])
    expect(report.summary.blocked).toBe(1)
  })

  test('runtime Bun imports using the Chromium library keep their Bun executor', async () => {
    const root = fixture()
    file(root, 'tests/library.test.ts', "const {test}=require('bun:test'); import {chromium} from '@playwright/test'; test('Bun owns this test',()=>{});")
    file(root, 'tests/dynamic.test.mts', "const {test}=await import('bun:test'); import {chromium} from '@playwright/test'; test('Bun owns this test',()=>{});")
    const manifest = await (await runner()).discoverSuites(root)
    expect(manifest.suites).toMatchObject([{ path: 'tests/dynamic.test.mts', runner: 'bun' }, { path: 'tests/library.test.ts', runner: 'bun' }])
  })

  test('type-only foreign runner imports do not change a Bun executor', async () => {
    const root = fixture()
    file(root, 'tests/types.test.ts', "import /* gap */ type {Page} from '@playwright/test'; import type {TestContext} from 'vitest'; const text=\"import type {test} from 'bun:test'\"; test('global Bun test',()=>{});")
    const manifest = await (await runner()).discoverSuites(root)
    expect(manifest.suites).toMatchObject([{ path: 'tests/types.test.ts', runner: 'bun' }])
    expect(manifest.suites[0]!.prerequisiteError).toBeUndefined()
  })

  test('foreign Vitest suites retain their own configuration and never disappear from the manifest', async () => {
    const root = fixture()
    file(root, 'embedded/package.json', '{"name":"embedded","scripts":{"test":"vitest run"}}')
    file(root, 'embedded/vitest.config.ts', 'export default {test:{}}')
    file(root, 'embedded/src/required.test.ts', "import {test} from 'vitest'; test('required foreign executor',()=>{});")
    const api = await runner()
    const manifest = await api.discoverSuites(root)
    expect(manifest.suites).toMatchObject([{ path: 'embedded/src/required.test.ts', runner: 'vitest', config: 'embedded/vitest.config.ts', packageRoot: 'embedded' }])
    const report = await api.runSuites({ root, manifest, artifactDirectory: join(root, 'evidence') })
    expect(report.status).toBe('failed')
    expect(report.results).toMatchObject([{ status: 'blocked', error: expect.stringContaining('Vitest') }])
  }, 20_000)

  test('embedded Vitest uses its package cwd and explicit executable without changing the repository Node', async () => {
    const root = fixture()
    file(root, 'embedded/package.json', '{"name":"embedded"}')
    file(root, 'embedded/vitest.config.ts', 'export default {test:{}}')
    file(root, 'embedded/src/required.test.ts', "import {test} from 'vitest'; test('required',()=>{});")
    file(root, 'embedded/node_modules/vitest/vitest.mjs', `import assert from 'node:assert/strict'; import {realpathSync} from 'node:fs';
      assert.equal(realpathSync(process.cwd()), realpathSync(new URL('../..',import.meta.url).pathname));
      assert.equal(process.argv[2], 'run'); assert.equal(process.argv[3], 'src/required.test.ts'); console.log('embedded-cwd-control-passed');`)
    const api = await runner(), manifest = await api.discoverSuites(root)
    const node = Bun.which('node')!
    const report = await api.runSuites({ root, manifest, artifactDirectory: join(root, 'evidence'),
      environment: { ...process.env, ROX_TEST_VITEST_NODE_EXECUTABLE: node } })
    expect(report.status).toBe('passed')
    expect(report.results[0]!.command[0]).toBe(node)
    expect(readFileSync(report.results[0]!.log, 'utf8')).toContain('embedded-cwd-control-passed')
    for (const executable of ['relative-node', root]) {
      const invalid = await api.runSuites({ root, manifest, artifactDirectory: join(root, 'evidence'),
        environment: { ...process.env, ROX_TEST_VITEST_NODE_EXECUTABLE: executable } })
      expect(invalid.summary).toMatchObject({ passed: 0, failed: 0, blocked: 1 })
      expect(invalid.results[0]!.error).toContain('absolute executable file')
    }
  }, 20_000)

  test('a silent successful executor is retained as a failed result with its actual execution witness', async () => {
    const root = fixture()
    file(root, 'embedded/package.json', '{"name":"embedded"}')
    file(root, 'embedded/vitest.config.ts', 'export default {test:{}}')
    file(root, 'embedded/src/required.test.ts', "import {test} from 'vitest'; test('required',()=>{});")
    const witness = join(root, 'actual-executor-witness')
    file(root, 'embedded/node_modules/vitest/vitest.mjs', `import {writeFileSync} from 'node:fs'; writeFileSync(${JSON.stringify(witness)},'executed-without-output');`)
    const api = await runner(), manifest = await api.discoverSuites(root)
    const report = await api.runSuites({ root, manifest, artifactDirectory: join(root, 'evidence') })
    expect(readFileSync(witness, 'utf8')).toBe('executed-without-output')
    expect(report.status).toBe('failed')
    expect(report.summary).toMatchObject({ passed: 0, failed: 1, blocked: 0 })
    expect(report.results[0]).toMatchObject({ status: 'failed', exitCode: 0, error: expect.stringContaining('without execution output') })
    expect(readFileSync(report.results[0]!.log, 'utf8')).toContain('refusing an empty green result')
    expect(JSON.parse(readFileSync(report.reportPath, 'utf8')).results[0].exitCode).toBe(0)
  }, 20_000)

  test('fresh child processes isolate module mocks, globals and configuration while retaining integration environment', async () => {
    const root = fixture()
    file(root, 'dependency.ts', 'export const answer = 42')
    file(root, 'tests/a.test.ts', `import {test,expect,mock} from 'bun:test'; import {writeFileSync} from 'node:fs'; import {join} from 'node:path';
      mock.module('../dependency.ts',()=>({answer:99}));
      test('isolated first child',()=>{expect(process.env.ROX_CONFIG_DIR).toBe(process.env.CRAFT_CONFIG_DIR);expect(process.env.ROX_WORKSPACE_TEST_CONFIG).toBe('owned-protected-path');writeFileSync(join(process.env.ROX_CONFIG_DIR!,'marker'),'first');(globalThis as any).leaked=true;});`)
    file(root, 'tests/b.isolated.ts', `import {test,expect} from 'bun:test'; import {existsSync} from 'node:fs'; import {join} from 'node:path'; import {answer} from '../dependency.ts';
      test('isolated second child',()=>{expect(answer).toBe(42);expect((globalThis as any).leaked).toBeUndefined();expect(existsSync(join(process.env.ROX_CONFIG_DIR!,'marker'))).toBe(false);});`)
    const api = await runner()
    const report = await api.runSuites({ root, manifest: await api.discoverSuites(root), artifactDirectory: join(root, 'evidence'), environment: { ...process.env, ROX_WORKSPACE_TEST_CONFIG: 'owned-protected-path', ROX_TEST_TIMEOUT_MS: '1000' } })
    expect(report.status).toBe('passed')
    expect(report.summary).toMatchObject({ passed: 2, failed: 0, blocked: 0 })
    expect(new Set(report.results.map(result => result.configRoot)).size).toBe(2)
    expect(report.results.every(result => result.command[2]?.startsWith('./'))).toBe(true)
    expect(report.results.every(result => result.command.slice(-2).join(' ') === '--timeout 1000')).toBe(true)
    expect(report.results.every(result => existsSync(result.log))).toBe(true)
  }, 20_000)

  test('invalid global timeout values fail before any suite starts or evidence is created', async () => {
    const root = fixture()
    file(root, 'tests/never.test.ts', "import {test} from 'bun:test'; test('must not run',()=>{throw Error('invalid timeout executed a test')});")
    const api = await runner()
    const manifest = await api.discoverSuites(root)
    for (const value of ['0', '-1', '1.5', '300001', '1e3', '']) {
      await expect(api.runSuites({ root, manifest, artifactDirectory: join(root, 'evidence'), environment: { ...process.env, ROX_TEST_TIMEOUT_MS: value } })).rejects.toThrow('ROX_TEST_TIMEOUT_MS')
    }
    expect(existsSync(join(root, 'evidence'))).toBe(false)
  })

  test('one failing file cannot stop later coverage or erase earlier failure history', async () => {
    const root = fixture()
    file(root, 'tests/a.test.ts', "import {test,expect} from 'bun:test'; test('retained failure',()=>{console.log('failure-history-marker');expect(false).toBe(true)});")
    file(root, 'tests/z.test.ts', "import {test,expect} from 'bun:test';test('later coverage',()=>expect(42).toBe(42));")
    const api = await runner()
    const options = { root, manifest: await api.discoverSuites(root), artifactDirectory: join(root, 'evidence') }
    const first = await api.runSuites(options)
    expect(first.status).toBe('failed')
    expect(first.summary).toMatchObject({ passed: 1, failed: 1, blocked: 0 })
    expect(first.results.map(result => result.path)).toEqual(['tests/a.test.ts', 'tests/z.test.ts'])
    const original = readFileSync(first.results[0]!.log, 'utf8')
    expect(original).toContain('retained failure')
    expect(original).toContain('failure-history-marker')
    const second = await api.runSuites(options)
    expect(second.artifactDirectory).not.toBe(first.artifactDirectory)
    expect(readFileSync(first.results[0]!.log, 'utf8')).toBe(original)
    expect(JSON.parse(readFileSync(second.reportPath, 'utf8')).summary.failed).toBe(1)
  }, 20_000)

  test('CLI root and artifact overrides list an immutable baseline without executing its tests', async () => {
    const root = fixture()
    file(root, 'tests/never.test.ts', "import {test} from 'bun:test'; test('never invoked by listing',()=>{throw Error('discovery executed a test')});")
    const api = await runner()
    const child = await api.captureTestCommand([process.execPath, runnerPath, '--root', root, '--list'], {
      cwd: import.meta.dir,
      environment: { ...process.env, ROX_TEST_ROOT: '/wrong/root', ROX_TEST_ARTIFACT_DIR: join(root, 'evidence') },
    })
    const { exitCode: exit, stdout, stderr } = child
    expect({ exit, stderr }).toEqual({ exit: 0, stderr: '' })
    const receipt = JSON.parse(stdout.trim())
    expect(receipt.status).toBe('listed')
    expect(receipt.root).toBe(root)
    expect(JSON.parse(readFileSync(receipt.manifestPath, 'utf8')).suites.map((suite: {path: string}) => suite.path)).toEqual(['tests/never.test.ts'])
  }, 20_000)
})
