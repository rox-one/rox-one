/**
 * Cookbooks Lab sidecar supervisor (SPEC §Implementation Decisions 2, §Спавн).
 *
 * Adapts the proven `ServerSupervisor` pattern (`main/server-host.ts`) to the
 * vendored Python lab: resolve interpreter → spawn `-u serve_lab.py --workspace
 * <configDir>/cookbooks/workspace` → parse the frozen discovery line → health
 * poll → running, with the frozen backoff/crash policy, stderr redaction and
 * SIGINT→grace→kill shutdown.
 *
 * SECURITY: the bearer token and the full loopback URL live ONLY in this module
 * and are exposed to main through `getStartup()`; the renderer contract
 * (`CookbooksStatus`) never carries either. Vendor secret VALUES likewise never
 * leave main: they are pushed to the sidecar over loopback and are neither
 * logged, returned in a status/IPC payload, nor written to disk. Nothing here
 * imports Electron, so the supervisor is unit-testable with an injected
 * spawn/timers.
 */
import { spawn as nodeSpawn } from 'node:child_process'
import { accessSync, constants, existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { get as httpGet } from 'node:http'
import { delimiter, join } from 'node:path'
import { redactRegisteredSecrets, resolveSecretsForSpawn, type SecretRefEntry } from '@rox/shared/secrets'
import { getBundledAssetsDir } from '@rox/shared/utils'
import { resolveConfigDir } from '@rox/shared/config/paths'
import { getToolchain, withToolchainPathPrefix } from '@rox/shared/toolchain-runtime'
import { CookbooksApiError, parseCookbooksStartupLine } from '../shared/cookbooks'
import type {
  CookbooksCard,
  CookbooksCell,
  CookbooksDocument,
  CookbooksFailureReason,
  CookbooksOutput,
  CookbooksRunCell,
  CookbooksRunResult,
  CookbooksStartup,
  CookbooksState,
  CookbooksStatus,
} from '../shared/cookbooks'

/** Minimal child surface (node ChildProcess or a test fake). */
export interface CookbooksChild {
  readonly pid?: number
  stdout?: { on(event: 'data', cb: (chunk: Buffer | string) => void): unknown } | null
  stderr?: { on(event: 'data', cb: (chunk: Buffer | string) => void): unknown } | null
  on(event: 'exit', cb: (code: number | null) => void): unknown
  kill(signal?: NodeJS.Signals): boolean
}

export type CookbooksSpawnFn = (
  command: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv; stdio: 'pipe' },
) => CookbooksChild

export interface CookbooksRuntimeOptions {
  spawn?: CookbooksSpawnFn
  /** Frozen resolution order: managed toolchain → UV_PYTHON → PATH → null. */
  resolvePython?: () => Promise<string | null>
  /** Vendored lab directory (default: `getBundledAssetsDir('cookbooks')`). */
  getCookbooksDir?: () => string | undefined
  /** Rox config dir (default: `resolveConfigDir()`); workspace is `<dir>/cookbooks/workspace`. */
  getWorkspaceDir?: () => string
  /** Allowlisted child env (default: PATH via toolchain prefix + HOME/TMPDIR/LANG/LC_ALL). */
  buildEnv?: () => Promise<NodeJS.ProcessEnv>
  /**
   * Fresh lab-key → secret-value snapshot for the sidecar (default:
   * `defaultCookbooksStore`). Values resolved here never leave this process
   * except in loopback requests to the sidecar.
   */
  resolveStore?: () => Promise<CookbooksStore>
  /** Liveness probe for the parsed port (default: HTTP `GET /lab.html` → 200). */
  checkHealth?: (port: number) => Promise<boolean>
  log?: (level: 'info' | 'warn' | 'error', msg: string) => void
  onStatusChanged?: (status: CookbooksStatus) => void
  now?: () => number
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (handle: unknown) => void
  /** POSIX graceful stop signal (SIGINT). `undefined` → `kill()` (Windows v1). */
  signal?: NodeJS.Signals | undefined
  preReadyMaxAttempts?: number
  preReadyTimeoutMs?: number
  readyTimeoutMs?: number
  backoffBaseMs?: number
  backoffMaxMs?: number
  stableAfterMs?: number
  maxCrashes?: number
  shutdownGraceMs?: number
  killHardTimeoutMs?: number
  healthPollIntervalMs?: number
  /** Client budget for one catalog/open/document/save/reset call. */
  apiRequestTimeoutMs?: number
  /** Client budget for one `POST /run` (the cell timeout plus slack). */
  runApiTimeoutMs?: number
  /** Run-all budget for a given number of submitted cells (override/tests). */
  runAllTimeoutMs?: (cellCount: number) => number
}

/** Child-env allowlist — the ONLY parent keys the sidecar inherits. */
const COOKBOOKS_ENV_ALLOWLIST = ['PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL'] as const

