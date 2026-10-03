/**
 * Run repository tests serially in separate processes. Module mocks, import-time
 * configuration paths and native test profiles must never leak to another file.
 *
 * bun run test [--root <checkout>] [--list] [--filter <path-substring>] [--timeout <ms>]
 * ROX_TEST_ROOT and ROX_TEST_ARTIFACT_DIR support immutable baseline comparisons.
 * Every invocation retains its own manifest, logs and incremental result report.
 */
import { createHash } from 'node:crypto'
import { accessSync, constants, closeSync, existsSync, openSync, readFileSync, statSync } from 'node:fs'
import { lstat, mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import ts from 'typescript'

export type TestRunner = 'bun' | 'playwright' | 'vitest'
export interface TestSuite {
  path: string
  runner: TestRunner
  sha256: string
  config?: string
  packageRoot?: string
  prerequisiteError?: string
}
export interface SuiteManifest {
  schemaVersion: 1
  root: string
  suites: TestSuite[]
  discovery: {
    inventory: 'git-ls-files' | 'filesystem-fallback'
    standard: string
    supplemental: string
    omittedDirectories: string[]
    hiddenStandardFiles: number
  }
}
export interface SuiteResult {
  path: string
  runner: TestRunner
  status: 'passed' | 'failed' | 'blocked'
  exitCode: number | null
  command: string[]
  configRoot: string
  log: string
  logSha256: string
  durationMs: number
  testCounts: { pass: number; fail: number; skip: number } | null
  error?: string
}
export interface TestReport {
  schemaVersion: 1
  status: 'running' | 'passed' | 'failed'
  root: string
  artifactDirectory: string
  manifestPath: string
  reportPath: string
  input: {
    head: string | null
    trackedDiffSha256: string | null
    manifestSha256: string
    runnerSha256: string
    bunVersion: string
    nodeVersion: string | null
  }
  startedAt: string
  finishedAt?: string
  serial: true
  bunTimeoutMs: number
  summary: { expected: number; completed: number; passed: number; failed: number; blocked: number }
  results: SuiteResult[]
}

const STANDARD_TEST = /[._](?:test|spec)\.(?:js|jsx|ts|tsx|mjs|cjs|mts|cts)$/
const ISOLATED_TEST = /\.isolated\.ts$/
const CONFIG_EXTENSIONS = ['ts', 'mts', 'cts', 'js', 'mjs', 'cjs']
const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex')
const portable = (value: string) => value.split('\\').join('/')

function imports(source: string): Set<string> {
  // Preprocessing scans imports/require calls without building thousands of full
  // ASTs. A second cheap token scan retains the type-only import boundary.
  const references = new Map(ts.preProcessFile(source, true, true).importedFiles.map(reference => [reference.pos, reference.fileName]))
  const modules = new Set<string>()
  if (!references.size) return modules
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.Standard, source)
  let afterModuleKeyword = false
  let typeOnly = false
  let token: ts.SyntaxKind
  while ((token = scanner.scan()) !== ts.SyntaxKind.EndOfFileToken) {
    if (token === ts.SyntaxKind.ImportKeyword || token === ts.SyntaxKind.ExportKeyword) {
      afterModuleKeyword = true
      typeOnly = false
      continue
    }
    if (afterModuleKeyword) {
      typeOnly = token === ts.SyntaxKind.TypeKeyword
      afterModuleKeyword = false
    }
    if (token === ts.SyntaxKind.RequireKeyword || token === ts.SyntaxKind.SemicolonToken) typeOnly = false
    const module = references.get(scanner.getTokenPos())
    if (module !== undefined) {
      if (!typeOnly) modules.add(module)
      typeOnly = false
    }
  }
  return modules
}

function testTimeout(value: string | undefined): number {
  if (value === undefined) return 5000
  if (!/^[1-9]\d*$/.test(value) || Number(value) > 300_000) throw new Error('ROX_TEST_TIMEOUT_MS / --timeout must be a positive integer at most 300000')
  return Number(value)
}

async function nearestConfiguration(root: string, file: string, kind: 'playwright' | 'vitest') {
  let directory = dirname(file)
  while (true) {
    for (const extension of CONFIG_EXTENSIONS) {
      const candidate = join(directory, `${kind}.config.${extension}`)
      if (existsSync(candidate)) return portable(relative(root, candidate))
    }
    if (directory === root) return undefined
    const parent = dirname(directory)
    if (parent === directory || relative(root, parent).startsWith('..')) return undefined
    directory = parent
  }
}

