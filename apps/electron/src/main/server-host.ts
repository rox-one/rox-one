/**
 * #1586 (first slice) — host the RPC server in an Electron utilityProcess.
 *
 * Off by default. Only active when ROX_SERVER_UTILITY_PROCESS=1 AND the app is
 * not already a thin client (CRAFT_SERVER_URL unset). When active, main forks
 * the standalone server-core bootstrap (packages/server, built to
 * dist/server-host-worker.mjs), waits for its `CRAFT_SERVER_URL=` /
 * `ROX_SERVER_TOKEN=` readiness lines, and then sets CRAFT_SERVER_URL /
 * CRAFT_SERVER_TOKEN so the existing thin-client path (main/index.ts
 * `isClientOnly`, preload/bootstrap.ts) and its WS reconnect take over.
 *
 * With the flag off nothing in this file runs: `maybeStartServerHost` returns
 * null before touching electron, env or the filesystem.
 *
 * See docs/perf/server-utility-process.md for the handler inventory (what
 * must stay in main and how it is bridged).
 */
import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { getStartupTimeline } from './startup-marks'

export const SERVER_HOST_FLAG = 'ROX_SERVER_UTILITY_PROCESS'

/** Minimal child surface (electron.UtilityProcess or a test fake). */
export interface ServerHostChild {
  readonly pid?: number
  stdout?: { on(event: 'data', cb: (chunk: Buffer | string) => void): unknown } | null
  stderr?: { on(event: 'data', cb: (chunk: Buffer | string) => void): unknown } | null
  on(event: 'exit', cb: (code: number) => void): unknown
  postMessage?(message: unknown): void
  kill(): boolean
}

export type ServerHostForkFn = (
  modulePath: string,
  args: string[],
  options: { env: NodeJS.ProcessEnv; serviceName: string; stdio: 'pipe' },
) => ServerHostChild

export interface ServerHostReady {
  url: string
  token: string
  pid?: number
}

export interface ServerSupervisorOptions {
  fork: ServerHostForkFn
  workerPath: string
  /** Parent env; only allowlisted keys are passed to the child (see buildChildEnv). */
  env?: NodeJS.ProcessEnv
  /** Extra child env (resources path, app version…), applied after the allowlist. */
  childEnvExtras?: Record<string, string>
  /** Before the first readiness: total attempts (1 = no retry). Default 2. */
  preReadyMaxAttempts?: number
  /** Before the first readiness: ms to wait for the ready line. Default 10 s. */
  preReadyTimeoutMs?: number
  /** After the first readiness (restarts): ms to wait for the ready line. Default 30 s. */
  readyTimeoutMs?: number
  /** Restart backoff: base * 2^(n-1), capped. */
  backoffBaseMs?: number
  backoffMaxMs?: number
  /** After the first readiness: give up after this many consecutive crashes. */
  maxConsecutiveCrashes?: number
  /** A run that became ready and lasted this long resets the crash counter. */
  stableAfterMs?: number
  /** Grace period for clean shutdown before kill(). */
  shutdownGraceMs?: number
  /** After kill(), stop waiting for 'exit' after this long. */
  killHardTimeoutMs?: number
  log?: (level: 'info' | 'warn' | 'error', msg: string) => void
  /** Called on every (re)start once the child is listening. */
  onReady?: (ready: ServerHostReady) => void
  /** Called once restarts are exhausted AFTER a first successful start. */
  onGiveUp?: (lastExitCode: number) => void
  now?: () => number
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (handle: unknown) => void
}

/** argv marker added by the give-up relaunch; forces the in-process server. */
export const SERVER_HOST_DISABLE_ARG = '--rox-no-server-utility-process'

export function isServerHostEnabled(env: NodeJS.ProcessEnv = process.env, argv: readonly string[] = process.argv): boolean {
  if (argv.includes(SERVER_HOST_DISABLE_ARG)) return false
  if (env.CRAFT_SERVER_URL) return false // already a thin client of some other server
  if (env.CRAFT_HEADLESS) return false
  const v = env[SERVER_HOST_FLAG]?.trim().toLowerCase()
  return v === '1' || v === 'true'
}

