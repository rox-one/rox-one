/**
 * Run repository tests in separate processes, bounded-parallel across suites.
 * Module mocks, import-time configuration paths and native test profiles must
 * never leak to another file: every suite keeps its own process, HOME, config
 * root and artifact directory, so parallelism does not widen that isolation.
 *
 * bun run test [--root <checkout>] [--list] [--filter <path-substring>]
 *   [--timeout <test-ms>] [--suite-timeout <process-ms>]
 *   [--shard <k/n>] [--concurrency <n>] [--baseline <path>|--no-baseline]
 *   [--update-baseline [--force-subset-baseline]] [--strict]
 * ROX_TEST_ROOT and ROX_TEST_ARTIFACT_DIR support immutable baseline comparisons.
 * Every invocation retains its own manifest, logs and incremental result report.
 *
 * Fixed-port fixtures: suites that bind a literal TCP port (Playwright
 * webServer with reuseExistingServer:false, `vite --strictPort`) are
 * serialized on a per-port host-global lease, so a shard or any --concurrency
 * never lets two of them own one port at once. --update-baseline refuses
 * --shard/--filter unless --force-subset-baseline is given, so a subset run
 * cannot silently truncate the checked-in baseline.
 *
 * Known redness: a baseline file (scripts/test-baseline.json by default) lists
 * suites that are already red on main. Their failures no longer fail the run;
 * only *new* failures (or stale baseline entries) change the exit code, so the
 * nightly signal is "no new regressions". --strict restores "any red fails".
 */
