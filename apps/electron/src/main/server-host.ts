/**
 * #1586 (first slice) — host the RPC server in an Electron utilityProcess.
 *
 * Off by default. Only active when ROX_SERVER_UTILITY_PROCESS=1 AND the app is
 * not already a thin client (CRAFT_SERVER_URL unset). When active, main forks
 * the standalone server-core bootstrap (packages/server, built to
 * dist/server-host-worker.cjs), waits for its `CRAFT_SERVER_URL=` /
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
  env?: NodeJS.ProcessEnv
  /** Ms to wait for the readiness line before treating the start as failed. */
  readyTimeoutMs?: number
  /** Restart backoff: base * 2^(n-1), capped. */
  backoffBaseMs?: number
  backoffMaxMs?: number
  /** Give up after this many consecutive crashes without a stable run. */
  maxConsecutiveCrashes?: number
  /** A run longer than this resets the crash counter. */
  stableAfterMs?: number
  /** Grace period for clean shutdown before kill(). */
  shutdownGraceMs?: number
  log?: (level: 'info' | 'warn' | 'error', msg: string) => void
  /** Called on every (re)start once the child is listening. */
  onReady?: (ready: ServerHostReady) => void
  /** Called once restarts are exhausted. */
  onGiveUp?: (lastExitCode: number) => void
  now?: () => number
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (handle: unknown) => void
}

export function isServerHostEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.CRAFT_SERVER_URL) return false // already a thin client of some other server
  if (env.CRAFT_HEADLESS) return false
  const v = env[SERVER_HOST_FLAG]?.trim().toLowerCase()
  return v === '1' || v === 'true'
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
  private startedAt = 0
  private restartTimer: unknown = null
  private readonly token: string
  private readonly o: Required<Omit<ServerSupervisorOptions, 'onReady' | 'onGiveUp' | 'env'>> &
    Pick<ServerSupervisorOptions, 'onReady' | 'onGiveUp'> & { env: NodeJS.ProcessEnv }
  private firstReady: { resolve: (r: ServerHostReady) => void; reject: (e: Error) => void } | null = null
  private exitWaiters: Array<() => void> = []

  constructor(options: ServerSupervisorOptions) {
    this.o = {
      readyTimeoutMs: 30_000,
      backoffBaseMs: 500,
      backoffMaxMs: 30_000,
      maxConsecutiveCrashes: 5,
      stableAfterMs: 60_000,
      shutdownGraceMs: 5_000,
      log: () => {},
      now: () => Date.now(),
      setTimer: (fn, ms) => { const t = setTimeout(fn, ms); (t as { unref?: () => void }).unref?.(); return t },
      clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
      ...options,
      env: options.env ?? process.env,
    }
    // Fixed per-app-session token so restarts keep the renderer's credentials valid.
    this.token = this.o.env.ROX_SERVER_TOKEN || this.o.env.CRAFT_SERVER_TOKEN || randomBytes(32).toString('hex')
  }

  getState(): State { return this.state }
  getCrashCount(): number { return this.crashes }

  /** Start the child; resolves on first readiness, rejects if it never becomes ready. */
  start(): Promise<ServerHostReady> {
    if (this.state !== 'idle') return Promise.reject(new Error(`server-host: start in state ${this.state}`))
    const p = new Promise<ServerHostReady>((resolve, reject) => { this.firstReady = { resolve, reject } })
    this.spawn()
    return p
  }

  private spawn(): void {
    this.state = 'starting'
    this.restartTimer = null
    const env: NodeJS.ProcessEnv = {
      ...this.o.env,
      ROX_SERVER_TOKEN: this.token,
      CRAFT_RPC_HOST: '127.0.0.1',
      // Keep the same port across restarts once known so the renderer's WS reconnect lands.
      CRAFT_RPC_PORT: this.o.env.CRAFT_RPC_PORT ?? '0',
    }
    delete env[SERVER_HOST_FLAG]
    delete env.CRAFT_SERVER_URL
    let child: ServerHostChild
    try {
      child = this.o.fork(this.o.workerPath, [], { env, serviceName: 'Rox Server', stdio: 'pipe' })
    } catch (err) {
      this.o.log('error', `server-host: fork failed: ${err instanceof Error ? err.message : String(err)}`)
      this.handleExit(-1, null)
      return
    }
    this.child = child
    this.startedAt = this.o.now()
    let buf = ''
    let ready = false
    const readyTimer = this.o.setTimer(() => {
      if (ready || this.child !== child) return
      this.o.log('error', `server-host: not ready after ${this.o.readyTimeoutMs}ms, killing`)
      child.kill()
    }, this.o.readyTimeoutMs)
    child.stdout?.on('data', (chunk) => {
      if (ready) return
      buf += chunk.toString()
      const parsed = parseReadyLine(buf)
      if (parsed.url) {
        ready = true
        this.o.clearTimer(readyTimer)
        this.state = 'running'
        const info: ServerHostReady = { url: parsed.url, token: this.token, pid: child.pid }
        const port = /:(\d+)(?:\/|$)/.exec(parsed.url)?.[1]
        if (port) this.o.env.CRAFT_RPC_PORT = port
        this.o.log('info', `server-host: ready at ${parsed.url} (pid ${child.pid ?? '?'})`)
        this.o.onReady?.(info)
        if (this.firstReady) { this.firstReady.resolve(info); this.firstReady = null }
      }
    })
    child.stderr?.on('data', (chunk) => this.o.log('warn', `server-host[stderr]: ${chunk.toString().trimEnd()}`))
    child.on('exit', (code) => {
      this.o.clearTimer(readyTimer)
      if (this.child === child) this.handleExit(code, child)
    })
  }

  private handleExit(code: number, _child: ServerHostChild | null): void {
    this.child = null
    if (this.state === 'stopping' || this.state === 'stopped') {
      this.state = 'stopped'
      const w = this.exitWaiters; this.exitWaiters = []
      for (const fn of w) fn()
      return
    }
    const ranMs = this.o.now() - this.startedAt
    this.crashes = ranMs >= this.o.stableAfterMs ? 1 : this.crashes + 1
    if (this.crashes > this.o.maxConsecutiveCrashes) {
      this.state = 'failed'
      this.o.log('error', `server-host: giving up after ${this.crashes - 1} restarts (exit ${code})`)
      this.o.onGiveUp?.(code)
      if (this.firstReady) { this.firstReady.reject(new Error(`server-host: exited ${code}`)); this.firstReady = null }
      return
    }
    const delay = computeBackoffMs(this.crashes, this.o.backoffBaseMs, this.o.backoffMaxMs)
    this.o.log('warn', `server-host: exited ${code}; restart #${this.crashes} in ${delay}ms`)
    this.state = 'backoff'
    this.restartTimer = this.o.setTimer(() => { if (this.state === 'backoff') this.spawn() }, delay)
  }

  /** Clean shutdown: ask the child to exit, kill after grace. Idempotent. */
  async stop(): Promise<void> {
    if (this.state === 'stopped' || this.state === 'idle') { this.state = 'stopped'; return }
    if (this.restartTimer) { this.o.clearTimer(this.restartTimer); this.restartTimer = null }
    const child = this.child
    this.state = 'stopping'
    if (this.firstReady) { this.firstReady.reject(new Error('server-host: stopped')); this.firstReady = null }
    if (!child) { this.state = 'stopped'; return }
    const exited = new Promise<void>((resolve) => this.exitWaiters.push(resolve))
    try { child.postMessage?.({ type: 'shutdown' }) } catch { /* child gone */ }
    const grace = this.o.setTimer(() => { if (this.child === child) child.kill() }, this.o.shutdownGraceMs)
    await exited
    this.o.clearTimer(grace)
  }
}