const CHILD_ENV_EXACT = new Set([
  'PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'LANG', 'LANGUAGE', 'TZ', 'TERM',
  'TMPDIR', 'TMP', 'TEMP', 'NODE_ENV', 'DEBUG',
  'APPDATA', 'LOCALAPPDATA', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'SystemRoot',
  'SYSTEMROOT', 'windir', 'ComSpec', 'PATHEXT', 'ProgramFiles', 'ProgramFiles(x86)',
  'ProgramData', 'COMPUTERNAME', 'USERNAME',
  'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'no_proxy', 'all_proxy',
  'SSL_CERT_FILE', 'SSL_CERT_DIR', 'NODE_EXTRA_CA_CERTS',
  'SSH_AUTH_SOCK',
])
const CHILD_ENV_PREFIXES = ['LC_', 'XDG_', 'CRAFT_', 'ROX_']
/** Provider credentials the in-process server would have read from env. */
const CHILD_ENV_SUFFIXES = ['_API_KEY', '_BASE_URL']
const CHILD_ENV_DENY = new Set([
  SERVER_HOST_FLAG, 'CRAFT_SERVER_URL', 'CRAFT_SERVER_TOKEN', 'ROX_SERVER_TOKEN',
  'CRAFT_PRINT_TOKEN', 'ROX_SERVER_HOST_WORKER',
])

/** Minimal allowlisted env for the server child. Never carries a bearer token from the parent. */
export function buildChildEnv(parent: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {}
  for (const [k, v] of Object.entries(parent)) {
    if (v === undefined || CHILD_ENV_DENY.has(k)) continue
    if (CHILD_ENV_EXACT.has(k) || CHILD_ENV_PREFIXES.some(p => k.startsWith(p)) || CHILD_ENV_SUFFIXES.some(sfx => k.endsWith(sfx))) {
      out[k] = v
    }
  }
  return out
}

export function computeBackoffMs(attempt: number, baseMs = 500, maxMs = 30_000): number {
  if (attempt <= 0) return 0
  return Math.min(maxMs, baseMs * 2 ** (attempt - 1))
}

/** Parse readiness lines emitted by packages/server/src/index.ts. */
export function parseReadyLine(buffer: string): { url?: string; token?: string } {
  const out: { url?: string; token?: string } = {}
  for (const raw of buffer.split(/\r?\n/)) {
    const line = raw.trim()
    if (line.startsWith('CRAFT_SERVER_URL=')) out.url = line.slice('CRAFT_SERVER_URL='.length)
    else if (line.startsWith('ROX_SERVER_TOKEN=')) out.token = line.slice('ROX_SERVER_TOKEN='.length)
  }
  return out
}

/**
 * Event-loop delay gate (PERF-01 metric: StartupTimeline.eventLoopDelay p99).
 * The point of moving the server out of main is a responsive main loop; the
 * gate reports whether the measured main-thread p99 stays within budget.
 */
export function evaluateLoopDelayGate(
  sample: { p99: number } | null | undefined,
  budgetMs: number,
): { status: 'pass' | 'fail' | 'no-data'; p99?: number; budgetMs: number } {
  if (!sample || !Number.isFinite(sample.p99)) return { status: 'no-data', budgetMs }
  return { status: sample.p99 <= budgetMs ? 'pass' : 'fail', p99: sample.p99, budgetMs }
}

type State = 'idle' | 'starting' | 'running' | 'backoff' | 'stopping' | 'stopped' | 'failed'

export class ServerSupervisor {
  private state: State = 'idle'
  private child: ServerHostChild | null = null
  private crashes = 0
  private preReadyAttempts = 0
  private everReady = false
  private pinnedPort: string | null = null
  private startedAt = 0
  private restartTimer: unknown = null
  private readonly token: string
  private readonly o: Required<Omit<ServerSupervisorOptions, 'onReady' | 'onGiveUp' | 'env' | 'childEnvExtras'>> &
    Pick<ServerSupervisorOptions, 'onReady' | 'onGiveUp'> & { env: NodeJS.ProcessEnv; childEnvExtras: Record<string, string> }
  private firstReady: { resolve: (r: ServerHostReady) => void; reject: (e: Error) => void } | null = null
  private exitWaiters: Array<() => void> = []

  constructor(options: ServerSupervisorOptions) {
    this.o = {
      preReadyMaxAttempts: 2,
      preReadyTimeoutMs: 10_000,
      readyTimeoutMs: 30_000,
      backoffBaseMs: 500,
      backoffMaxMs: 30_000,
      maxConsecutiveCrashes: 5,
      stableAfterMs: 60_000,
      shutdownGraceMs: 5_000,
      killHardTimeoutMs: 2_000,
      log: () => {},
      now: () => Date.now(),
      setTimer: (fn, ms) => { const t = setTimeout(fn, ms); (t as { unref?: () => void }).unref?.(); return t },
      clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
      ...options,
      env: options.env ?? process.env,
      childEnvExtras: options.childEnvExtras ?? {},
    }
    // Fresh per-app-session token, held only in this object (never in process.env),
    // fixed across restarts so the renderer's credentials stay valid.
    this.token = randomBytes(32).toString('hex')
  }