import { createHash } from 'node:crypto'
import { accessSync, constants, existsSync, readFileSync, statSync } from 'node:fs'
import { lstat, mkdir, mkdtemp, open, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { availableParallelism, homedir, tmpdir } from 'node:os'
import { chromium } from '@playwright/test'
import ts from 'typescript'

export type TestRunner = 'bun' | 'playwright' | 'vitest'
export interface TestSuite {
  path: string
  runner: TestRunner
  sha256: string
  config?: string
  packageRoot?: string
  prerequisiteError?: string
  /**
   * Fixed TCP ports this suite binds through an owned fixture (a Playwright
   * webServer with `reuseExistingServer: false`, or a `vite --strictPort`
   * child). Two suites that own the same port must never run at once, in this
   * process or in a concurrent shard process, or the second child dies with
   * EADDRINUSE and turns a known-red baseline into a spurious new failure.
   */
  ports: number[]
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
    /** Git-relative path prefixes excluded from discovery; vendored resource trees. */
    omittedPaths: string[]
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
  homeRoot: string
  log: string
  logSha256: string
  durationMs: number
  testCounts: { pass: number; fail: number; skip: number } | null
  timedOut?: boolean
  signal?: NodeJS.Signals | null
  error?: string
  /** Present in the known-red baseline: a red outcome here is expected, not a regression. */
  knownRed?: boolean
}
/** Baseline of suites already red on main, used to separate old redness from new regressions. */
export interface BaselineFile {
  schemaVersion: 1
  description?: string
  /** Free-form provenance of the recorded redness (report path, revision). */
  source?: string
  knownRed: string[]
}
export interface ReportBaseline {
  path: string | null
  schemaVersion: 1 | null
  knownRed: string[]
  newFailures: string[]
  stalePass: string[]
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
  serial: boolean
  concurrency: number
  bunTimeoutMs: number
  wholeSuiteTimeoutMs: number
  summary: { expected: number; completed: number; passed: number; failed: number; blocked: number; knownRed: number; newFailures: number; stalePass: number }
  baseline: ReportBaseline
  results: SuiteResult[]
}

const STANDARD_TEST = /[._](?:test|spec)\.(?:js|jsx|ts|tsx|mjs|cjs|mts|cts)$/
const ISOLATED_TEST = /\.isolated\.ts$/
const CONFIG_EXTENSIONS = ['ts', 'mts', 'cts', 'js', 'mjs', 'cjs']
const DEFAULT_WHOLE_SUITE_TIMEOUT_MS = 900_000
const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex')
const portable = (value: string) => value.split('\\').join('/')

// --- Fixed-port fixture ownership ------------------------------------------
// A suite that starts an owned HTTP fixture on a literal TCP port cannot share
// that port with another running suite. The scheduler serializes owners of the
// same port behind one lease (see acquirePortLease); ownership is read from the
// fixture text at discovery time.
//
// Ports come from four literal forms seen in this repository: a loopback URL
// (`127.0.0.1:5269`), a CLI `--port N` argument, an object `port: N`, and a
// `const playgroundPort = 5192` binding. Deliberately permissive: over-locking
// two suites that merely mention the same port only costs parallelism, while
// missing an owner reintroduces the EADDRINUSE collision this prevents. A
// literal `0` (or any out-of-range value) is a dynamic port and is ignored.
const FIXED_PORT_MIN = 1024
const FIXED_PORT_MAX = 65535
const PORT_REFERENCE_PATTERNS: readonly RegExp[] = [
  /(?:127\.0\.0\.1|localhost):(\d{2,5})/g,
  /--port['"]?[,\s=]+['"]?(\d{2,5})/g,
  /\bport\s*[:=]\s*(\d{2,5})\b/g,
  /[A-Za-z_$][\w$]*[Pp]ort\s*[:=]\s*(\d{2,5})\b/g,
]
// A suite only owns a port if it starts a server or a child process; a file
// that merely carries a client URL (`ws://localhost:3000`) stays parallel. The
// marker is an actual spawn/serve call, not an `import ... from
// 'node:child_process'` string a fixture-embedding test happens to contain.
const SERVER_SPAWN_PATTERN = /Bun\.spawn|Bun\.serve|\bspawn\s*\(|\bfork\s*\(|\.listen\s*\(|createServer\s*\(/

/** Every literal TCP port referenced by a fixture document, de-duplicated and
 *  ascending; dynamic (0) and out-of-range values are dropped. */
export function fixedPorts(text: string): number[] {
  const ports = new Set<number>()
  for (const pattern of PORT_REFERENCE_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      const port = Number(match[1])
      if (Number.isInteger(port) && port >= FIXED_PORT_MIN && port <= FIXED_PORT_MAX) ports.add(port)
    }
  }
  return [...ports].sort((a, b) => a - b)
}

// Bun's test runtime can lose subprocess pipe/descriptor output on macOS (Bun
// #24690). An actual Node process owns the child's pipes and records completion
// only after `close`, when both streams have drained. Bun reads the durable
// bytes rather than relying on the affected capture path.
const NODE_CAPTURE_DRIVER = [
  "import { spawn } from 'node:child_process'",
  "import { createHash } from 'node:crypto'",
  "import { closeSync, openSync, readFileSync, writeFileSync, writeSync } from 'node:fs'",
  "const input = JSON.parse(readFileSync(process.argv[2], 'utf8'))",
  "const stdout = openSync(input.stdout, 'wx', 0o600)",
  "const stderr = openSync(input.stderr, 'wx', 0o600)",
  "const log = input.log ? openSync(input.log, 'wx', 0o600) : null",
  "let stdoutBytes = 0, stderrBytes = 0, error, cleanupError",
  "const stdoutHash = createHash('sha256'), stderrHash = createHash('sha256')",
  "const grouped = process.platform !== 'win32'",
  "const child = spawn(input.command[0], input.command.slice(1), { cwd: input.cwd, env: input.environment, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, detached: grouped })",
  "const write = (descriptor, chunk) => { let offset = 0; while (offset < chunk.length) offset += writeSync(descriptor, chunk, offset, chunk.length - offset) }",
  "const record = (descriptor, chunk) => { write(descriptor, chunk); if (log !== null) write(log, chunk) }",
  "const retain = (descriptor, digest, chunk, isStdout) => { const remaining = Math.max(0, input.maxOutputBytes - stdoutBytes - stderrBytes); const bytes = chunk.subarray(0, remaining); try { record(descriptor, bytes); digest.update(bytes); if (isStdout) stdoutBytes += bytes.length; else stderrBytes += bytes.length } catch (failure) { error = failure.message; stop('capture-failure') } if (bytes.length !== chunk.length) stop('output-limit') }",
  "child.stdout.on('data', chunk => retain(stdout, stdoutHash, chunk, true))",
  "child.stderr.on('data', chunk => retain(stderr, stderrHash, chunk, false))",
  "child.on('error', failure => { error = failure.message })",
  "const killTree = force => {",
  "  if (!child.pid) return",
  "  if (grouped) { try { process.kill(-child.pid, force ? 'SIGKILL' : 'SIGTERM') } catch (failure) { if (failure.code !== 'ESRCH') cleanupError = failure.message } }",
  "  else { const killer = spawn('taskkill', ['/pid', String(child.pid), '/t', ...(force ? ['/f'] : [])], { stdio: 'ignore', windowsHide: true }); killer.on('error', failure => { cleanupError = failure.message }) }",
  "}",
  "let resolveCompletion",
  "const completion = new Promise(resolve => { resolveCompletion = resolve })",
  "child.once('close', (exitCode, signal) => resolveCompletion({ exitCode, signal, closeObserved: true }))",
  "let stopped = false, timedOut = false, terminationReason, forceStop, cleanupDeadline",
  "const stop = reason => { if (stopped) return; stopped = true; terminationReason = reason; timedOut = reason === 'deadline'; killTree(false); forceStop = setTimeout(() => killTree(true), 2000); forceStop.unref(); cleanupDeadline = setTimeout(() => { cleanupError = 'Process tree did not close after forced termination'; child.stdout.removeAllListeners('data'); child.stderr.removeAllListeners('data'); child.stdout.destroy(); child.stderr.destroy(); child.unref(); resolveCompletion({ exitCode: null, signal: null, closeObserved: false }) }, 5000); cleanupDeadline.unref() }",
  "process.on('SIGTERM', () => stop('SIGTERM')); process.on('SIGINT', () => stop('SIGINT'))",
  "const deadline = setTimeout(() => stop('deadline'), input.timeoutMs)",
  "const parentCheck = setInterval(() => { try { process.kill(input.parentPid, 0) } catch { stop('parent-exited') } }, 1000)",
  "parentCheck.unref()",
  "const result = await completion",
  "clearInterval(parentCheck); clearTimeout(deadline); if (forceStop) clearTimeout(forceStop); if (cleanupDeadline) clearTimeout(cleanupDeadline)",
  "if (stopped) killTree(true)",
  "closeSync(stdout); closeSync(stderr); if (log !== null) closeSync(log)",
  "writeFileSync(input.result, JSON.stringify({ ...result, error, cleanupError, timedOut, terminationReason, timeoutMs: input.timeoutMs, processId: child.pid ?? null, nodeVersion: process.version, stdoutBytes, stderrBytes, stdoutSha256: stdoutHash.digest('hex'), stderrSha256: stderrHash.digest('hex') }), { flag: 'wx', mode: 0o600 })",
].join('\n')

/** Capture real command output without Bun test's subprocess capture path. */
export async function captureTestCommand(command: string[], options: {
  cwd?: string
  environment?: NodeJS.ProcessEnv
  log?: string
  timeoutMs?: number
  maxOutputBytes?: number
} = {}): Promise<{ exitCode: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string; nodeVersion: string; timedOut: boolean; timeoutMs: number; terminationReason?: string }> {
  if (!command[0]) throw new Error('A captured command requires an executable')
  const timeoutMs = options.timeoutMs ?? DEFAULT_WHOLE_SUITE_TIMEOUT_MS
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 3_600_000) throw new Error('Command timeout must be a positive integer at most 3600000')
  const maxOutputBytes = options.maxOutputBytes ?? MAX_CAPTURE_BYTES
  if (!Number.isSafeInteger(maxOutputBytes) || maxOutputBytes < 1 || maxOutputBytes > MAX_CAPTURE_BYTES) throw new Error('Output limit must be a positive integer at most 67108864')
  const directory = await mkdtemp(join(tmpdir(), 'rox-test-capture-'))
  const driver = join(directory, 'capture.mjs'), input = join(directory, 'input.json'), result = join(directory, 'result.json')
  const stdoutPath = join(directory, 'stdout'), stderrPath = join(directory, 'stderr')
  const environment = options.environment ?? process.env
  try {
    await writeFile(driver, NODE_CAPTURE_DRIVER, { flag: 'wx', mode: 0o600 })
    // Environment values can include integration credentials; the protected
    // transient input is removed together with the capture directory.
    await writeFile(input, JSON.stringify({ command, cwd: options.cwd ?? process.cwd(), environment, log: options.log, timeoutMs, maxOutputBytes,
      stdout: stdoutPath, stderr: stderrPath, result, parentPid: process.pid }), { flag: 'wx', mode: 0o600 })
    const broker = Bun.spawn(['node', driver, input], { env: environment, stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' })
    const brokerExit = await broker.exited
    if (brokerExit !== 0 || !existsSync(result)) throw new Error(`Node command capture did not complete (exit ${brokerExit})`)
    const receiptBytes = await readRegularFile(result, 64 * 1024)
    if (!receiptBytes) throw new Error('Command capture receipt is not a regular file')
    const receipt = JSON.parse(receiptBytes.toString('utf8'))
    if (receipt.error) throw new Error(`Command capture failed: ${receipt.error}`)
    if (!(receipt.exitCode === null || Number.isInteger(receipt.exitCode)) ||
      !(receipt.signal === null || typeof receipt.signal === 'string') || typeof receipt.nodeVersion !== 'string' ||
      typeof receipt.timedOut !== 'boolean' || receipt.timeoutMs !== timeoutMs) {
      throw new Error('Node command capture returned an invalid completion receipt')
    }
    const [stdout, stderr] = await Promise.all([readRegularFile(stdoutPath, maxOutputBytes), readRegularFile(stderrPath, maxOutputBytes)])
    if (!stdout || !stderr || stdout.length !== receipt.stdoutBytes || stderr.length !== receipt.stderrBytes) throw new Error('Node command capture returned incomplete output')
    if (hash(stdout) !== receipt.stdoutSha256 || hash(stderr) !== receipt.stderrSha256) throw new Error('Node command capture returned substituted output')
    if (receipt.cleanupError || receipt.closeObserved !== true) throw new Error('Command process-tree cleanup failed: ' + (receipt.cleanupError ?? 'child close was not observed'))
    return { exitCode: receipt.exitCode, signal: receipt.signal, nodeVersion: receipt.nodeVersion,
      stdout: stdout.toString('utf8'), stderr: stderr.toString('utf8'), timedOut: receipt.timedOut,
      timeoutMs, terminationReason: receipt.terminationReason }
  } finally { await rm(directory, { recursive: true, force: true }) }
}

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
  // 5 s (bun's default) produces false reds on loaded developer machines for
  // I/O-heavy suites (subprocess spawn, file rotation, WS boot); 15 s keeps a
  // genuinely hung test bounded while surviving a 3-4× slowdown. CI overrides
  // are unaffected (explicit --timeout / ROX_TEST_TIMEOUT_MS still win).
  if (value === undefined) return 15_000
  if (!/^[1-9]\d*$/.test(value) || Number(value) > 300_000) throw new Error('ROX_TEST_TIMEOUT_MS / --timeout must be a positive integer at most 300000')
  return Number(value)
}

function wholeSuiteTimeout(value: string | undefined): number {
  if (value === undefined) return DEFAULT_WHOLE_SUITE_TIMEOUT_MS
  if (!/^[1-9]\d*$/.test(value) || Number(value) > 3_600_000) throw new Error('ROX_TEST_SUITE_TIMEOUT_MS / --suite-timeout must be a positive integer at most 3600000')
  return Number(value)
}

const NATIVE_PRODUCT_DIR = 'tests/e2e/product-tour'
const NATIVE_PRODUCT_CONFIG = `${NATIVE_PRODUCT_DIR}/native.config.ts`

export const MAX_CONCURRENCY = 64

function concurrencyValue(value: string | undefined): number {
  if (value === undefined) return defaultConcurrency()
  if (!/^[1-9]\d*$/.test(value) || Number(value) > MAX_CONCURRENCY)
    throw new Error(`Concurrency must be a positive integer at most ${MAX_CONCURRENCY} (ROX_TEST_CONCURRENCY / --concurrency)`)
  return Number(value)
}

/** One parallel suite per remaining CPU core, capped so browser and Postgres
 *  suites (each spawning heavy children) do not thrash a small runner. */
function defaultConcurrency(): number {
  const cores = availableParallelism?.() ?? 2
  return Math.max(1, Math.min(4, cores - 1))
}

export interface Shard { index: number; total: number }

export function parseShard(value: string): Shard {
  const match = /^([1-9]\d*)\/([1-9]\d*)$/.exec(value)
  if (!match) throw new Error('--shard must be k/n with positive integers (for example --shard=2/4)')
  const index = Number(match[1]), total = Number(match[2])
  if (index > total) throw new Error('--shard index must not exceed its total')
  return { index, total }
}

/** Deterministic partition over the path-sorted suite list: shard k takes every
 *  n-th suite starting at k-1, so k/n over all k covers the list exactly once. */
export function shardSuites(suites: TestSuite[], shard: Shard): TestSuite[] {
  return suites.filter((_, position) => position % shard.total === shard.index - 1)
}

/** Run `worker` over every item with a fixed in-flight width. Results are
 *  reported by index, not completion order, so callers stay deterministic. A
 *  worker failure stops new dispatch, lets in-flight suites finish, then
 *  rejects with the first error (matching the former serial abort semantics). */
async function forEachConcurrent<T>(items: readonly T[], concurrency: number, worker: (item: T, index: number) => Promise<void>): Promise<void> {
  let next = 0, failed = false
  let failure: unknown
  const width = Math.max(1, Math.min(concurrency, items.length))
  await Promise.all(Array.from({ length: width }, async () => {
    while (!failed) {
      const index = next++
      if (index >= items.length) return
      try { await worker(items[index]!, index) } catch (error) { if (!failed) { failed = true; failure = error } }
    }
  }))
  if (failed) throw failure
}

// --- Cross-process fixed-port leases ----------------------------------------
// The lease is an exclusive lock file (O_EXCL) under a host-global directory,
// so it serializes owners of one port both inside this process and across two
// concurrent shard processes on one host; ports are a host resource, not a
// per-run one. Locks are taken in ascending port order (callers sort), so a
// suite that owns two ports cannot deadlock with another. A lease whose owner
// process is gone is reclaimed at once; a live owner is always bounded by its
// own whole-suite deadline, after which the capture driver force-kills the
// child and the lease is released.
const FIXED_PORT_LOCK_DIRECTORY = join(tmpdir(), 'rox-test-all-port-locks')
const PORT_LOCK_POLL_MS = 200
const PORT_LOCK_GRACE_MS = 5_000

function processAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try { process.kill(pid, 0); return true }
  catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM' }
}

async function portLockOwner(path: string): Promise<{ pid: number } | null> {
  try {
    const value = JSON.parse(await readFile(path, 'utf8')) as { pid?: unknown }
    return typeof value.pid === 'number' ? { pid: value.pid } : null
  } catch { return null }
}

export async function acquirePortLease(port: number, waitMs: number): Promise<() => Promise<void>> {
  await mkdir(FIXED_PORT_LOCK_DIRECTORY, { recursive: true })
  const path = join(FIXED_PORT_LOCK_DIRECTORY, `port-${port}.lock`)
  const deadline = Date.now() + waitMs
  for (;;) {
    try {
      const handle = await open(path, 'wx', 0o600)
      await handle.writeFile(JSON.stringify({ pid: process.pid, port }))
      await handle.close()
      let released = false
      return async () => { if (released) return; released = true; await rm(path, { force: true }) }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
    const owner = await portLockOwner(path)
    if (owner && !processAlive(owner.pid)) { await rm(path, { force: true }); continue }
    if (!owner) {
      // A fresh exclusive create may still be mid-write; only reclaim an
      // unreadable lock after the grace window so a racing owner cannot be
      // double-granted the same port.
      const age = await lstat(path).then(entry => Date.now() - entry.mtimeMs).catch(() => Infinity)
      if (age > PORT_LOCK_GRACE_MS) { await rm(path, { force: true }); continue }
    }
    if (Date.now() >= deadline) throw new Error(`Fixed-port ${port} lease wait exceeded ${waitMs}ms (held by pid ${owner?.pid ?? 'unknown'})`)
    await Bun.sleep(PORT_LOCK_POLL_MS)
  }
}

const PLAYWRIGHT_CONFIG_PORTS = new Map<string, number[]>()

/** Ports a Playwright config's webServers bind; read once per absolute path. */
async function playwrightConfigPorts(root: string, config: string): Promise<number[]> {
  const absolute = join(root, config)
  const cached = PLAYWRIGHT_CONFIG_PORTS.get(absolute)
  if (cached) return cached
  const bytes = await readRegularFile(absolute, MAX_TEST_SOURCE_BYTES)
  const ports = bytes ? fixedPorts(bytes.toString('utf8')) : []
  PLAYWRIGHT_CONFIG_PORTS.set(absolute, ports)
  return ports
}

export async function loadBaseline(path: string): Promise<BaselineFile | null> {
  if (!existsSync(path)) return null
  const bytes = await readRegularFile(path, 1024 * 1024)
  if (!bytes) return null
  let parsed: unknown
  try { parsed = JSON.parse(bytes.toString('utf8')) } catch { throw new Error(`Test baseline is not valid JSON: ${path}`) }
  const baseline = parsed as Partial<BaselineFile>
  if (baseline?.schemaVersion !== 1 || !Array.isArray(baseline.knownRed) || baseline.knownRed.some(entry => typeof entry !== 'string'))
    throw new Error(`Test baseline must declare schemaVersion 1 and a string knownRed[]: ${path}`)
  return { schemaVersion: 1, description: baseline.description, source: baseline.source, knownRed: baseline.knownRed }
}

export async function writeBaseline(path: string, knownRed: Iterable<string>, description?: string): Promise<void> {
  const file: BaselineFile = { schemaVersion: 1, description, knownRed: [...new Set(knownRed)].sort() }
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, JSON.stringify(file, null, 2) + '\n')
}

/** Split results into expected redness and regressions against the baseline.
 *  Without a baseline every red suite is a new failure, preserving the former
 *  all-or-nothing signal. */
function classifyBaseline(results: SuiteResult[], baseline: ReadonlySet<string> | null): ReportBaseline {
  const report: ReportBaseline = { path: null, schemaVersion: null, knownRed: [], newFailures: [], stalePass: [] }
  for (const result of results) {
    const isKnown = baseline?.has(result.path) ?? false
    if (result.status === 'passed') {
      if (isKnown) report.stalePass.push(result.path)
      result.knownRed = false
    } else {
      result.knownRed = isKnown
      if (isKnown) report.knownRed.push(result.path)
      else report.newFailures.push(result.path)
    }
  }
  report.knownRed.sort(); report.newFailures.sort(); report.stalePass.sort()
  return report
}

async function nearestConfiguration(root: string, file: string, kind: 'playwright' | 'vitest') {
  // This native product entry has a separate existing config. Its sibling
  // browser config deliberately excludes native tests; falling back to it
  // would discover the file without ever executing its acceptance case.
  // Native suites are selected by the `.native.spec.ts` suffix inside the
  // product-tour directory, not by an exhaustive allowlist.
  const nativePath = portable(relative(root, file))
  if (kind === 'playwright' && nativePath.startsWith(`${NATIVE_PRODUCT_DIR}/`) && nativePath.endsWith('.native.spec.ts')) {
    try { return await readRegularFile(join(root, NATIVE_PRODUCT_CONFIG)) ? NATIVE_PRODUCT_CONFIG : undefined }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error }
  }
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

/** Vendored skill packs are shipped as Electron resources, not workspace
 *  packages: they carry package.json only, without node_modules or build
 *  outputs, so their suites cannot run under the aggregate runner. This is a
 *  path prefix (not a directory name) so unrelated `skills` directories in
 *  repo-authored source stay discovered. */
const OMITTED_SOURCE_PREFIXES = ['apps/electron/resources/skills/']

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
  if (!gitRoot.trim()) throw new Error('Git test inventory returned an empty checkout binding')
  const output = await gitOutput(root, ['ls-files', '--cached', '--others', '--exclude-standard', '-z'])
  if (output === null) throw new Error('Git test inventory unavailable')
  if (!output) throw new Error('Git test inventory is empty; refusing an empty green run')
  // Preserve whitespace in names; tracked files remain present even if an
  // ignore rule now matches them. New source files use Git's ignore policy.
  return [...new Set(output.split('\0').filter(Boolean))]
}

/** Check and use the same inode, even if its pathname changes during IO.
 * Ancestor re-checks compare the current resolution with the snapshot below:
 * Windows realpath spellings are not fixed points (8.3 short names, drive-root
 * form), so requiring each ancestor to resolve onto its own spelling would
 * reject a stable directory instead of detecting an actual replacement. */
const MAX_TEST_SOURCE_BYTES = 16 * 1024 * 1024
const MAX_CAPTURE_BYTES = 64 * 1024 * 1024
const descriptorAncestors = new WeakMap<import('node:fs/promises').FileHandle, () => Promise<void>>()

async function openRegularFile(path: string, flags: number, mode?: number) {
  const directory = await realpath(dirname(path))
  const ancestors: Array<{ path: string; dev: bigint; ino: bigint; resolved: string }> = []
  for (let parent = directory; ; parent = dirname(parent)) {
    const stat = await lstat(parent, { bigint: true })
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new Error(`File ancestor changed: ${parent} is ${stat.isSymbolicLink() ? 'a symbolic link' : 'not a directory'}`)
    ancestors.push({ path: parent, dev: stat.dev, ino: stat.ino, resolved: await realpath(parent) })
    if (dirname(parent) === parent) break
  }
  const assertAncestors = async () => {
    const currentDirectory = await realpath(dirname(path))
    if (currentDirectory !== directory) throw new Error(`File ancestor changed: ${dirname(path)} now resolves to ${currentDirectory}, not ${directory}`)
    for (const ancestor of ancestors) {
      const stat = await lstat(ancestor.path, { bigint: true })
      const current = await realpath(ancestor.path)
      const drift = !stat.isDirectory() ? 'is no longer a directory'
        : stat.isSymbolicLink() ? 'became a symbolic link'
        : stat.dev !== ancestor.dev || stat.ino !== ancestor.ino ? `identity changed from ${ancestor.dev}:${ancestor.ino} to ${stat.dev}:${stat.ino}`
        : current !== ancestor.resolved ? `now resolves to ${current}, previously ${ancestor.resolved}` : undefined
      if (drift) throw new Error(`File ancestor changed: ${ancestor.path} ${drift}`)
    }
  }
  const noFollow = constants.O_NOFOLLOW ?? 0, nonBlock = constants.O_NONBLOCK ?? 0
  let file
  try { file = await open(path, flags | noFollow | nonBlock, mode) }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ELOOP') return null; throw error }
  let accepted = false
  try {
    // Windows has no O_NOFOLLOW: compare the opened inode with the current leaf.
    const entry = noFollow ? undefined : await lstat(path, { bigint: true })
    const inode = await file.stat({ bigint: true })
    if (!inode.isFile() || (entry && !entry.isFile())) return null
    if (entry && (entry.dev !== inode.dev || entry.ino !== inode.ino)) throw new Error('File identity changed while opening')
    await assertAncestors()
    descriptorAncestors.set(file, assertAncestors)
    accepted = true
    return file
  } finally { if (!accepted) await file.close() }
}

/** Snapshot only bytes from the checked descriptor; later execution rechecks its hash.
 * A renamed leaf can still be this same snapshot, but changed ancestors or writes
 * must fail. Reads cannot allocate beyond the declared source/capture envelope. */
async function readOpenedFile(file: import('node:fs/promises').FileHandle, maxBytes: number) {
  const before = await file.stat({ bigint: true })
  if (!before.isFile() || before.size > BigInt(maxBytes)) throw new Error('Regular file exceeds bounded read limit')
  await descriptorAncestors.get(file)?.()
  const chunks: Buffer[] = [], buffer = Buffer.alloc(Math.min(64 * 1024, maxBytes + 1))
  let length = 0
  while (true) {
    const { bytesRead } = await file.read(buffer, 0, Math.min(buffer.length, maxBytes + 1 - length), length)
    if (!bytesRead) break
    length += bytesRead
    if (length > maxBytes) throw new Error('Regular file exceeds bounded read limit')
    chunks.push(Buffer.from(buffer.subarray(0, bytesRead)))
  }
  const after = await file.stat({ bigint: true })
  if (!after.isFile() || after.dev !== before.dev || after.ino !== before.ino || after.size !== BigInt(length)
    || after.size !== before.size || after.mtimeNs !== before.mtimeNs) throw new Error('File changed during bounded read')
  await descriptorAncestors.get(file)?.()
  return Buffer.concat(chunks, length)
}

async function readRegularFile(path: string, maxBytes = MAX_CAPTURE_BYTES + 64 * 1024) {
  const file = await openRegularFile(path, constants.O_RDONLY)
  if (!file) return null
  try { return await readOpenedFile(file, maxBytes) } finally { await file.close() }
}

async function appendExecutionError(path: string, message: string) {
  let file
  try { file = await openRegularFile(path, constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | constants.O_EXCL, 0o600) }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    // Open an existing inode without O_CREAT: a substituted dangling symlink
    // cannot create a file outside the execution directory on Windows.
    file = await openRegularFile(path, constants.O_WRONLY | constants.O_APPEND)
  }
  if (!file) throw new Error('Execution log is not a regular file')
  try { await file.writeFile(message) } finally { await file.close() }
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
      omittedDirectories: ['node_modules', '.git'],
      omittedPaths: [...OMITTED_SOURCE_PREFIXES],
      hiddenStandardFiles: 0,
    },
  }
  async function inspect(path: string, hidden: boolean) {
    const name = basename(path)
    if (!STANDARD_TEST.test(name) && !ISOLATED_TEST.test(name)) return
    const pathFromRoot = portable(relative(root, path))
    if (OMITTED_SOURCE_PREFIXES.some(prefix => pathFromRoot.startsWith(prefix))) return
    // Do not follow symlinks into dependency checkouts or external profiles.
    // An enumerated source disappearing is an error, not reduced coverage.
    const file = await openRegularFile(path, constants.O_RDONLY)
    if (!file) return
    let content: Buffer
    try {
      if (hidden && !ISOLATED_TEST.test(name)) { manifest.discovery.hiddenStandardFiles += 1; return }
      content = await readOpenedFile(file, MAX_TEST_SOURCE_BYTES)
    } finally { await file.close() }
    const source = content.toString('utf8')
    const dependencies = imports(source)
    const runner: TestRunner = dependencies.has('bun:test') ? 'bun'
      : dependencies.has('@playwright/test') ? 'playwright'
      : dependencies.has('vitest') ? 'vitest' : 'bun'
    // A suite owns the literals in its source only when it starts a server or a
    // child; a client-only URL reference stays parallel. A Playwright suite
    // additionally owns whatever its webServer config binds.
    const suite: TestSuite = {
      path: portable(relative(root, path)), runner, sha256: hash(content),
      ports: SERVER_SPAWN_PATTERN.test(source) ? fixedPorts(source) : [],
    }
    if (runner !== 'bun') {
      suite.config = await nearestConfiguration(root, path, runner)
      suite.packageRoot = nearestPackage(root, path)
      if (!suite.config) suite.prerequisiteError = `${runner} config not found for ${suite.path}`
      else if (runner === 'playwright') {
        if (suite.path.startsWith(`${NATIVE_PRODUCT_DIR}/`) && suite.path.endsWith('.native.spec.ts')
          && process.platform !== 'darwin' && process.platform !== 'win32')
          suite.prerequisiteError = `Native product-tour suite requires macOS or Windows; unavailable on ${process.platform}`
        suite.ports = [...new Set([...suite.ports, ...await playwrightConfigPorts(root, suite.config)])].sort((a, b) => a - b)
      }
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
  const child = await captureTestCommand(['git', ...args], { cwd: root })
  return child.exitCode === 0 ? child.stdout : null
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

/** Continue after failures so the report retains the complete execution history.
 *
 * Suites run bounded-parallel with isolated process/HOME/config/artifact state;
 * results are stored at their deterministic manifest index, so the report and
 * the final summary are identical regardless of completion order. */
export async function runSuites(options: {
  root: string
  manifest: SuiteManifest
  artifactDirectory?: string
  environment?: NodeJS.ProcessEnv
  onResult?: (result: SuiteResult, completed: number, expected: number) => void
  concurrency?: number
  baseline?: ReadonlySet<string>
  baselinePath?: string | null
  strict?: boolean
}): Promise<TestReport> {
  const root = resolve(options.root)
  if (resolve(options.manifest.root) !== root) throw new Error('Suite manifest belongs to a different checkout')
  if (!options.manifest.suites.length) throw new Error('No test files discovered; refusing an empty green run')
  const environment = options.environment ?? process.env
  const bunTimeoutMs = testTimeout(environment.ROX_TEST_TIMEOUT_MS)
  // Bun's per-test deadline cannot interrupt a synchronous native call or
  // top-level module evaluation. This separate process envelope keeps those
  // failures bounded without changing any test's own timeout or assertion.
  const wholeSuiteTimeoutMs = wholeSuiteTimeout(environment.ROX_TEST_SUITE_TIMEOUT_MS)
  const concurrency = options.concurrency ?? 1
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > MAX_CONCURRENCY)
    throw new Error(`Concurrency must be an integer between 1 and ${MAX_CONCURRENCY}`)
  const artifactDirectory = await createArtifactRun(options.artifactDirectory ?? environment.ROX_TEST_ARTIFACT_DIR ?? join(root, 'work/test-all'))
  const manifestPath = join(artifactDirectory, 'manifest.json')
  const manifest = JSON.stringify(options.manifest, null, 2) + '\n'
  await writeFile(manifestPath, manifest)
  const [node, head, diff] = await Promise.all([
    captureTestCommand(['node', '--version'], { environment }), gitOutput(root, ['rev-parse', 'HEAD']), gitOutput(root, ['diff', '--binary', 'HEAD']),
  ])
  if (node.exitCode !== 0 || !/^v\d+\.\d+\.\d+\s*$/.test(node.stdout)) throw new Error('Node runtime qualification returned no version')
  // Placeholder slots keep one result per manifest index before any suite has
  // finished, so a mid-run checkpoint and the final report share one ordering.
  const report: TestReport = {
    schemaVersion: 1, status: 'running', root, artifactDirectory, manifestPath, reportPath: join(artifactDirectory, 'report.json'),
    input: { head: head?.trim() ?? null, trackedDiffSha256: diff === null ? null : hash(diff), manifestSha256: hash(manifest), runnerSha256: hash(readFileSync(import.meta.filename)), bunVersion: Bun.version, nodeVersion: node.stdout.trim() },
    startedAt: new Date().toISOString(), serial: concurrency === 1, concurrency, bunTimeoutMs, wholeSuiteTimeoutMs,
    summary: { expected: options.manifest.suites.length, completed: 0, passed: 0, failed: 0, blocked: 0, knownRed: 0, newFailures: 0, stalePass: 0 },
    baseline: { path: options.baselinePath ?? null, schemaVersion: options.baselinePath ? 1 : null, knownRed: [], newFailures: [], stalePass: [] },
    results: options.manifest.suites.map(suite => ({
      path: suite.path, runner: suite.runner, status: 'blocked', exitCode: null, command: [],
      configRoot: '', homeRoot: '', log: '', logSha256: '', durationMs: 0, testCounts: null,
    })),
  }
  // Parallel completions checkpoint concurrently; a promise chain serializes the
  // writes and each body is snapshotted at call time so no interleaving corrupts it.
  let checkpointChain = Promise.resolve()
  const checkpoint = () => {
    const body = JSON.stringify(report, null, 2) + '\n'
    checkpointChain = checkpointChain.then(() => writeFile(report.reportPath, body))
    return checkpointChain
  }
  await checkpoint()
  // Browser suites resolve Chromium from the caller's environment or from the
  // Playwright cache under the real HOME; every suite here runs with an
  // isolated HOME, so resolve one host browser up front and export it to the
  // suites through the same variables the CI workflows bind.
  const browserExecutable = resolveBrowserExecutable(environment)
  const browserCacheRoot = [environment.PLAYWRIGHT_BROWSERS_PATH, join(homedir(), 'Library', 'Caches', 'ms-playwright'), join(homedir(), '.cache', 'ms-playwright')].find((candidate): candidate is string => Boolean(candidate && existsSync(candidate)))

  const executeSuite = async (suite: TestSuite, index: number) => {
    const directory = join(artifactDirectory, `${String(index + 1).padStart(5, '0')}-${hash(suite.path).slice(0, 12)}`)
    await mkdir(directory)
    const configRoot = await mkdtemp(join(tmpdir(), 'rox-test-config-'))
    const homeRoot = join(directory, 'home')
    await mkdir(homeRoot, { mode: 0o700 })
    // Direct *.isolated.ts suites can clean paths relative to homedir(). Each
    // executor and its descendants must resolve those paths inside this suite,
    // while the caller's protected integration paths and toolchains survive.
    const homeEnvironment = {
      HOME: homeRoot, USERPROFILE: homeRoot,
      XDG_CONFIG_HOME: join(homeRoot, '.config'), XDG_CACHE_HOME: join(homeRoot, '.cache'),
      XDG_DATA_HOME: join(homeRoot, '.local', 'share'),
      APPDATA: join(homeRoot, 'AppData', 'Roaming'), LOCALAPPDATA: join(homeRoot, 'AppData', 'Local'),
    }
    await Promise.all([...new Set(Object.values(homeEnvironment))].filter(path => path !== homeRoot)
      .map(path => mkdir(path, { recursive: true, mode: 0o700 })))
    const log = join(directory, 'output.log')
    const result: SuiteResult = { path: suite.path, runner: suite.runner, status: 'blocked', exitCode: null, command: [], configRoot, homeRoot, log, logSha256: '', durationMs: 0, testCounts: null }
    report.results[index] = result
    const started = performance.now()
    const releases: Array<() => Promise<void>> = []
    try {
      // Two suites that own the same fixed port must never overlap: take one
      // lease per port in ascending order so a suite with several ports cannot
      // deadlock against another. Ports are host-global, so the lease also
      // serializes a second shard process running on this host.
      for (const port of [...suite.ports].sort((a, b) => a - b)) releases.push(await acquirePortLease(port, wholeSuiteTimeoutMs + 60_000))
      const source = await readRegularFile(join(root, suite.path), MAX_TEST_SOURCE_BYTES)
      if (!source) throw new Error('Test source is not a regular file; regenerate the manifest')
      if (hash(source) !== suite.sha256) throw new Error('Test source changed since discovery; regenerate the manifest')
      if (suite.prerequisiteError) throw new Error(suite.prerequisiteError)
      result.command = commandFor(root, suite, directory, bunTimeoutMs, environment)
      const childEnv: NodeJS.ProcessEnv = { ...environment, ...homeEnvironment, ROX_CONFIG_DIR: configRoot, CRAFT_CONFIG_DIR: configRoot }
      // The existing meeting script explicitly opts into U1 fixtures. Preserve
      // that evidence boundary, while respecting a product opt-in from the caller.
      if (suite.runner === 'playwright' && suite.config === 'tests/e2e/meeting-agents/playwright.config.ts'
        && childEnv.ROX_MEETING_USE_PACKAGED_APP !== '1') childEnv.ROX_MEETING_E2E_FIXTURE ??= '1'
      // Browser harnesses still need a real executable while HOME is isolated
      // for this suite; repair missing or dangling browser bindings with the
      // host-resolved Chromium and Playwright cache root.
      if (browserExecutable) {
        for (const name of ['ROX_BROWSER_PATH', 'CHROMIUM_EXECUTABLE', 'LEARNING_CHROMIUM_PATH'] as const) {
          const current = childEnv[name]
          if (!current || !existsSync(current)) childEnv[name] = browserExecutable
        }
      }
      if (browserCacheRoot) {
        const current = childEnv.PLAYWRIGHT_BROWSERS_PATH
        if (!current || !existsSync(current)) childEnv.PLAYWRIGHT_BROWSERS_PATH = browserCacheRoot
      }
      const cwd = suite.runner === 'vitest' ? resolve(root, suite.packageRoot ?? '.') : root
      const child = await captureTestCommand(result.command, { cwd, environment: childEnv, log, timeoutMs: wholeSuiteTimeoutMs })
      result.exitCode = child.exitCode
      result.signal = child.signal
      result.timedOut = child.timedOut
      result.status = result.exitCode === 0 ? 'passed' : 'failed'
      if (child.timedOut || child.terminationReason) {
        result.status = 'failed'
        throw new Error(child.timedOut ? `Whole-suite process deadline exceeded after ${wholeSuiteTimeoutMs}ms` : `Test process interrupted: ${child.terminationReason}`)
      }
      if (result.exitCode === 0 && !child.stdout.length && !child.stderr.length) {
        result.status = 'failed'
        throw new Error('Test executor exited successfully without execution output; refusing an empty green result')
      }
    } catch (error) {
      result.error = error instanceof Error ? error.message : String(error)
      await appendExecutionError(log, `${result.error}\n`)
    } finally {
      for (const release of releases.reverse()) await release()
    }
    result.durationMs = Math.round(performance.now() - started)
    const content = await readRegularFile(log)
    if (!content) throw new Error('Execution log is not a regular file')
    result.logSha256 = hash(content)
    result.testCounts = suite.runner === 'bun' ? bunCounts(content.toString('utf8')) : null
    report.summary.completed += 1
    report.summary[result.status] += 1
    await checkpoint()
    options.onResult?.(result, report.summary.completed, report.summary.expected)
  }

  await forEachConcurrent(options.manifest.suites, concurrency, executeSuite)
  report.baseline = classifyBaseline(report.results, options.baseline ?? null)
  report.baseline.path = options.baselinePath ?? null
  report.baseline.schemaVersion = options.baseline ? 1 : null
  report.summary.knownRed = report.baseline.knownRed.length
  report.summary.newFailures = report.baseline.newFailures.length
  report.summary.stalePass = report.baseline.stalePass.length
  const red = options.strict === true ? report.summary.failed + report.summary.blocked : report.summary.newFailures
  report.status = red ? 'failed' : 'passed'
  report.finishedAt = new Date().toISOString()
  await checkpoint()
  return report
}

// Browser suites in this repository resolve an executable from
// ROX_BROWSER_PATH/CHROMIUM_EXECUTABLE/LEARNING_CHROMIUM_PATH, or from a
// Playwright-managed download under the real HOME. The per-suite environment
// replaces HOME, so the runner resolves one host browser and hands the
// absolute path to every suite; a suite keeps its own explicit failure when
// no browser resolves at all.
function resolveBrowserExecutable(environment: NodeJS.ProcessEnv): string | null {
  const candidates: Array<string | undefined> = [
    environment.ROX_BROWSER_PATH, environment.CHROMIUM_EXECUTABLE, environment.LEARNING_CHROMIUM_PATH,
    '/Applications/Chromium.app/Contents/MacOS/Chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/chromium', '/usr/bin/chromium-browser',
  ]
  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) return candidate
  }
  const executable = chromium.executablePath()
  return existsSync(executable) ? executable : null
}