function defaultWorkerPath(): string {
  const here = typeof __dirname !== 'undefined' ? __dirname : dirname(new URL(import.meta.url).pathname)
  const candidate = join(here, 'server-host-worker.cjs')
  if (existsSync(candidate)) return candidate
  return join(here, '..', '..', 'dist', 'server-host-worker.cjs')
}

let active: ServerSupervisor | null = null

/**
 * Called from main before `isClientOnly` is computed. Returns null (and does
 * nothing at all) when the flag is off. On success sets CRAFT_SERVER_URL /
 * CRAFT_SERVER_TOKEN so the rest of startup runs as a thin client. On failure
 * logs and returns null, leaving env untouched → in-process server as today.
 */
export async function maybeStartServerHost(
  log: (level: 'info' | 'warn' | 'error', msg: string) => void,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ServerSupervisor | null> {
  if (!isServerHostEnabled(env)) return null
  try {
    const electron = require('electron') as typeof import('electron')
    const fork: ServerHostForkFn = (modulePath, args, options) =>
      electron.utilityProcess.fork(modulePath, args, options) as unknown as ServerHostChild
    const supervisor = new ServerSupervisor({
      fork,
      workerPath: env.ROX_SERVER_HOST_WORKER || defaultWorkerPath(),
      env,
      log,
      onGiveUp: (code) => log('error', `server-host: server unavailable (last exit ${code}); restart the app`),
    })
    const ready = await supervisor.start()
    env.CRAFT_SERVER_URL = ready.url
    env.CRAFT_SERVER_TOKEN = ready.token
    active = supervisor
    scheduleLoopDelayGate(log, env)
    return supervisor
  } catch (err) {
    log('error', `server-host: falling back to in-process server: ${err instanceof Error ? err.message : String(err)}`)
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