  getState(): State { return this.state }
  getCrashCount(): number { return this.crashes }

  /** Start the child; resolves on first readiness, rejects fast if it never becomes ready. */
  start(): Promise<ServerHostReady> {
    if (this.state !== 'idle') return Promise.reject(new Error(`server-host: start in state ${this.state}`))
    const p = new Promise<ServerHostReady>((resolve, reject) => { this.firstReady = { resolve, reject } })
    this.spawn()
    return p
  }

  private spawn(): void {
    this.state = 'starting'
    this.restartTimer = null
    if (!this.everReady) this.preReadyAttempts++
    const env: NodeJS.ProcessEnv = {
      ...buildChildEnv(this.o.env),
      ...this.o.childEnvExtras,
      ROX_SERVER_TOKEN: this.token,
      CRAFT_RPC_HOST: '127.0.0.1',
      // Pinned after first readiness so the renderer's WS reconnect lands on the same URL.
      CRAFT_RPC_PORT: this.pinnedPort ?? '0',
    }
    // Set before fork so a throwing fork is timed (and counted) like any other crash.
    this.startedAt = this.o.now()
    let child: ServerHostChild
    try {
      child = this.o.fork(this.o.workerPath, [], { env, serviceName: 'Rox Server', stdio: 'pipe' })
    } catch (err) {
      this.o.log('error', `server-host: fork failed: ${err instanceof Error ? err.message : String(err)}`)
      this.handleExit(-1, false)
      return
    }
    this.child = child
    let buf = ''
    let ready = false
    const timeoutMs = this.everReady ? this.o.readyTimeoutMs : this.o.preReadyTimeoutMs
    const readyTimer = this.o.setTimer(() => {
      if (ready || this.child !== child) return
      this.o.log('error', `server-host: not ready after ${timeoutMs}ms, killing`)
      this.killChild(child)
    }, timeoutMs)
    child.stdout?.on('data', (chunk) => {
      if (ready) return
      buf += chunk.toString()
      const parsed = parseReadyLine(buf)
      if (parsed.url) {
        ready = true
        buf = ''
        this.o.clearTimer(readyTimer)
        if (this.state !== 'starting') return
        this.state = 'running'
        this.everReady = true
        const port = /:(\d+)(?:\/|$)/.exec(parsed.url)?.[1]
        if (port && !this.pinnedPort) this.pinnedPort = port
        const info: ServerHostReady = { url: parsed.url, token: this.token, pid: child.pid }
        this.o.log('info', `server-host: ready at ${parsed.url} (pid ${child.pid ?? '?'})`)
        this.o.onReady?.(info)
        if (this.firstReady) { this.firstReady.resolve(info); this.firstReady = null }
      }
    })
    child.stderr?.on('data', (chunk) => this.o.log('warn', `server-host[stderr]: ${chunk.toString().trimEnd()}`))
    child.on('exit', (code) => {
      this.o.clearTimer(readyTimer)
      if (this.child === child) this.handleExit(code, ready)
    })
  }

  /** kill() and synthesize an exit if the child never reports one. */
  private killChild(child: ServerHostChild): void {
    try { child.kill() } catch { /* already gone */ }
    this.o.setTimer(() => {
      if (this.child !== child) return
      this.o.log('warn', `server-host: no exit event ${this.o.killHardTimeoutMs}ms after kill; treating as exited`)
      this.handleExit(-9, false)
    }, this.o.killHardTimeoutMs)
  }