async function main() {
  let root = process.env.ROX_TEST_ROOT ?? resolve(import.meta.dir, '..')
  let list = false
  let filter: string | undefined
  let timeout = process.env.ROX_TEST_TIMEOUT_MS
  let suiteTimeout = process.env.ROX_TEST_SUITE_TIMEOUT_MS
  let shardFlag: string | undefined
  let concurrencyFlag: string | undefined
  let baselineFlag: string | undefined
  let noBaseline = false
  let updateBaseline = false
  let forceSubsetBaseline = false
  let strict = false
  const args: string[] = []
  // Accept both `--flag value` and `--flag=value` (the task's `--shard=k/n`).
  for (const raw of process.argv.slice(2)) {
    const equals = raw.startsWith('--') ? raw.indexOf('=') : -1
    if (equals > 2) args.push(raw.slice(0, equals), raw.slice(equals + 1))
    else args.push(raw)
  }
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!
    if (arg === '--list') list = true
    else if (arg === '--no-baseline') noBaseline = true
    else if (arg === '--update-baseline') updateBaseline = true
    else if (arg === '--force-subset-baseline') forceSubsetBaseline = true
    else if (arg === '--strict') strict = true
    else if (arg === '--root' || arg === '--filter' || arg === '--timeout' || arg === '--suite-timeout'
      || arg === '--shard' || arg === '--concurrency' || arg === '--baseline') {
      const value = args[++index]
      if (!value) throw new Error(`${arg} requires a value`)
      if (arg === '--root') root = value
      else if (arg === '--filter') filter = value
      else if (arg === '--timeout') timeout = value
      else if (arg === '--suite-timeout') suiteTimeout = value
      else if (arg === '--shard') shardFlag = value
      else if (arg === '--concurrency') concurrencyFlag = value
      else baselineFlag = value
    } else throw new Error(`Unknown test runner option: ${arg}`)
  }
  if (noBaseline && baselineFlag) throw new Error('--baseline and --no-baseline are mutually exclusive')
  root = resolve(root)
  const bunTimeoutMs = testTimeout(timeout)
  const wholeSuiteTimeoutMs = wholeSuiteTimeout(suiteTimeout)
  const concurrency = concurrencyValue(concurrencyFlag ?? process.env.ROX_TEST_CONCURRENCY)
  const shard = shardFlag === undefined ? null : parseShard(shardFlag)
  // Rewriting the checked-in baseline from a shard or filter would silently
  // delete every entry outside this subset and then call the truncated file a
  // clean baseline. Require an explicit override for an intentional subset.
  if (updateBaseline && !forceSubsetBaseline && (shard !== null || filter !== undefined))
    throw new Error('--update-baseline refuses --shard/--filter because it would rewrite the checked-in baseline from a subset; pass --force-subset-baseline to confirm an intentional subset baseline')
  const manifest = await discoverSuites(root)
  if (filter !== undefined) manifest.suites = manifest.suites.filter(suite => suite.path.includes(filter!))
  if (!manifest.suites.length) throw new Error('No test files discovered; refusing an empty green run')
  if (shard) manifest.suites = shardSuites(manifest.suites, shard)
  const artifactDirectory = process.env.ROX_TEST_ARTIFACT_DIR ?? join(root, 'work/test-all')
  if (list) {
    const run = await createArtifactRun(artifactDirectory)
    const manifestPath = join(run, 'manifest.json')
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
    console.log(JSON.stringify({ status: 'listed', root, manifestPath, files: manifest.suites.length, filter: filter ?? null, shard: shard ?? null }))
    return
  }
  // A shard can legitimately own zero suites; that is an empty shard, not a missing run.
  if (!manifest.suites.length) {
    console.log(JSON.stringify({ status: 'empty-shard', root, files: 0, shard, filter: filter ?? null }))
    return
  }
  const defaultBaselinePath = join(root, 'scripts/test-baseline.json')
  const baselinePath = noBaseline ? null : baselineFlag ? resolve(baselineFlag) : defaultBaselinePath
  let baseline: Set<string> | null = null
  let baselineUsed: string | null = null
  if (baselinePath && !updateBaseline) {
    const file = await loadBaseline(baselinePath)
    if (file) { baseline = new Set(file.knownRed); baselineUsed = baselinePath }
    else if (baselineFlag) throw new Error(`Test baseline not found: ${baselinePath}`)
  }
  process.stderr.write(`test-all: ${manifest.suites.length} suites, concurrency ${concurrency}${shard ? `, shard ${shard.index}/${shard.total}` : ''}${baselineUsed ? `, baseline ${baselineUsed}` : ''}\n`)
  const report = await runSuites({
    root, manifest, artifactDirectory, concurrency, baseline: baseline ?? undefined, baselinePath: baselineUsed, strict,
    environment: { ...process.env, ROX_TEST_TIMEOUT_MS: String(bunTimeoutMs), ROX_TEST_SUITE_TIMEOUT_MS: String(wholeSuiteTimeoutMs) },
    onResult: (result, completed, expected) => {
      const mark = baseline?.has(result.path) ? ' (known-red)' : ''
      process.stderr.write(`[${completed}/${expected}] ${result.status}${mark} ${result.path} (${result.durationMs}ms)${result.error ? ': ' + result.error : ''}\n`)
    },
  })
  if (updateBaseline) {
    const target = baselinePath ?? defaultBaselinePath
    const red = report.results.filter(result => result.status !== 'passed').map(result => result.path)
    await writeBaseline(target, red, 'Suites already red on main; scripts/test-all.ts treats these as expected redness, not regressions.')
    console.log(JSON.stringify({ status: 'baseline-updated', path: target, knownRed: red.length }))
    return
  }
  process.stderr.write(`test-all: ${report.summary.passed} passed, ${report.summary.failed} failed, ${report.summary.blocked} blocked; ${report.summary.newFailures} new failure(s), ${report.summary.knownRed} known-red, ${report.summary.stalePass} stale baseline entr(y|ies)\n`)
  console.log(JSON.stringify({
    status: report.status, root, reportPath: report.reportPath, filter: filter ?? null, shard, concurrency,
    summary: report.summary,
    baseline: { path: report.baseline.path, knownRed: report.baseline.knownRed, newFailures: report.baseline.newFailures, stalePass: report.baseline.stalePass },
  }))
  process.exitCode = report.status === 'passed' ? 0 : 1
}

if (import.meta.main) main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1 })