/** ≥8 KiB stderr ring, redacted before it is logged. */
const STDERR_RING_MAX_BYTES = 8 * 1024

/** Client budgets for the data plane (SPEC §Amendment 1 + review F1). */
const API_REQUEST_TIMEOUT_MS = 20_000
const RUN_API_TIMEOUT_MS = 90_000
const RUN_ALL_CELL_TIMEOUT_MS = 60_000
const RUN_ALL_OVERHEAD_MS = 30_000
const RUN_ALL_MAX_TIMEOUT_MS = 15 * 60_000

export function buildCookbooksChildEnv(parent: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {}
  for (const key of COOKBOOKS_ENV_ALLOWLIST) {
    const value = parent[key]
    if (value !== undefined) out[key] = value
  }
  return out
}

export function computeCookbooksBackoffMs(attempt: number, baseMs = 500, maxMs = 30_000): number {
  if (attempt <= 0) return 0
  return Math.min(maxMs, baseMs * 2 ** (attempt - 1))
}

/**
 * Client budget for a "Run all": the sidecar's per-cell timeout for every
 * submitted cell plus fixed overhead (venv/provisioning slack), capped so a
 * huge notebook cannot hold an IPC call open indefinitely.
 */
export function computeCookbooksRunAllTimeoutMs(
  cellCount: number,
  perCellMs = RUN_ALL_CELL_TIMEOUT_MS,
  overheadMs = RUN_ALL_OVERHEAD_MS,
  maxMs = RUN_ALL_MAX_TIMEOUT_MS,
): number {
  const cells = Number.isFinite(cellCount) && cellCount > 0 ? Math.floor(cellCount) : 1
  return Math.min(maxMs, perCellMs * cells + overheadMs)
}

/** Mask `token=<value>` in any text before it reaches a log sink. */
export function redactCookbooksLogLine(line: string): string {
  return line.replace(/token=[^\s&]+/gi, 'token=***')
}

// ---------------------------------------------------------------------------
// Secret bridge (SPEC-slice2 §Транспорт)
//
// Vendor API keys reach the lab's kernel through the sidecar's own store map
// (`openai.api_key` → value). Values live ONLY in this process and in loopback
// requests to 127.0.0.1: they are never logged (only the key NAMES are), never
// returned through a status/IPC payload and never written to disk — the sidecar
// keeps them in memory and `/store` does not persist.
// ---------------------------------------------------------------------------

/** Lab-key → secret-value snapshot (`openai.api_key` → `sk-…`). */
export type CookbooksStore = Record<string, string>

/**
 * Default store source: the vendored catalog's `secretMap` (read through
 * `getBundledAssetsDir`) resolved through the canonical chain — environment
 * (`ROX_SECRET_<ENV>`) → local-encrypted → infisical. A key that no provider
 * holds is simply absent; an unreadable catalog or a resolver failure yields an
 * empty store. Never throws.
 */
export async function defaultCookbooksStore(dir?: string): Promise<CookbooksStore> {
  try {
    const root = dir ?? getBundledAssetsDir('cookbooks')
    if (!root) return {}
    const catalog: unknown = JSON.parse(
      await readFile(join(root, 'resources', 'cookbooks', 'catalog.json'), 'utf8'),
    )
    const rawMap = asRecord(asRecord(catalog).secretMap)
    const secretMap: Record<string, string> = {}
    for (const [labKey, envName] of Object.entries(rawMap)) {
      if (typeof envName === 'string' && envName.length > 0) secretMap[labKey] = envName
    }
    const entries: SecretRefEntry[] = Object.values(secretMap).map((envVar) => ({ name: envVar, envVar }))
    if (entries.length === 0) return {}
    const resolved = await resolveSecretsForSpawn(entries)
    const store: CookbooksStore = {}
    for (const [labKey, envName] of Object.entries(secretMap)) {
      const value = resolved.env[envName]
      if (typeof value === 'string' && value.length > 0) store[labKey] = value
    }
    return store
  } catch {
    return {}
  }
}

