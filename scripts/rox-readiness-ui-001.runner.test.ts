import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import { createHash } from 'node:crypto'
import * as nativeFs from 'node:fs'
import * as nativeFsPromises from 'node:fs/promises'
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
  test('discovery reads the checked inode when its pathname is replaced before reading', async () => {
    const root = fixture(), api = await runner()
    const source = "import {test} from 'bun:test'; test('original inode',()=>{});"
    const replacement = "import {test} from '@playwright/test'; test('replacement pathname',()=>{});"
    file(root, 'a.test.ts', source)
    const path = join(root, 'a.test.ts')
    let swapped = false
    const swap = () => {
      if (swapped) return
      swapped = true
      nativeFs.renameSync(path, join(root, 'original-inode'))
      writeFileSync(path, replacement)
    }
    const actualLstat = nativeFsPromises.lstat, actualOpen = nativeFsPromises.open
    const checkedPath = spyOn(nativeFsPromises, 'lstat').mockImplementation((async (pathToCheck: nativeFs.PathLike) => {
      const result = await actualLstat(pathToCheck)
      if (String(pathToCheck) === path) swap()
      return result
    }) as typeof nativeFsPromises.lstat)
    const checkedHandle = spyOn(nativeFsPromises, 'open').mockImplementation(async (...args: Parameters<typeof actualOpen>) => {
      const handle = await actualOpen(...args)
      if (String(args[0]) === path) {
        const actualStat = handle.stat.bind(handle)
        handle.stat = (async () => { const result = await actualStat(); swap(); return result }) as typeof handle.stat
      }
      return handle
    })
    try {
      const manifest = await api.discoverSuites(root)
      expect(swapped).toBe(true)
      expect(readFileSync(path, 'utf8')).toBe(replacement)
      expect(manifest.suites).toMatchObject([{ path: 'a.test.ts', runner: 'bun', sha256: createHash('sha256').update(source).digest('hex') }])
    } finally { checkedPath.mockRestore(); checkedHandle.mockRestore() }
  }, 20_000)

  test('failure logger keeps its checked inode and refuses a replacement symlink as execution evidence', async () => {
    const root = fixture(), api = await runner()
    file(root, 'embedded/package.json', '{"name":"embedded"}')
    file(root, 'embedded/vitest.config.ts', 'export default {test:{}}')
    file(root, 'embedded/src/required.test.ts', "import {test} from 'vitest'; test('required',()=>{});")
    file(root, 'embedded/node_modules/vitest/vitest.mjs', '')
    const protectedTarget = join(root, 'protected-target'), archivedLog = join(root, 'checked-log-inode')
    writeFileSync(protectedTarget, 'protected-original\n')
    const manifest = await api.discoverSuites(root)
    let swapped = false
    const swap = (path: string) => {
      if (swapped) return
      swapped = true
      nativeFs.renameSync(path, archivedLog)
      nativeFs.symlinkSync(protectedTarget, path)
    }
    const actualExists = nativeFs.existsSync, actualOpen = nativeFsPromises.open
    const checkedPath = spyOn(nativeFs, 'existsSync').mockImplementation(path => {
      const result = actualExists(path)
      if (result && String(path).endsWith('output.log')) swap(String(path))
      return result
    })
    const checkedHandle = spyOn(nativeFsPromises, 'open').mockImplementation(async (...args: Parameters<typeof actualOpen>) => {
      const handle = await actualOpen(...args)
      if (String(args[0]).endsWith('output.log') && typeof args[1] === 'number' && (args[1] & nativeFs.constants.O_APPEND)) {
        const actualStat = handle.stat.bind(handle)
        handle.stat = (async () => { const result = await actualStat(); swap(String(args[0])); return result }) as typeof handle.stat
      }
      return handle
    })
    try {
      const outcome = await api.runSuites({ root, manifest, artifactDirectory: join(root, 'evidence') })
        .then(report => ({ report }), error => ({ error }))
      expect(swapped).toBe(true)
      expect(readFileSync(protectedTarget, 'utf8')).toBe('protected-original\n')
      expect(readFileSync(archivedLog, 'utf8')).toContain('without execution output')
      expect(outcome).toMatchObject({ error: expect.objectContaining({ message: 'Execution log is not a regular file' }) })
    } finally { checkedPath.mockRestore(); checkedHandle.mockRestore() }
  }, 20_000)

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

  test('the native product suite retains its dedicated configuration, command and platform prerequisite', async () => {
    const root = fixture(), directory = 'tests/e2e/product-tour'
    file(root, directory + '/playwright.config.ts', 'export default {testMatch: "*.application.spec.ts"}')
    file(root, directory + '/native.config.ts', 'export default {testMatch: "*.native.spec.ts"}')
    for (const kind of ['application', 'native']) file(root, `${directory}/product.${kind}.spec.ts`, "import {test} from '@playwright/test'; test('retained suite',()=>{});")
    file(root, 'node_modules/@playwright/test/cli.js', `const assert=require('node:assert/strict');
      const path=process.argv[3]; const config=process.argv[process.argv.indexOf('--config')+1];
      assert.equal(config,path.endsWith('.native.spec.ts')?'tests/e2e/product-tour/native.config.ts':'tests/e2e/product-tour/playwright.config.ts');
      console.log('actual-config-command:'+config);`)
    const api = await runner(), manifest = await api.discoverSuites(root)
    expect(manifest.suites).toMatchObject([
      { path: `${directory}/product.application.spec.ts`, runner: 'playwright', config: `${directory}/playwright.config.ts` },
      { path: `${directory}/product.native.spec.ts`, runner: 'playwright', config: `${directory}/native.config.ts` },
    ])
    const report = await api.runSuites({ root, manifest, artifactDirectory: join(root, 'evidence') })
    expect(report.summary.expected).toBe(2)
    expect(report.summary.completed).toBe(2)
    const application = report.results[0]!, native = report.results[1]!
    expect(application.status).toBe('passed')
    expect(readFileSync(application.log, 'utf8')).toContain('actual-config-command:' + directory + '/playwright.config.ts')
    if (process.platform === 'darwin' || process.platform === 'win32') {
      expect(native.status).toBe('passed')
      expect(native.command[native.command.indexOf('--config') + 1]).toBe(directory + '/native.config.ts')
      expect(readFileSync(native.log, 'utf8')).toContain('actual-config-command:' + directory + '/native.config.ts')
    } else {
      expect(report.status).toBe('failed')
      expect(report.summary).toMatchObject({ passed: 1, failed: 0, blocked: 1 })
      expect(native).toMatchObject({ status: 'blocked', command: [], error: expect.stringContaining('macOS or Windows') })
      expect(readFileSync(native.log, 'utf8')).toContain('macOS or Windows')
    }
  }, 20_000)

  test('a missing native product configuration stays blocked even when the generic browser configuration exists', async () => {
    const root = fixture(), directory = 'tests/e2e/product-tour'
    file(root, directory + '/playwright.config.ts', 'export default {testMatch: "*.application.spec.ts"}')
    file(root, directory + '/product.native.spec.ts', "import {test} from '@playwright/test'; test('required native coverage',()=>{});")
    const api = await runner(), manifest = await api.discoverSuites(root)
    expect(manifest.suites).toHaveLength(1)
    expect(manifest.suites[0]).toMatchObject({ path: directory + '/product.native.spec.ts', runner: 'playwright' })
    expect(manifest.suites[0]!.prerequisiteError).toContain('config not found')
    expect(manifest.suites[0]!.config).toBeUndefined()
    const report = await api.runSuites({ root, manifest, artifactDirectory: join(root, 'evidence') })
    expect(report.status).toBe('failed')
    expect(report.summary).toMatchObject({ expected: 1, completed: 1, passed: 0, failed: 0, blocked: 1 })
    expect(report.results[0]).toMatchObject({ path: directory + '/product.native.spec.ts', status: 'blocked', command: [], error: expect.stringContaining('config not found') })
  }, 20_000)

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

  test('direct isolated suites receive private home directories and preserve the caller filesystem and integration environment', async () => {
    const root = fixture(), hostHome = join(root, 'host-home')
    const hostSentinel = join(hostHome, 'bundle', 'host-sentinel')
    file(root, 'host-home/bundle/host-sentinel', 'caller-owned-original')
    const environment: NodeJS.ProcessEnv = { ...process.env, HOME: hostHome, USERPROFILE: hostHome,
      ROX_WORKSPACE_TEST_CONFIG: 'owned-protected-database-path',
      ROX_TEST_VITEST_NODE_EXECUTABLE: Bun.which('node')!,
      PLAYWRIGHT_BROWSERS_PATH: join(root, 'owned-browser-cache') }
    const source = `import {beforeEach,test,expect} from 'bun:test';
      import {existsSync,mkdirSync,readFileSync,realpathSync,rmSync,writeFileSync} from 'node:fs';
      import {homedir} from 'node:os'; import {join,relative,isAbsolute} from 'node:path';
      const home=homedir();
      beforeEach(()=>rmSync(join(home,'bundle'),{recursive:true,force:true}));
      test('actual isolated filesystem cleanup',()=>{
        expect(realpathSync(home)).not.toBe(realpathSync(${JSON.stringify(hostHome)}));
        expect(realpathSync(process.env.HOME!)).toBe(realpathSync(home));
        expect(realpathSync(process.env.USERPROFILE!)).toBe(realpathSync(home));
        const directories=['XDG_CONFIG_HOME','XDG_CACHE_HOME','XDG_DATA_HOME','APPDATA','LOCALAPPDATA'];
        for(const key of directories){
          const directory=process.env[key]!;
          expect(existsSync(directory)).toBe(true);
          const child=relative(realpathSync(home),realpathSync(directory));
          expect(isAbsolute(child)||child==='..'||child.startsWith('../')||child.startsWith('..\\\\')).toBe(false);
        }
        expect(process.env.ROX_CONFIG_DIR).toBe(process.env.CRAFT_CONFIG_DIR);
        expect(process.env.ROX_WORKSPACE_TEST_CONFIG).toBe(${JSON.stringify(environment.ROX_WORKSPACE_TEST_CONFIG)});
        expect(process.env.PATH).toBe(${JSON.stringify(environment.PATH)});
        expect(process.env.ROX_TEST_VITEST_NODE_EXECUTABLE).toBe(${JSON.stringify(environment.ROX_TEST_VITEST_NODE_EXECUTABLE)});
        expect(process.env.PLAYWRIGHT_BROWSERS_PATH).toBe(${JSON.stringify(environment.PLAYWRIGHT_BROWSERS_PATH)});
        expect(readFileSync(${JSON.stringify(hostSentinel)},'utf8')).toBe('caller-owned-original');
        expect(existsSync(join(home,'child-marker'))).toBe(false);
        mkdirSync(join(home,'bundle'),{recursive:true});
        writeFileSync(join(home,'bundle','child-data'),'owned-cleanup-fixture');
        writeFileSync(join(home,'child-marker'),'child-only');
        writeFileSync(join(process.env.ROX_CONFIG_DIR!,'home-witness.json'),JSON.stringify({home:realpathSync(home),directories:Object.fromEntries(directories.map(key=>[key,realpathSync(process.env[key]!)]))}));
      });`
    file(root, 'tests/a.isolated.ts', source)
    file(root, 'tests/b.isolated.ts', source)
    const api = await runner(), manifest = await api.discoverSuites(root)
    expect(manifest.suites.map(suite => suite.path)).toEqual(['tests/a.isolated.ts', 'tests/b.isolated.ts'])
    const report = await api.runSuites({ root, manifest, artifactDirectory: join(root, 'evidence'), environment })
    expect(existsSync(hostSentinel)).toBe(true)
    expect(readFileSync(hostSentinel, 'utf8')).toBe('caller-owned-original')
    expect(report.status).toBe('passed')
    expect(report.summary).toMatchObject({ expected: 2, completed: 2, passed: 2, failed: 0, blocked: 0 })
    const witnesses = report.results.map(result => JSON.parse(readFileSync(join(result.configRoot, 'home-witness.json'), 'utf8')))
    expect(new Set(witnesses.map(witness => witness.home)).size).toBe(2)
    expect(report.results.every(result => result.homeRoot && nativeFs.realpathSync(result.homeRoot) === witnesses[report.results.indexOf(result)].home)).toBe(true)
    expect(report.results.every(result => result.testCounts?.pass === 1 && result.testCounts?.fail === 0)).toBe(true)
    expect(environment.HOME).toBe(hostHome)
    expect(environment.USERPROFILE).toBe(hostHome)
  }, 20_000)

  test('invalid global timeout values fail before any suite starts or evidence is created', async () => {
    const root = fixture()
    file(root, 'tests/never.test.ts', "import {test} from 'bun:test'; test('must not run',()=>{throw Error('invalid timeout executed a test')});")
    const api = await runner()
    const manifest = await api.discoverSuites(root)
    for (const value of ['0', '-1', '1.5', '300001', '1e3', '']) {
      await expect(api.runSuites({ root, manifest, artifactDirectory: join(root, 'evidence'), environment: { ...process.env, ROX_TEST_TIMEOUT_MS: value } })).rejects.toThrow('ROX_TEST_TIMEOUT_MS')
    }
    for (const value of ['0', '-1', '1.5', '3600001', '1e3', '']) {
      await expect(api.runSuites({ root, manifest, artifactDirectory: join(root, 'evidence'), environment: { ...process.env, ROX_TEST_SUITE_TIMEOUT_MS: value } })).rejects.toThrow('ROX_TEST_SUITE_TIMEOUT_MS')
    }
    expect(existsSync(join(root, 'evidence'))).toBe(false)
  })

  test('the whole-suite guard terminates a synchronously blocked child tree and retains later coverage', async () => {
    const root = fixture(), witness = join(root, 'blocked-tree.json'), heartbeat = join(root, 'grandchild-heartbeat')
    const grandchild = `const {writeFileSync}=require('node:fs'); process.on('SIGTERM',()=>{}); setInterval(()=>writeFileSync(${JSON.stringify(heartbeat)},String(Date.now())),40);`
    const blockedChild = `const {spawn}=require('node:child_process'); const {writeFileSync}=require('node:fs');
      const child=spawn(process.execPath,['-e',${JSON.stringify(grandchild)}],{stdio:'inherit'});
      writeFileSync(${JSON.stringify(witness)},JSON.stringify({pid:process.pid,grandchild:child.pid}));
      process.on('SIGTERM',()=>{}); setInterval(()=>{},1000);`
    file(root, 'tests/a.isolated.ts', `import {test,expect} from 'bun:test'; import {spawnSync} from 'node:child_process';
      test('actual synchronous native-style wait',()=>{console.log('whole-suite-blocked-started');spawnSync('node',['-e',${JSON.stringify(blockedChild)}],{stdio:'inherit'});expect('never reached').toBe('assertions are not waived')},5000);`)
    file(root, 'tests/z.test.ts', "import {test,expect} from 'bun:test'; test('coverage after real supervisor failure',()=>expect(42).toBe(42));")
    const api = await runner(), manifest = await api.discoverSuites(root)
    const report = await api.runSuites({ root, manifest, artifactDirectory: join(root, 'evidence'),
      environment: { ...process.env, ROX_TEST_TIMEOUT_MS: '5000', ROX_TEST_SUITE_TIMEOUT_MS: '1500' } })
    expect(report.status).toBe('failed')
    expect(report.wholeSuiteTimeoutMs).toBe(1500)
    expect(report.bunTimeoutMs).toBe(5000)
    expect(report.summary).toMatchObject({ expected: 2, completed: 2, passed: 1, failed: 1, blocked: 0 })
    expect(report.results[0]).toMatchObject({ path: 'tests/a.isolated.ts', status: 'failed', timedOut: true, error: expect.stringContaining('Whole-suite process deadline exceeded after 1500ms') })
    expect(readFileSync(report.results[0]!.log, 'utf8')).toContain('whole-suite-blocked-started')
    expect(readFileSync(report.results[0]!.log, 'utf8')).toContain('Whole-suite process deadline exceeded')
    expect(report.results[0]!.durationMs).toBeLessThan(10_000)
    expect(report.results[1]).toMatchObject({ status: 'passed', timedOut: false, testCounts: { pass: 1, fail: 0 } })
    const tree = JSON.parse(readFileSync(witness, 'utf8')) as { pid: number; grandchild: number }
    expect(tree.pid).not.toBe(tree.grandchild)
    const lastHeartbeat = readFileSync(heartbeat, 'utf8')
    const deadline = Date.now() + 2000
    const alive = (pid: number) => { try { process.kill(pid, 0); return true } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false; throw error } }
    while ((alive(tree.pid) || alive(tree.grandchild)) && Date.now() < deadline) await Bun.sleep(40)
    expect(alive(tree.pid)).toBe(false)
    expect(alive(tree.grandchild)).toBe(false)
    expect(readFileSync(heartbeat, 'utf8')).toBe(lastHeartbeat)
    expect(JSON.parse(readFileSync(report.reportPath, 'utf8')).results[0]).toMatchObject({ status: 'failed', timedOut: true })
  }, 20_000)

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