  private handleExit(code: number, runWasReady: boolean): void {
    this.child = null
    if (this.state === 'stopping' || this.state === 'stopped') {
      this.state = 'stopped'
      const w = this.exitWaiters; this.exitWaiters = []
      for (const fn of w) fn()
      return
    }
    if (!this.everReady) {
      // Fail fast before the first readiness: main is waiting to fall back.
      if (this.preReadyAttempts >= this.o.preReadyMaxAttempts) {
        this.state = 'failed'
        this.o.log('error', `server-host: no readiness after ${this.preReadyAttempts} attempt(s) (exit ${code})`)
        if (this.firstReady) { this.firstReady.reject(new Error(`server-host: start failed (exit ${code})`)); this.firstReady = null }
        return
      }
      this.scheduleRestart(code, this.o.backoffBaseMs)
      return
    }
    // Only a run that actually served for stableAfterMs resets the counter;
    // fork throws / never-ready runs always count, so give-up is guaranteed.
    const ranMs = this.o.now() - this.startedAt
    this.crashes = runWasReady && ranMs >= this.o.stableAfterMs ? 1 : this.crashes + 1
    if (this.crashes > this.o.maxConsecutiveCrashes) {
      this.state = 'failed'
      this.o.log('error', `server-host: giving up after ${this.crashes - 1} restarts (exit ${code})`)
      this.o.onGiveUp?.(code)
      return
    }
    this.scheduleRestart(code, computeBackoffMs(this.crashes, this.o.backoffBaseMs, this.o.backoffMaxMs))
  }

  private scheduleRestart(code: number, delay: number): void {
    this.o.log('warn', `server-host: exited ${code}; restart in ${delay}ms`)
    this.state = 'backoff'
    this.restartTimer = this.o.setTimer(() => { if (this.state === 'backoff') this.spawn() }, delay)
  }

  /** Clean shutdown: ask the child to exit, kill after grace, hard-timeout after kill. Idempotent. */
  async stop(): Promise<void> {
    if (this.state === 'stopped' || this.state === 'idle' || this.state === 'failed') { this.state = 'stopped'; return }
    if (this.restartTimer) { this.o.clearTimer(this.restartTimer); this.restartTimer = null }
    const child = this.child
    this.state = 'stopping'
    if (this.firstReady) { this.firstReady.reject(new ServerHostStoppedError()); this.firstReady = null }
    if (!child) { this.state = 'stopped'; return }
    const exited = new Promise<void>((resolve) => this.exitWaiters.push(resolve))
    try { child.postMessage?.({ type: 'shutdown' }) } catch { /* child gone */ }
    const grace = this.o.setTimer(() => { if (this.child === child) this.killChild(child) }, this.o.shutdownGraceMs)
    await exited
    this.o.clearTimer(grace)
  }
}

export class ServerHostStoppedError extends Error {
  constructor() { super('server-host: stopped'); this.name = 'ServerHostStoppedError' }
}

function defaultWorkerPath(): string {
  const here = typeof __dirname !== 'undefined' ? __dirname : dirname(new URL(import.meta.url).pathname)
  const candidate = join(here, 'server-host-worker.mjs')
  if (existsSync(candidate)) return candidate
  return join(here, '..', '..', 'dist', 'server-host-worker.mjs')
}

let active: ServerSupervisor | null = null
let hostConfig: ServerHostReady | null = null

/**
 * URL + token of the utilityProcess server, or null when the flag is off / the
 * host fell back. Main reads this instead of process.env so the bearer token
 * never lands in the global env inherited by later children.
 */
export function getServerHostConfig(): { url: string; token: string } | null {
  return hostConfig ? { url: hostConfig.url, token: hostConfig.token } : null
}

/** Sync IPC the preload uses (only when the flag env is set) to get the config. */
export const SERVER_HOST_CONFIG_CHANNEL = '__server-host:config'

export interface ServerHostStartDeps {
  log: (level: 'info' | 'warn' | 'error', msg: string) => void
  /** True only for a Rox window's own webContents (same check as local-client proof). */
  isTrustedSender: (sender: Electron.WebContents) => boolean
  env?: NodeJS.ProcessEnv
}

/**
 * Called from main before `isClientOnly` is computed. Returns null (and does
 * nothing at all) when the flag is off. On success the thin-client path reads
 * `getServerHostConfig()`. On failure (≤ 2 attempts, 10 s ready timeout each)
 * logs and returns null → in-process server exactly as today.
 *
 * After a first success, if restarts give up (crash loop, pinned port busy):
 * show an error and relaunch the app once WITHOUT the flag, so the next run
 * uses the in-process server. Chosen over re-picking a port because the
 * renderer's thin-client URL is fixed at preload eval.
 */