function isExecutableFile(path: string | null | undefined): path is string {
  if (!path) return false
  try {
    if (!existsSync(path)) return false
    accessSync(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

function findOnPath(name: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const segments = (env.PATH ?? '').split(delimiter).filter((s) => s.length > 0)
  for (const segment of segments) {
    const candidate = join(segment, name)
    if (isExecutableFile(candidate)) return candidate
  }
  return null
}

/** Frozen interpreter chain (SPEC §Резолв Python): managed → UV_PYTHON → PATH. */
async function defaultResolvePython(): Promise<string | null> {
  try {
    const managed = await getToolchain().resolver.findExecutable('python3')
    if (isExecutableFile(managed)) return managed
  } catch {
    /* resolver unavailable — fall through to the explicit sources */
  }
  const uvPython = process.env.UV_PYTHON?.trim()
  if (isExecutableFile(uvPython)) return uvPython
  return findOnPath('python3')
}

async function defaultBuildEnv(): Promise<NodeJS.ProcessEnv> {
  const base = buildCookbooksChildEnv(process.env)
  try {
    return await withToolchainPathPrefix(base)
  } catch {
    return base
  }
}

/** Liveness: the Lab page is served without a token on the loopback origin. */
function defaultCheckHealth(port: number): Promise<boolean> {
  const { promise, resolve } = Promise.withResolvers<boolean>()
  const request = httpGet(`http://127.0.0.1:${port}/lab.html`, (res) => {
    res.resume()
    resolve(res.statusCode === 200)
  })
  request.on('error', () => resolve(false))
  request.setTimeout(1_000, () => {
    request.destroy()
    resolve(false)
  })
  return promise
}

type TimerHandle = unknown

// ---------------------------------------------------------------------------
// Sidecar JSON → DTO mapping (SPEC §Amendment 1)
//
// The sidecar's payloads are untyped on the wire. These helpers read the fields
// the DTO declares and normalise nbformat's string-or-list values; they never
// invent data (a missing field becomes its empty form).
// ---------------------------------------------------------------------------

type RawRecord = Record<string, unknown>

function asRecord(value: unknown): RawRecord {
  return typeof value === 'object' && value !== null ? (value as RawRecord) : {}
}

/** nbformat allows a string or a list of strings for `source`/`text`/`traceback`. */
function asText(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.filter((part): part is string => typeof part === 'string').join('')
  return ''
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((part): part is string => typeof part === 'string') : []
}

function mapCard(raw: unknown): CookbooksCard {
  const card = asRecord(raw)
  return {
    id: asText(card.id),
    title: asText(card.title),
    vendor: asText(card.vendor),
    kind: card.kind === 'md' ? 'md' : 'ipynb',
    secretsHave: asStringArray(card.secretsHave),
    secretsMissing: asStringArray(card.secretsMissing),
    disabled: card.disabled === true,
    disabledReason: typeof card.disabledReason === 'string' ? card.disabledReason : null,
  }
}

function mapOutput(raw: unknown): CookbooksOutput {
  const output = asRecord(raw)
  return {
    text: asText(output.text),
    traceback: output.traceback == null ? null : asText(output.traceback),
  }
}

function mapCell(raw: unknown): CookbooksCell {
  const cell = asRecord(raw)
  return {
    // Same rule as the lab page: `code` is runnable, everything else is prose.
    cellType: cell.cell_type === 'code' ? 'code' : 'markdown',
    source: asText(cell.source),
    outputs: Array.isArray(cell.outputs) ? cell.outputs.map(mapOutput) : [],
  }
}

function mapDocument(itemId: string, raw: unknown): CookbooksDocument {
  const document = asRecord(raw)
  return {
    itemId,
    kind: document.kind === 'md' ? 'md' : 'ipynb',
    title: asText(document.title),
    supported: document.supported === true,
    missing: asStringArray(document.missing),
    cells: Array.isArray(document.cells) ? document.cells.map(mapCell) : [],
    text: typeof document.text === 'string' ? document.text : null,
  }
}

function mapRunResult(raw: unknown): CookbooksRunResult {
  const result = asRecord(raw)
  return {
    ok: result.ok === true,
    stdout: asText(result.stdout),
    error: typeof result.error === 'string' ? result.error : null,
    timedOut: result.timed_out === true,
    missing: asStringArray(result.missing),
  }
}

function mapRunCell(raw: unknown): CookbooksRunCell {
  const cell = asRecord(raw)
  const index = typeof cell.index === 'number' ? cell.index : Number(cell.index)
  return {
    index: Number.isInteger(index) ? index : 0,
    status: cell.status === 'error' ? 'error' : cell.status === 'skipped' ? 'skipped' : 'ok',
    stdout: asText(cell.stdout),
    error: typeof cell.error === 'string' ? cell.error : null,
  }
}

export class CookbooksRuntime {
  private state: CookbooksState = 'idle'
  private reason: CookbooksFailureReason | null = null
  private child: CookbooksChild | null = null
  private startup: CookbooksStartup | null = null
  private childEnv: NodeJS.ProcessEnv | null = null
  private pythonPath: string | null = null
  private crashes = 0
  private preReadyAttempts = 0
  private everReady = false
  private runReachedReady = false
  private startedAt = 0
  private restartTimer: TimerHandle = null
  private readyTimer: TimerHandle = null
  private healthTimer: TimerHandle = null
  private graceTimer: TimerHandle = null
  private killTimer: TimerHandle = null
  private pendingReason: CookbooksFailureReason | null = null
  private startWaiters: Array<(status: CookbooksStatus) => void> = []
  private exitWaiters: Array<() => void> = []
  private readonly statusListeners = new Set<(status: CookbooksStatus) => void>()
  private startInFlight: Promise<CookbooksStatus> | null = null
  private stderrRing: string[] = []
  private stderrRingBytes = 0
  /**
   * True while the CURRENT sidecar process holds a non-empty store we seeded.
   * The sidecar replaces its store per snapshot but refuses an empty one, so an
   * emptied store can only be cleared by replacing the process (see pushStore).
   */
  private storeSeeded = false
  private readonly o: Required<
    Pick<
      CookbooksRuntimeOptions,
      | 'preReadyMaxAttempts'
      | 'preReadyTimeoutMs'
      | 'readyTimeoutMs'
      | 'backoffBaseMs'
      | 'backoffMaxMs'
      | 'stableAfterMs'
      | 'maxCrashes'
      | 'shutdownGraceMs'
      | 'killHardTimeoutMs'
      | 'healthPollIntervalMs'
      | 'apiRequestTimeoutMs'
      | 'runApiTimeoutMs'
      | 'runAllTimeoutMs'
    >
  > & {
    spawn: CookbooksSpawnFn
    resolvePython: () => Promise<string | null>
    getCookbooksDir: () => string | undefined
    getWorkspaceDir: () => string
    buildEnv: () => Promise<NodeJS.ProcessEnv>
    resolveStore: () => Promise<CookbooksStore>
    checkHealth: (port: number) => Promise<boolean>
    log: (level: 'info' | 'warn' | 'error', msg: string) => void
    onStatusChanged?: (status: CookbooksStatus) => void
    now: () => number
    setTimer: (fn: () => void, ms: number) => TimerHandle
    clearTimer: (handle: TimerHandle) => void
    signal: NodeJS.Signals | undefined
  }

  constructor(options: CookbooksRuntimeOptions = {}) {
    this.o = {
      preReadyMaxAttempts: options.preReadyMaxAttempts ?? 2,
      preReadyTimeoutMs: options.preReadyTimeoutMs ?? 10_000,
      readyTimeoutMs: options.readyTimeoutMs ?? 30_000,
      backoffBaseMs: options.backoffBaseMs ?? 500,
      backoffMaxMs: options.backoffMaxMs ?? 30_000,
      stableAfterMs: options.stableAfterMs ?? 60_000,
      maxCrashes: options.maxCrashes ?? 5,
      shutdownGraceMs: options.shutdownGraceMs ?? 5_000,
      killHardTimeoutMs: options.killHardTimeoutMs ?? 2_000,
      healthPollIntervalMs: options.healthPollIntervalMs ?? 300,
      apiRequestTimeoutMs: options.apiRequestTimeoutMs ?? API_REQUEST_TIMEOUT_MS,
      runApiTimeoutMs: options.runApiTimeoutMs ?? RUN_API_TIMEOUT_MS,
      runAllTimeoutMs: options.runAllTimeoutMs ?? ((cellCount: number) => computeCookbooksRunAllTimeoutMs(cellCount)),
      spawn: options.spawn ?? ((command, args, opts) => nodeSpawn(command, args, opts) as CookbooksChild),
      resolvePython: options.resolvePython ?? defaultResolvePython,
      getCookbooksDir: options.getCookbooksDir ?? (() => getBundledAssetsDir('cookbooks')),
      getWorkspaceDir: options.getWorkspaceDir ?? (() => resolveConfigDir()),
      buildEnv: options.buildEnv ?? defaultBuildEnv,
      resolveStore: options.resolveStore ?? (() => defaultCookbooksStore()),
      checkHealth: options.checkHealth ?? defaultCheckHealth,
      log: options.log ?? (() => {}),
      onStatusChanged: options.onStatusChanged,
      now: options.now ?? (() => Date.now()),
      setTimer: options.setTimer ?? ((fn, ms) => {
        // Named const: node timers expose unref(), the DOM lib does not model it.
        const handle = setTimeout(fn, ms) as unknown as { unref?: () => void }
        handle.unref?.()
        return handle
      }),
      clearTimer: options.clearTimer ?? ((h) => clearTimeout(h as NodeJS.Timeout | undefined)),
      signal: 'signal' in options ? options.signal : process.platform === 'win32' ? undefined : 'SIGINT',
    }
  }

  getStatus(): CookbooksStatus {
    return {
      state: this.state,
      reason: this.reason,
      port: this.state === 'running' ? this.startup?.port ?? null : null,
    }
  }

  getCrashCount(): number {
    return this.crashes
  }

  /** Observe status transitions; returns an unsubscribe function. */
  subscribe(listener: (status: CookbooksStatus) => void): () => void {
    this.statusListeners.add(listener)
    return () => {
      this.statusListeners.delete(listener)
    }
  }

  /** Main-only: the full loopback URL + token, or null when not running. */
  getStartup(): CookbooksStartup | null {
    return this.state === 'running' ? this.startup : null
  }

  /**
   * Idempotent: starts the sidecar from `idle`; awaits an in-flight start;
   * otherwise returns the current status (failed/stopped recover via
   * `restart()`). Never spawns from `failed`/`stopped`.
   */
  async ensure(): Promise<CookbooksStatus> {
    if (this.state === 'idle') return this.beginStart()
    if (this.state === 'starting') return this.startInFlight ?? this.getStatus()
    return this.getStatus()
  }

  status(): CookbooksStatus {
    return this.getStatus()
  }

  /** Manual recovery: stop, then a fresh resolve+spawn from `failed`/`stopped`. */
  async restart(): Promise<CookbooksStatus> {
    await this.stop()
    return this.beginStart()
  }

  /** SIGINT → grace → SIGKILL, idempotent. Resolves once the child is gone. */
  async stop(): Promise<void> {
    if (this.state === 'stopped' || this.state === 'idle') {
      this.setState('stopped')
      return
    }
    this.clearRunTimers()
    const child = this.child
    if (!child) {
      this.setState('stopped')
      this.resolveStartWaiters(this.getStatus())
      return
    }
    this.setState('stopping')
    const { promise: exited, resolve: resolveExit } = Promise.withResolvers<void>()
    this.exitWaiters.push(resolveExit)
    try {
      child.kill(this.o.signal)
    } catch {
      /* already gone */
    }
    this.graceTimer = this.o.setTimer(() => {
      if (this.child !== child) return
      try {
        child.kill('SIGKILL')
      } catch {
        /* already gone */
      }
    }, this.o.shutdownGraceMs)
    this.killTimer = this.o.setTimer(() => {
      if (this.child !== child) return
      this.o.log('warn', 'cookbooks-runtime: no exit after kill; treating as exited')
      this.handleExit(-9, this.runReachedReady)
    }, this.o.killHardTimeoutMs)
    await exited
    this.o.clearTimer(this.graceTimer)
    this.graceTimer = null
    this.o.clearTimer(this.killTimer)
    this.killTimer = null
    this.startInFlight = null
    this.resolveStartWaiters(this.getStatus())
  }

  // -------------------------------------------------------------------------
  // Data plane (SPEC §Amendment 1): main is the ONLY HTTP client of the sidecar,
  // so the bearer token never leaves this class. Every call requires `running`.
  // -------------------------------------------------------------------------

  /**
   * One authenticated loopback request, mapped to `CookbooksApiError`:
   * not running / unreachable / timed out / non-JSON → `status === 0`; a
   * sidecar 4xx/5xx → its HTTP status with the sidecar's own `error` text (or
   * the status text). `timeoutMs` is a caller-side budget so a hung sidecar
   * handler cannot hold the IPC call open for undici's own default.
   */
  private async request<T>(
    path: string,
    init: { method: 'GET' | 'POST'; body?: unknown } = { method: 'GET' },
    timeoutMs = this.o.apiRequestTimeoutMs,
  ): Promise<T> {
    const startup = this.state === 'running' ? this.startup : null
    if (!startup) throw new CookbooksApiError(0, 'runtime not running')
    const headers: Record<string, string> = { Authorization: `Bearer ${startup.token}` }
    if (init.body !== undefined) headers['Content-Type'] = 'application/json'
    let response: Response
    try {
      response = await fetch(`http://127.0.0.1:${startup.port}${path}`, {
        method: init.method,
        headers,
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch (err) {
      if (err instanceof Error && err.name === 'TimeoutError') {
        throw new CookbooksApiError(0, 'timeout')
      }
      throw new CookbooksApiError(0, err instanceof Error ? err.message : String(err))
    }
    if (!response.ok) {
      const payload: unknown = await response.json().catch(() => null)
      const reported = asRecord(payload).error
      const message = typeof reported === 'string' && reported.length > 0
        ? reported
        : response.statusText || `HTTP ${response.status}`
      throw new CookbooksApiError(response.status, message)
    }
    try {
      return (await response.json()) as T
    } catch {
      throw new CookbooksApiError(0, `invalid JSON from sidecar (${path})`)
    }
  }

  /**
   * A fresh store snapshot. A failing resolver is an empty store: the lab then
   * reports the affected keys as missing instead of the surface erroring out.
   * The error text is never logged — it could echo a value.
   */
  private async resolveStoreSnapshot(): Promise<CookbooksStore> {
    try {
      return await this.o.resolveStore()
    } catch {
      this.o.log('warn', 'cookbooks-runtime: store resolve failed; using an empty store')
      return {}
    }
  }

  /**
   * Best-effort refresh of the sidecar's in-memory store (`POST /store`). A
   * no-op unless the runtime is `running`, and silent on any failure — the
   * lab's key chips and the next one-shot run payload are conveniences, never a
   * reason to fail an IPC call. Only the key NAMES are ever logged.
   *
   * The sidecar REPLACES its store with every snapshot, so a partial removal is
   * just a smaller push. An EMPTY store is different: the sidecar rejects an
   * empty `/store` body (`host.py:445`) and ignores an empty one-shot store
   * (`host.py:278`, `:356`). Once we have seeded keys, a store that becomes
   * empty is therefore cleared by replacing the sidecar process — a fresh
   * process starts empty, which is what keeps the chips and the injected env
   * honest instead of resurrecting a key the user just removed.
   */
  async pushStore(): Promise<void> {
    if (this.state !== 'running') return
    const store = await this.resolveStoreSnapshot()
    const keys = Object.keys(store)
    if (keys.length === 0) {
      // Claim the transition synchronously (before any await) so two concurrent
      // pushes cannot both restart the sidecar.
      const wasSeeded = this.storeSeeded
      this.storeSeeded = false
      if (wasSeeded) {
        // resolveStoreSnapshot() awaits file I/O and the provider chain; the
        // runtime may have stopped meanwhile (app quit, racing stop()). A
        // restart then would spawn a sidecar that nothing ever stops.
        if (this.state !== 'running') return
        this.o.log('info', 'cookbooks-runtime: store is empty; restarting the sidecar to clear it')
        try {
          // The restart is asynchronous; a failed one leaves the caller with a
          // stale store rather than an error it cannot act on.
          await this.restart()
        } catch {
          /* best-effort */
        }
      }
      return
    }
    try {
      await this.request<unknown>('/store', { method: 'POST', body: { store } })
      this.storeSeeded = true
      this.o.log('info', `cookbooks-runtime: store pushed (${keys.length} key(s): ${keys.join(', ')})`)
    } catch (err) {
      // Observable, but value-free: no sidecar error text (it can echo a body)
      // and no values — only the HTTP status and how many keys were attempted.
      const status = err instanceof CookbooksApiError ? err.status : 0
      this.o.log('warn', `cookbooks-runtime: store push failed (status=${status}, ${keys.length} key(s))`)
    }
  }

  /** `GET /catalog` → the read-only catalog cards (13 items today). */
  async apiCatalog(): Promise<CookbooksCard[]> {
    // Refresh the store first so the chips/banner reflect the current keys.
    await this.pushStore()
    const raw = await this.request<unknown[]>('/catalog')
    return Array.isArray(raw) ? raw.map(mapCard) : []
  }

  /**
   * `POST /open` (resume-or-create the personal copy) followed by
   * `GET /document/<itemId>`: the sidecar answers `/open` with a filesystem
   * path, so the document itself is read back through the document route.
   */
  async apiOpen(itemId: string, newCopy = false): Promise<{ copyId: string; document: CookbooksDocument }> {
    const opened = await this.request<unknown>('/open', { method: 'POST', body: { itemId, newCopy } })
    const copyId = asText(asRecord(opened).copyId)
    const document = await this.apiDocument(itemId)
    return { copyId, document }
  }

  /** `GET /document/<itemId>` → the stored cells (or the playbook text). */
  async apiDocument(itemId: string): Promise<CookbooksDocument> {
    const raw = await this.request<unknown>(`/document/${encodeURIComponent(itemId)}`)
    return mapDocument(itemId, raw)
  }

  /** `POST /run` → one cell's output. */
  async apiRun(itemId: string, code: string, index: number): Promise<CookbooksRunResult> {
    // One-shot store: the freshest snapshot at launch, merged by the sidecar
    // into its in-memory store for this run only.
    const store = await this.resolveStoreSnapshot()
    const raw = await this.request<unknown>(
      '/run',
      { method: 'POST', body: { itemId, code, index, store } },
      this.o.runApiTimeoutMs,
    )
    return mapRunResult(raw)
  }

  /** `POST /run-all` → one record per submitted cell, in document order. */
  async apiRunAll(
    itemId: string,
    cells: { index: number; source: string }[],
  ): Promise<{ cells: CookbooksRunCell[] }> {
    const store = await this.resolveStoreSnapshot()
    const raw = await this.request<unknown>(
      '/run-all',
      { method: 'POST', body: { itemId, cells, store } },
      this.o.runAllTimeoutMs(cells.length),
    )
    const records = asRecord(raw).cells
    return { cells: Array.isArray(records) ? records.map(mapRunCell) : [] }
  }

  /** `POST /save` → persists a cell source (`index`+`source`) or a playbook `text`. */
  async apiSave(payload: { itemId: string; index?: number; source?: string; text?: string }): Promise<void> {
    await this.request<unknown>('/save', { method: 'POST', body: payload })
  }

  /** `POST /reset` → the copy is restored to the catalog original. */
  async apiReset(itemId: string): Promise<void> {
    // The confirmation dialog belongs to the surface; by the time it calls in,
    // the user has already agreed (`/reset` refuses a dirty copy without it).
    await this.request<unknown>('/reset', { method: 'POST', body: { itemId, confirm: true } })
  }

  // -------------------------------------------------------------------------

  private beginStart(): Promise<CookbooksStatus> {
    this.crashes = 0
    this.preReadyAttempts = 0
    this.everReady = false
    this.startup = null
    this.runReachedReady = false
    this.pendingReason = null
    this.setState('starting')
    const { promise, resolve } = Promise.withResolvers<CookbooksStatus>()
    this.startWaiters.push(resolve)
    this.startInFlight = promise
    void this.resolveAndSpawn()
    return promise
  }

  private async resolveAndSpawn(): Promise<void> {
    let python: string | null = null
    let env: NodeJS.ProcessEnv = buildCookbooksChildEnv(process.env)
    try {
      python = await this.o.resolvePython()
      env = await this.o.buildEnv()
    } catch (err) {
      this.o.log('error', `cookbooks-runtime: resolve failed: ${err instanceof Error ? err.message : String(err)}`)
      python = null
    }
    if (this.state !== 'starting') return
    if (!python) {
      this.fail('python-missing')
      return
    }
    this.pythonPath = python
    this.childEnv = env
    this.spawn()
  }

  private spawn(): void {
    this.setState('starting')
    this.restartTimer = null
    if (!this.everReady) this.preReadyAttempts++
    const dir = this.o.getCookbooksDir()
    const python = this.pythonPath
    if (!dir || !python) {
      this.fail('spawn-failed')
      return
    }
    const entry = join(dir, 'scripts', 'serve_lab.py')
    const workspace = join(this.o.getWorkspaceDir(), 'cookbooks', 'workspace')
    const timeoutMs = this.everReady ? this.o.readyTimeoutMs : this.o.preReadyTimeoutMs
    this.startedAt = this.o.now()
    this.runReachedReady = false
    this.pendingReason = null
    let child: CookbooksChild
    try {
      child = this.o.spawn(python, ['-u', entry, '--workspace', workspace], {
        cwd: dir,
        env: this.childEnv ?? buildCookbooksChildEnv(process.env),
        stdio: 'pipe',
      })
    } catch (err) {
      this.o.log('error', `cookbooks-runtime: spawn failed: ${err instanceof Error ? err.message : String(err)}`)
      this.handleExit(-1, false)
      return
    }
    this.child = child
    this.readyTimer = this.o.setTimer(() => {
      if (this.runReachedReady || this.child !== child) return
      this.pendingReason = 'ready-timeout'
      this.o.log('warn', `cookbooks-runtime: not ready after ${timeoutMs}ms; stopping sidecar`)
      this.killChild(child)
    }, timeoutMs)
    let buffer = ''
    child.stdout?.on('data', (chunk) => {
      if (this.runReachedReady || this.child !== child) return
      buffer += chunk.toString()
      const parsed = parseCookbooksStartupLine(buffer)
      if (!parsed) return
      this.runReachedReady = true
      buffer = ''
      this.o.log('info', `cookbooks-runtime: sidecar listening on 127.0.0.1:${parsed.port}`)
      this.startHealthPoll(child, parsed)
    })
    child.stderr?.on('data', (chunk) => {
      for (const line of String(chunk).split(/\r?\n/)) {
        if (line.trim().length > 0) this.pushStderr(line)
      }
    })
    child.on('exit', (code) => {
      this.o.clearTimer(this.readyTimer)
      this.readyTimer = null
      this.o.clearTimer(this.healthTimer)
      this.healthTimer = null
      if (this.child === child) this.handleExit(code ?? -1, this.runReachedReady)
    })
  }

  private startHealthPoll(child: CookbooksChild, parsed: CookbooksStartup): void {
    const poll = () => {
      if (this.child !== child) return
      void Promise.resolve()
        .then(() => this.o.checkHealth(parsed.port))
        .then((ok) => {
          if (this.child !== child) return
          if (ok) {
            this.o.clearTimer(this.readyTimer)
            this.readyTimer = null
            this.markRunning(parsed)
            return
          }
          this.healthTimer = this.o.setTimer(poll, this.o.healthPollIntervalMs)
        })
        .catch(() => {
          if (this.child !== child) return
          this.healthTimer = this.o.setTimer(poll, this.o.healthPollIntervalMs)
        })
    }
    poll()
  }

  private markRunning(parsed: CookbooksStartup): void {
    this.startup = parsed
    this.everReady = true
    this.startedAt = this.o.now()
    this.setState('running')
    this.resolveStartWaiters(this.getStatus())
    this.startInFlight = null
    // A fresh sidecar process always starts with an empty store, whatever we
    // seeded into the one that just exited.
    this.storeSeeded = false
    // Seed it so the very first catalog read (chips/banner) reflects the
    // configured keys. Best-effort.
    void this.pushStore()
  }

  private killChild(child: CookbooksChild): void {
    try {
      child.kill(this.o.signal)
    } catch {
      /* already gone */
    }
    this.killTimer = this.o.setTimer(() => {
      if (this.child !== child) return
      this.o.log('warn', `cookbooks-runtime: no exit ${this.o.killHardTimeoutMs}ms after kill; treating as exited`)
      this.handleExit(-9, this.runReachedReady)
    }, this.o.killHardTimeoutMs)
  }

  private handleExit(code: number, runWasReady: boolean): void {
    this.child = null
    if (this.state === 'stopping' || this.state === 'stopped') {
      this.setState('stopped')
      const waiters = this.exitWaiters
      this.exitWaiters = []
      for (const fn of waiters) fn()
      return
    }
    if (!this.everReady) {
      if (this.preReadyAttempts >= this.o.preReadyMaxAttempts) {
        this.fail(this.pendingReason ?? 'spawn-failed')
        return
      }
      this.scheduleRestart(this.o.backoffBaseMs)
      return
    }
    const ranMs = this.o.now() - this.startedAt
    this.crashes = runWasReady && ranMs >= this.o.stableAfterMs ? 1 : this.crashes + 1
    if (this.crashes > this.o.maxCrashes) {
      this.o.log('error', `cookbooks-runtime: giving up after ${this.crashes - 1} restarts (exit ${code})`)
      this.fail('crashed')
      return
    }
    this.scheduleRestart(computeCookbooksBackoffMs(this.crashes, this.o.backoffBaseMs, this.o.backoffMaxMs))
  }

  private scheduleRestart(delay: number): void {
    this.o.log('warn', `cookbooks-runtime: exited; restart in ${delay}ms`)
    this.setState('starting')
    this.restartTimer = this.o.setTimer(() => {
      if (this.state === 'starting' && this.child === null) this.spawn()
    }, delay)
  }

  private fail(reason: CookbooksFailureReason): void {
    this.setState('failed', reason)
    this.resolveStartWaiters(this.getStatus())
    this.startInFlight = null
  }

  private setState(state: CookbooksState, reason: CookbooksFailureReason | null = null): void {
    if (this.state === state && this.reason === reason) return
    this.state = state
    this.reason = reason
    const status = this.getStatus()
    for (const listener of this.statusListeners) listener(status)
    this.o.onStatusChanged?.(status)
  }

  private resolveStartWaiters(status: CookbooksStatus): void {
    const waiters = this.startWaiters
    this.startWaiters = []
    for (const fn of waiters) fn(status)
  }

  private clearRunTimers(): void {
    if (this.restartTimer) {
      this.o.clearTimer(this.restartTimer)
      this.restartTimer = null
    }
    if (this.readyTimer) {
      this.o.clearTimer(this.readyTimer)
      this.readyTimer = null
    }
    if (this.healthTimer) {
      this.o.clearTimer(this.healthTimer)
      this.healthTimer = null
    }
  }

  private pushStderr(line: string): void {
    // Two layers: `token=` is masked structurally, and any value the secret
    // chain has registered is masked by identity (the sidecar must never echo a
    // key, but a traceback can).
    const redacted = redactRegisteredSecrets(redactCookbooksLogLine(line))
    this.stderrRing.push(redacted)
    this.stderrRingBytes += Buffer.byteLength(redacted, 'utf8') + 1
    while (this.stderrRingBytes > STDERR_RING_MAX_BYTES && this.stderrRing.length > 0) {
      const dropped = this.stderrRing.shift() as string
      this.stderrRingBytes -= Buffer.byteLength(dropped, 'utf8') + 1
    }
    this.o.log('warn', `cookbooks[stderr]: ${redacted}`)
  }
}

// ---------------------------------------------------------------------------
// Process-wide singleton (main/index.ts owns the lifecycle; IPC handlers read it)
// ---------------------------------------------------------------------------

let active: CookbooksRuntime | null = null

export function initializeCookbooksRuntime(options: CookbooksRuntimeOptions = {}): CookbooksRuntime {
  if (!active) active = new CookbooksRuntime(options)
  return active
}

export function getCookbooksRuntime(): CookbooksRuntime | null {
  return active
}

/** Idempotent `performQuitCleanup()` hook: stops the sidecar if one was started. */
export async function stopCookbooksRuntime(): Promise<void> {
  const runtime = active
  active = null
  if (runtime) await runtime.stop()
}