function nearestPackage(root: string, file: string) {
  let directory = dirname(file)
  while (directory !== root && !existsSync(join(directory, 'package.json'))) directory = dirname(directory)
  return portable(relative(root, directory)) || '.'
}

async function gitTestInventory(root: string): Promise<string[] | null> {
  const gitRoot = await gitOutput(root, ['rev-parse', '--show-toplevel'])
  if (gitRoot === null) {
    // A damaged checkout must not silently become an unrestricted filesystem
    // scan. Only a genuinely non-Git fixture gets the historical fallback.
    let directory = root
    while (true) {
      if (existsSync(join(directory, '.git'))) throw new Error('Git test inventory unavailable')
      const parent = dirname(directory)
      if (parent === directory) return null
      directory = parent
    }
  }
  const output = await gitOutput(root, ['ls-files', '--cached', '--others', '--exclude-standard', '-z'])
  if (output === null) throw new Error('Git test inventory unavailable')
  // Preserve whitespace in names; tracked files remain present even if an
  // ignore rule now matches them. New source files use Git's ignore policy.
  return [...new Set(output.split('\0').filter(Boolean))]
}

/** Match Bun's filename forms; retain the existing explicit *.isolated.ts stage. */
export async function discoverSuites(inputRoot: string): Promise<SuiteManifest> {
  const root = resolve(inputRoot)
  const manifest: SuiteManifest = {
    schemaVersion: 1, root, suites: [],
    discovery: {
      inventory: 'filesystem-fallback',
      standard: '*.{test,spec}.{js,jsx,ts,tsx,mjs,cjs,mts,cts} and *_{test,spec} forms',
      supplemental: '*.isolated.ts (including hidden source directories, as the former find stage did)',
      omittedDirectories: ['node_modules', '.git'], hiddenStandardFiles: 0,
    },
  }
  async function inspect(path: string, hidden: boolean) {
    const name = basename(path)
    if (!STANDARD_TEST.test(name) && !ISOLATED_TEST.test(name)) return
    // Do not follow symlinks into dependency checkouts or external profiles.
    // An enumerated source disappearing is an error, not reduced coverage.
    if (!(await lstat(path)).isFile()) return
    if (hidden && !ISOLATED_TEST.test(name)) { manifest.discovery.hiddenStandardFiles += 1; return }
    const content = await readFile(path)
    const dependencies = imports(content.toString('utf8'))
    const runner: TestRunner = dependencies.has('bun:test') ? 'bun'
      : dependencies.has('@playwright/test') ? 'playwright'
      : dependencies.has('vitest') ? 'vitest' : 'bun'
    const suite: TestSuite = { path: portable(relative(root, path)), runner, sha256: hash(content) }
    if (runner !== 'bun') {
      suite.config = await nearestConfiguration(root, path, runner)
      suite.packageRoot = nearestPackage(root, path)
      if (!suite.config) suite.prerequisiteError = `${runner} config not found for ${suite.path}`
    }
    manifest.suites.push(suite)
  }
  async function visit(directory: string, hidden: boolean) {
    const entries = (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue
      const path = join(directory, entry.name)
      if (entry.isDirectory()) { await visit(path, hidden || entry.name.startsWith('.')); continue }
      if (entry.isFile()) await inspect(path, hidden)
    }
  }
  const inventory = await gitTestInventory(root)
  if (inventory === null) await visit(root, false)
  else {
    manifest.discovery.inventory = 'git-ls-files'
    for (const file of inventory) {
      const parts = portable(file).split('/')
      if (parts.includes('node_modules') || parts.includes('.git')) continue
      await inspect(join(root, file), parts.slice(0, -1).some(part => part.startsWith('.')))
    }
  }
  manifest.suites.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
  return manifest
}

async function gitOutput(root: string, args: string[]) {
  const child = Bun.spawn(['git', ...args], { cwd: root, stdout: 'pipe', stderr: 'ignore' })
  const [exit, output] = await Promise.all([child.exited, new Response(child.stdout).text()])
  return exit === 0 ? output : null
}

async function createArtifactRun(directory: string) {
  const base = resolve(directory)
  await mkdir(base, { recursive: true })
  return mkdtemp(join(base, 'run-'))
}