export async function maybeStartServerHost(deps: ServerHostStartDeps): Promise<ServerSupervisor | null> {
  const env = deps.env ?? process.env
  const { log } = deps
  if (!env[SERVER_HOST_FLAG]) return null
  let supervisor: ServerSupervisor | null = null
  try {
    const electron = require('electron') as typeof import('electron')
    const { app, utilityProcess, ipcMain, dialog } = electron
    // Registered whenever the flag env is present (the preload asks whenever it
    // sees it), even if hosting is then disabled/fails → it answers null.
    ipcMain.removeAllListeners(SERVER_HOST_CONFIG_CHANNEL)
    ipcMain.on(SERVER_HOST_CONFIG_CHANNEL, (e) => {
      e.returnValue = deps.isTrustedSender(e.sender) ? getServerHostConfig() : null
    })
    if (!isServerHostEnabled(env)) return null
    const fork: ServerHostForkFn = (modulePath, args, options) =>
      utilityProcess.fork(modulePath, args, options) as unknown as ServerHostChild
    const workerPath = env.ROX_SERVER_HOST_WORKER || defaultWorkerPath()
    if (!existsSync(workerPath)) {
      log('warn', `server-host: worker not found at ${workerPath} (build with ROX_BUILD_SERVER_HOST_WORKER=1); using in-process server`)
      return null
    }
    // CRAFT_APP_ROOT / CRAFT_IS_PACKAGED / PATH prepends are already set on
    // process.env by main's early boot and pass the CRAFT_* allowlist. These
    // mirror what the in-process bootstrap receives explicitly.
    const resourcesBase = app.isPackaged ? join(process.resourcesPath, 'app') : join(dirname(workerPath), '..')
    const extras: Record<string, string> = {
      CRAFT_BUNDLED_ASSETS_ROOT: dirname(workerPath), // in-process: bundledAssetsRoot = dist (__dirname)
      CRAFT_RESOURCES_PATH: join(resourcesBase, 'resources'),
      CRAFT_IS_PACKAGED: app.isPackaged ? 'true' : 'false',
      CRAFT_VERSION: app.getVersion(),
    }
    supervisor = new ServerSupervisor({
      fork,
      workerPath,
      env,
      childEnvExtras: extras,
      log,
      onGiveUp: (code) => {
        hostConfig = null
        log('error', `server-host: server unavailable (last exit ${code}); relaunching without ${SERVER_HOST_FLAG}`)
        try {
          dialog.showErrorBox('Rox', 'The background server stopped repeatedly. Rox will restart using the built-in server.')
        } catch { /* headless / during quit */ }
        // Drop the flag for anything inheriting env, and mark argv explicitly
        // (relaunch env inheritance is platform-dependent) so the next run is in-process.
        delete env[SERVER_HOST_FLAG]
        const args = process.argv.slice(1).filter(a => a !== SERVER_HOST_DISABLE_ARG)
        app.relaunch({ args: [...args, SERVER_HOST_DISABLE_ARG] })
        app.exit(0)
      },
    })
    active = supervisor
    hostConfig = await supervisor.start()
    scheduleLoopDelayGate(log, env)
    return supervisor
  } catch (err) {
    active = null
    hostConfig = null
    if (err instanceof ServerHostStoppedError) {
      log('info', 'server-host: start aborted by shutdown')
      return null
    }
    log('error', `server-host: falling back to in-process server: ${err instanceof Error ? err.message : String(err)}`)
    if (supervisor) await supervisor.stop().catch(() => {})
    return null
  }
}

/**
 * With ROX_PERF=1 (PERF-01 loop histogram enabled) report the main-thread
 * event-loop delay p99 against ROX_SERVER_UTILITY_PROCESS_LOOP_BUDGET_MS
 * (default 50ms) once startup has settled. Report-only: never changes routing.
 */
function scheduleLoopDelayGate(log: (level: 'info' | 'warn' | 'error', msg: string) => void, env: NodeJS.ProcessEnv): void {
  const budget = Number(env.ROX_SERVER_UTILITY_PROCESS_LOOP_BUDGET_MS ?? 50)
  const t = setTimeout(() => {
    const r = evaluateLoopDelayGate(getStartupTimeline().eventLoopDelay, Number.isFinite(budget) ? budget : 50)
    const msg = `[perf] server-host loop-delay gate ${r.status} p99=${r.p99?.toFixed(1) ?? 'n/a'}ms budget=${r.budgetMs}ms`
    log(r.status === 'fail' ? 'warn' : 'info', msg)
  }, 30_000)
  t.unref?.()
}

export async function stopServerHost(): Promise<void> {
  const s = active
  active = null
  if (s) await s.stop()
}