function commandFor(root: string, suite: TestSuite, output: string, timeout: number, environment: NodeJS.ProcessEnv): string[] {
  if (suite.runner === 'bun') return [process.execPath, 'test', `./${suite.path}`, '--timeout', String(timeout)]
  if (!suite.config) throw new Error(`${suite.runner} config not found for ${suite.path}`)
  if (suite.runner === 'playwright') {
    const cli = join(root, 'node_modules/@playwright/test/cli.js')
    if (!existsSync(cli)) throw new Error('Pinned local Playwright executable is not installed')
    return ['node', cli, 'test', `./${suite.path}`, '--config', suite.config, '--workers=1', '--reporter=line', '--output', join(output, 'playwright-output')]
  }
  const packageRoot = resolve(root, suite.packageRoot ?? '.')
  const cli = [join(packageRoot, 'node_modules/vitest/vitest.mjs'), join(root, 'node_modules/vitest/vitest.mjs')].find(existsSync)
  if (!cli) throw new Error(`Local Vitest executable is not installed for ${suite.packageRoot}`)
  // Embedded packages can require a different Node major from the repository.
  // Keep their executor explicit in every command/receipt; never change PATH
  // or the Bun/Playwright runtime to qualify an unrelated package.
  const node = environment.ROX_TEST_VITEST_NODE_EXECUTABLE ?? 'node'
  if (environment.ROX_TEST_VITEST_NODE_EXECUTABLE !== undefined) {
    if (!isAbsolute(node) || !statSync(node).isFile()) throw new Error('ROX_TEST_VITEST_NODE_EXECUTABLE must be an absolute executable file')
    accessSync(node, constants.X_OK)
  }
  return [node, cli, 'run', relative(packageRoot, join(root, suite.path)), '--root', packageRoot, '--config', join(root, suite.config), '--maxWorkers=1', '--reporter=verbose']
}

function bunCounts(log: string) {
  const count = (name: string) => {
    const matches = [...log.matchAll(new RegExp(`^\\s*(\\d+) ${name}\\s*$`, 'gm'))]
    return matches.length ? Number(matches[matches.length - 1]![1]) : 0
  }
  if (!/^\s*\d+ (pass|fail)\s*$/m.test(log)) return null
  return { pass: count('pass'), fail: count('fail'), skip: count('skip') }
}

/** Continue after failures so the report retains the complete execution history. */
export async function runSuites(options: {
  root: string
  manifest: SuiteManifest
  artifactDirectory?: string
  environment?: NodeJS.ProcessEnv
  onResult?: (result: SuiteResult, completed: number, expected: number) => void
}): Promise<TestReport> {
  const root = resolve(options.root)
  if (resolve(options.manifest.root) !== root) throw new Error('Suite manifest belongs to a different checkout')
  const environment = options.environment ?? process.env
  const bunTimeoutMs = testTimeout(environment.ROX_TEST_TIMEOUT_MS)
  const artifactDirectory = await createArtifactRun(options.artifactDirectory ?? environment.ROX_TEST_ARTIFACT_DIR ?? join(root, 'work/test-all'))
  const manifestPath = join(artifactDirectory, 'manifest.json')
  const manifest = JSON.stringify(options.manifest, null, 2) + '\n'
  await writeFile(manifestPath, manifest)
  const node = Bun.spawn(['node', '--version'], { stdout: 'pipe', stderr: 'ignore', env: environment })
  const [nodeExit, nodeVersion, head, diff] = await Promise.all([
    node.exited, new Response(node.stdout).text(), gitOutput(root, ['rev-parse', 'HEAD']), gitOutput(root, ['diff', '--binary', 'HEAD']),
  ])
  const report: TestReport = {
    schemaVersion: 1, status: 'running', root, artifactDirectory, manifestPath, reportPath: join(artifactDirectory, 'report.json'),
    input: { head: head?.trim() ?? null, trackedDiffSha256: diff === null ? null : hash(diff), manifestSha256: hash(manifest), runnerSha256: hash(readFileSync(import.meta.filename)), bunVersion: Bun.version, nodeVersion: nodeExit === 0 ? nodeVersion.trim() : null },
    startedAt: new Date().toISOString(), serial: true, bunTimeoutMs,
    summary: { expected: options.manifest.suites.length, completed: 0, passed: 0, failed: 0, blocked: 0 }, results: [],
  }
  const checkpoint = () => writeFile(report.reportPath, JSON.stringify(report, null, 2) + '\n')
  await checkpoint()
  for (const suite of options.manifest.suites) {
    const directory = join(artifactDirectory, `${String(report.results.length + 1).padStart(5, '0')}-${hash(suite.path).slice(0, 12)}`)
    await mkdir(directory)
    const configRoot = await mkdtemp(join(tmpdir(), 'rox-test-config-'))
    const log = join(directory, 'output.log')
    const result: SuiteResult = { path: suite.path, runner: suite.runner, status: 'blocked', exitCode: null, command: [], configRoot, log, logSha256: '', durationMs: 0, testCounts: null }
    const started = performance.now()
    try {
      if (hash(await readFile(join(root, suite.path))) !== suite.sha256) throw new Error('Test source changed since discovery; regenerate the manifest')
      if (suite.prerequisiteError) throw new Error(suite.prerequisiteError)
      result.command = commandFor(root, suite, directory, bunTimeoutMs, environment)
      const childEnv: NodeJS.ProcessEnv = { ...environment, ROX_CONFIG_DIR: configRoot, CRAFT_CONFIG_DIR: configRoot }
      // The existing meeting script explicitly opts into U1 fixtures. Preserve
      // that evidence boundary, while respecting a product opt-in from the caller.
      if (suite.runner === 'playwright' && suite.config === 'tests/e2e/meeting-agents/playwright.config.ts'
        && childEnv.ROX_MEETING_USE_PACKAGED_APP !== '1') childEnv.ROX_MEETING_E2E_FIXTURE ??= '1'
      const descriptor = openSync(log, 'wx')
      try {
        const cwd = suite.runner === 'vitest' ? resolve(root, suite.packageRoot ?? '.') : root
        const child = Bun.spawn(result.command, { cwd, env: childEnv, stdin: 'ignore', stdout: descriptor, stderr: descriptor })
        result.exitCode = await child.exited
        result.status = result.exitCode === 0 ? 'passed' : 'failed'
      } finally { closeSync(descriptor) }
    } catch (error) {
      result.error = error instanceof Error ? error.message : String(error)
      await writeFile(log, `${result.error}\n`, { flag: existsSync(log) ? 'a' : 'wx' })
    }
    result.durationMs = Math.round(performance.now() - started)
    const content = await readFile(log)
    result.logSha256 = hash(content)
    result.testCounts = suite.runner === 'bun' ? bunCounts(content.toString('utf8')) : null
    report.results.push(result)
    report.summary.completed += 1
    report.summary[result.status] += 1
    await checkpoint()
    options.onResult?.(result, report.summary.completed, report.summary.expected)
  }
  report.status = report.summary.failed || report.summary.blocked ? 'failed' : 'passed'
  report.finishedAt = new Date().toISOString()
  await checkpoint()
  return report
}

async function main() {
  let root = process.env.ROX_TEST_ROOT ?? resolve(import.meta.dir, '..')
  let list = false
  let filter: string | undefined
  let timeout = process.env.ROX_TEST_TIMEOUT_MS
  const args = process.argv.slice(2)
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!
    if (arg === '--list') list = true
    else if (arg === '--root' || arg === '--filter' || arg === '--timeout') {
      const value = args[++index]
      if (!value) throw new Error(`${arg} requires a value`)
      if (arg === '--root') root = value
      else if (arg === '--filter') filter = value
      else timeout = value
    } else throw new Error(`Unknown test runner option: ${arg}`)
  }
  root = resolve(root)
  const bunTimeoutMs = testTimeout(timeout)
  const manifest = await discoverSuites(root)
  if (filter !== undefined) manifest.suites = manifest.suites.filter(suite => suite.path.includes(filter!))
  if (!manifest.suites.length) throw new Error('No test files discovered; refusing an empty green run')
  const artifactDirectory = process.env.ROX_TEST_ARTIFACT_DIR ?? join(root, 'work/test-all')
  if (list) {
    const run = await createArtifactRun(artifactDirectory)
    const manifestPath = join(run, 'manifest.json')
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
    console.log(JSON.stringify({ status: 'listed', root, manifestPath, files: manifest.suites.length, filter: filter ?? null }))
    return
  }
  const report = await runSuites({ root, manifest, artifactDirectory, environment: { ...process.env, ROX_TEST_TIMEOUT_MS: String(bunTimeoutMs) }, onResult: (result, completed, expected) => {
    console.log(`[${completed}/${expected}] ${result.status} ${result.path} (${result.durationMs}ms)${result.error ? ': ' + result.error : ''}`)
  } })
  console.log(JSON.stringify({ status: report.status, root, reportPath: report.reportPath, summary: report.summary, filter: filter ?? null }))
  process.exitCode = report.status === 'passed' ? 0 : 1
}

if (import.meta.main) main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1 })
