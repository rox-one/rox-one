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
import { readFile, writeFile as fsWriteFile } from 'node:fs/promises'
import { get as httpGet } from 'node:http'
import { delimiter, join } from 'node:path'
import { redactRegisteredSecrets, resolveSecretsForSpawn, type SecretRefEntry } from '@rox/shared/secrets'
import { getBundledAssetsDir } from '@rox/shared/utils'
import { resolveConfigDir } from '@rox/shared/config/paths'
import { getToolchain, withToolchainPathPrefix } from '@rox/shared/toolchain-runtime'
import { CookbooksApiError, parseCookbooksStartupLine } from '../shared/cookbooks'
import type {
  CookbooksCancelResult,
  CookbooksCard,
  CookbooksCell,
  CookbooksDisplay,
  CookbooksDocument,
  CookbooksExportResult,
  CookbooksFailureReason,
  CookbooksMutateInput,
  CookbooksMutateResult,
  CookbooksOutput,
  CookbooksRunAllResult,
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

/**
 * Wave 11: тот же cap, что у сайдкара — путь чтения недоверенного ipynb не
 * должен декодировать гигантов (G4-F1: 512 KiB на запись, ≤12 записей, 1.5 MiB
 * на ячейку/прогон). The sidecar already applied them when it wrote; main
 * re-applies them so a copy that arrived from outside cannot hang the renderer.
 */
export const DISPLAY_MAX_RECORD_CHARS = 524_288
export const DISPLAY_MAX_RECORDS = 12
export const DISPLAY_MAX_TOTAL_CHARS = 1_572_864
/** Byte-for-byte the sidecar's own marker (`kernel.py::_DISPLAY_TRUNCATION_MARKER`). */
export const DISPLAY_TRUNCATION_MARKER = '…[display output truncated]'

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

/** The lab catalog key the shared ROX gateway key stands in for. */
const OPENAI_LAB_KEY = 'openai.api_key'

/**
 * Default store source: the vendored catalog's `secretMap` (read through
 * `getBundledAssetsDir`) resolved through the canonical chain — environment
 * (`ROX_SECRET_<ENV>`) → local-encrypted → infisical.
 *
 * Precedence: a key the credential chain resolves always wins. When the catalog
 * maps `openai.api_key` and the chain resolved nothing for it, the shared ROX
 * gateway key (`ROX_API_KEY`) is used instead — `installRoxDefaults` (branch
 * feat/default-rox-r1-max) embeds it in the client, so notebooks work out of
 * the box against api.rox.one. A key the catalog does not map is never
 * invented, an absent/blank `ROX_API_KEY` fills nothing, and an unreadable
 * catalog or a resolver failure yields an empty store. Never throws.
 */
export async function defaultCookbooksStore(
  dir?: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<CookbooksStore> {
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
    // Embedded ROX gateway fallback: the shared key is baked into the client by
    // `installRoxDefaults` (branch feat/default-rox-r1-max), so a notebook mapped
    // to `openai.api_key` works out of the box against api.rox.one. The
    // credential-chain result always wins — this only fills a gap the chain left
    // open for a key the catalog actually maps, and a blank value fills nothing.
    if (OPENAI_LAB_KEY in secretMap && !(OPENAI_LAB_KEY in store)) {
      const embedded = env.ROX_API_KEY?.trim()
      if (embedded) store[OPENAI_LAB_KEY] = embedded
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

// ---------------------------------------------------------------------------
// Notebook export dependencies (SPEC wave 9 §3)
//
// Injected so the save flow can be exercised without Electron. The default
// dialog uses `await import('electron')` rather than a static import: this
// module is loaded by unit tests under plain `bun` (no Electron runtime), so
// an eager `import ... from 'electron'` would make the whole supervisor
// unloadable there. The default writer is `fs/promises.writeFile`.
// ---------------------------------------------------------------------------

export interface CookbooksSaveDialogOptions {
  defaultPath: string
  filters: { name: string; extensions: string[] }[]
}

export interface CookbooksSaveDialogResult {
  canceled: boolean
  filePath?: string
}

export interface CookbooksExportDeps {
  showSaveDialog?: (options: CookbooksSaveDialogOptions) => Promise<CookbooksSaveDialogResult>
  writeFile?: (path: string, data: string, encoding: 'utf8') => Promise<void>
}

async function defaultShowSaveDialog(options: CookbooksSaveDialogOptions): Promise<CookbooksSaveDialogResult> {
  const { dialog } = await import('electron')
  return dialog.showSaveDialog(options)
}

const defaultWriteFile: NonNullable<CookbooksExportDeps['writeFile']> = (path, data, encoding) =>
  fsWriteFile(path, data, encoding)

/**
 * Wave 14 §8: the save dialog's filter list follows the export's own file
 * extension, so a `.py` script is saved as a Python file and an `.ipynb` as a
 * notebook. The extension is read from the basename (`/a.b/c.py` → `py`,
 * case-insensitively); an unknown or absent extension falls back to `*`.
 */
function exportSaveFilters(filename: string): { name: string; extensions: string[] }[] {
  const basename = filename.slice(Math.max(filename.lastIndexOf('/'), filename.lastIndexOf('\\')) + 1)
  const dot = basename.lastIndexOf('.')
  const extension = dot === -1 ? '' : basename.slice(dot + 1).toLowerCase()
  switch (extension) {
    case 'ipynb':
      return [{ name: 'Jupyter Notebook', extensions: ['ipynb'] }]
    case 'py':
      return [{ name: 'Python Script', extensions: ['py'] }]
    case 'html':
      return [{ name: 'HTML', extensions: ['html'] }]
    default:
      return [{ name: 'All Files', extensions: ['*'] }]
  }
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

/**
 * Wave 11 (G3-3): one canonical record per payload at the DTO boundary — the
 * mime is `String(mime).trim().toLowerCase()` so a copy may not smuggle the
 * same thing under `IMAGE/PNG` and ` image/png `, an empty mime is not a record
 * at all, and byte-identical records are not repeated. Payloads that differ stay
 * separate records even under one mime: a cell may legitimately display the same
 * mime twice (`display('a'); display('b')`), and the renderer draws one widget
 * per record. Runs after the cap, so it only ever walks the bounded list.
 */
function normaliseDisplays(entries: CookbooksDisplay[]): CookbooksDisplay[] {
  const seen = new Set<string>()
  const unique: CookbooksDisplay[] = []
  for (const entry of entries) {
    const mime = String(entry.mime).trim().toLowerCase()
    if (mime.length === 0) continue
    const key = `${mime}\u0000${entry.data}`
    if (seen.has(key)) continue
    seen.add(key)
    unique.push({ mime, data: entry.data })
  }
  return unique
}

/**
 * Wave 11: the runner's own record list (`[{mime, data}]` from the results
 * file). Entry-wise, like `asStringArray`: only an object carrying string
 * `mime` and `data` survives, so a malformed entry is dropped rather than
 * rendered half-built; anything that is not an array — including a pre-wave-11
 * payload — is simply no display at all.
 */
function mapDisplays(value: unknown): CookbooksDisplay[] {
  if (!Array.isArray(value)) return []
  const displays: CookbooksDisplay[] = []
  for (const entry of value) {
    const record = asRecord(entry)
    if (typeof record.mime === 'string' && typeof record.data === 'string') {
      displays.push({ mime: record.mime, data: record.data })
    }
  }
  return normaliseDisplays(capDisplays(displays))
}

/**
 * Wave 11 (G4-F1): тот же cap, что у сайдкара — путь чтения недоверенного ipynb
 * не должен декодировать гигантов. Mirrors the sidecar (`kernel.py::_rox_add` +
 * `_rox_records`): a record over 512 KiB is clipped in place, the list stops at
 * 12 records or when the 1.5 MiB budget would be exceeded, and ONE marker record
 * is appended if anything had to be dropped or clipped; a list that already fits
 * passes through untouched.
 */
function capDisplays(entries: CookbooksDisplay[]): CookbooksDisplay[] {
  const capped: CookbooksDisplay[] = []
  let total = 0
  let truncated = false
  for (const entry of entries) {
    if (capped.length >= DISPLAY_MAX_RECORDS) {
      truncated = true
      break
    }
    const clipped = entry.data.length > DISPLAY_MAX_RECORD_CHARS
      ? entry.data.slice(0, DISPLAY_MAX_RECORD_CHARS)
      : entry.data
    if (clipped !== entry.data) truncated = true
    if (total + clipped.length > DISPLAY_MAX_TOTAL_CHARS) {
      truncated = true
      break
    }
    capped.push(clipped === entry.data ? entry : { mime: entry.mime, data: clipped })
    total += clipped.length
  }
  if (truncated) capped.push({ mime: 'text/plain', data: DISPLAY_TRUNCATION_MARKER })
  return capped
}

/**
 * Wave 11: a persisted `display_data` output keeps its mime bundle in `data`
 * (`{mime: value}`), so a document read flattens that object into the ordered
 * record list the renderer consumes. A value the runner stored as a JSON
 * document (nbformat parses `application/json`) is re-serialised; anything that
 * is not a mime-bundle object — a stream output, a malformed payload — is `[]`.
 */
function mapDisplayBundle(value: unknown): CookbooksDisplay[] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return []
  const displays: CookbooksDisplay[] = []
  for (const [mime, entry] of Object.entries(value as RawRecord)) {
    if (typeof entry === 'string') displays.push({ mime, data: entry })
    else if (entry !== undefined) displays.push({ mime, data: JSON.stringify(entry) })
  }
  return normaliseDisplays(capDisplays(displays))
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
    // Wave 11: a persisted `display_data` carries its mime bundle in `data`.
    displays: mapDisplayBundle(output.data),
  }
}

function mapCell(raw: unknown): CookbooksCell {
  const cell = asRecord(raw)
  const count = cell.execution_count
  return {
    // Same rule as the lab page: `code` is runnable, everything else is prose.
    cellType: cell.cell_type === 'code' ? 'code' : 'markdown',
    source: asText(cell.source),
    outputs: Array.isArray(cell.outputs) ? cell.outputs.map(mapOutput) : [],
    // Wave 11: nbformat writes an int or the literal `null` ("never ran").
    executionCount: typeof count === 'number' && Number.isInteger(count) ? count : null,
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
  const cancelled = result.cancelled
  return {
    ok: result.ok === true,
    stdout: asText(result.stdout),
    error: typeof result.error === 'string' ? result.error : null,
    timedOut: result.timed_out === true,
    missing: asStringArray(result.missing),
    // Wave 11: the results-file records, validated entry-wise; a kill/timeout
    // leaves no file behind and therefore no display.
    displays: mapDisplays(result.displays),
    // Additive wave-9 field: only present when the sidecar actually sent it, so
    // a pre-wave-9 payload maps to exactly the same object as before.
    ...(typeof cancelled === 'boolean' ? { cancelled } : {}),
  }
}

function mapRunCell(raw: unknown): CookbooksRunCell {
  const cell = asRecord(raw)
  const index = typeof cell.index === 'number' ? cell.index : Number(cell.index)
  const duration = cell.duration_ms
  return {
    index: Number.isInteger(index) ? index : 0,
    status: cell.status === 'error' ? 'error' : cell.status === 'skipped' ? 'skipped' : 'ok',
    stdout: asText(cell.stdout),
    error: typeof cell.error === 'string' ? cell.error : null,
    // Wave 11: this cell's own records, validated entry-wise like every other
    // array main maps (a malformed entry never reaches the renderer).
    displays: mapDisplays(cell.displays),
    // Wave 13: the sidecar has always timed each cell of a batch run; main used
    // to drop it. A non-finite/absent value stays `undefined` (never 0, which
    // would read as "instant"), so the renderer shows a duration only when there
    // really is one.
    durationMs:
      typeof duration === 'number' && Number.isFinite(duration) ? Math.round(duration) : undefined,
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
  ): Promise<CookbooksRunAllResult> {
    const store = await this.resolveStoreSnapshot()
    const raw = await this.request<unknown>(
      '/run-all',
      { method: 'POST', body: { itemId, cells, store } },
      this.o.runAllTimeoutMs(cells.length),
    )
    const payload = asRecord(raw)
    const records = payload.cells
    const cancelled = payload.cancelled
    return {
      cells: Array.isArray(records) ? records.map(mapRunCell) : [],
      // Top-level, additive wave-9 flag: cells left without a record were cancelled.
      ...(typeof cancelled === 'boolean' ? { cancelled } : {}),
    }
  }

  /**
   * `POST /cancel` → interrupts every active execution of `itemId` (both `/run`
   * and `/run-all`). Idempotent: `cancelled: 0` when nothing was running.
   */
  async apiCancel(itemId: string): Promise<CookbooksCancelResult> {
    const raw = await this.request<unknown>('/cancel', { method: 'POST', body: { itemId } })
    const payload = asRecord(raw)
    const cancelled = typeof payload.cancelled === 'number' ? payload.cancelled : Number(payload.cancelled)
    return { ok: payload.ok === true, cancelled: Number.isInteger(cancelled) ? cancelled : 0 }
  }

  /**
   * Main-side notebook/script export: ask the user where to save `content`,
   * then write it. The save dialog's filter is derived from the filename's own
   * extension (wave 14 §8: `.ipynb` → Jupyter Notebook, `.py` → Python Script,
   * `.html` → HTML, anything else → All Files). `dialog`/`fs` are injected so
   * the flow is unit-testable without Electron; the defaults are the real
   * `dialog.showSaveDialog` and `fsPromises.writeFile` (imported lazily — this
   * module must not pull in Electron at load time). A dismissed dialog resolves
   * `{saved:false}`; a failed write rejects, and the renderer turns that into a
   * notice.
   */
  async exportNotebook(
    input: { itemId: string; filename: string; content: string },
    deps: CookbooksExportDeps = {},
  ): Promise<CookbooksExportResult> {
    const showSaveDialog = deps.showSaveDialog ?? defaultShowSaveDialog
    const writeFile = deps.writeFile ?? defaultWriteFile
    const result = await showSaveDialog({
      defaultPath: input.filename,
      filters: exportSaveFilters(input.filename),
    })
    const filePath = result.filePath
    if (result.canceled || typeof filePath !== 'string' || filePath.length === 0) {
      return { saved: false }
    }
    await writeFile(filePath, input.content, 'utf8')
    return { saved: true, path: filePath }
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

  /**
   * Wave 10: `POST /cells/<op>` → the sidecar's `{ok, index}`, then a fresh
   * `GET /document/<itemId>` (SPEC wave 10 §Контракт shared/main/IPC). The
   * request body carries exactly the fields of the chosen op — never `op`
   * itself and never an `undefined` field (an absent `source` stays absent, so
   * the sidecar applies its own default). A sidecar 400/409 surfaces as the
   * existing `CookbooksApiError` with the sidecar's own `error` text.
   */
  async apiMutate(input: CookbooksMutateInput): Promise<CookbooksMutateResult> {
    // Defense-in-depth: the compile-time union does not protect a caller that
    // casts, so an op outside the five routes is rejected before any URL/body
    // is built (never interpolated into the path).
    if (
      input.op !== 'add' &&
      input.op !== 'delete' &&
      input.op !== 'move' &&
      input.op !== 'duplicate' &&
      input.op !== 'convert'
    ) {
      throw new CookbooksApiError(400, 'unknown op')
    }
    const { itemId } = input
    // switch (not `body: input`) so `op` never reaches the sidecar body.
    const body: Record<string, unknown> = { itemId }
    switch (input.op) {
      case 'add':
        body.cellType = input.cellType
        body.index = input.index
        if (input.source !== undefined) body.source = input.source
        break
      case 'delete':
        body.index = input.index
        break
      case 'move':
        body.from = input.from
        body.to = input.to
        break
      case 'duplicate':
        body.index = input.index
        break
      // Wave 13: same fields as `add` minus `source` — the cell keeps its own
      // text and only its type changes.
      case 'convert':
        body.index = input.index
        body.cellType = input.cellType
        break
    }
    const raw = await this.request<unknown>(`/cells/${input.op}`, { method: 'POST', body })
    // Wave 10: контракт {ok:true, index:int} — битый ответ это протокольная
    // ошибка, не тихий фолбэк (иначе фокус молча встал бы на ячейку 0).
    const record = asRecord(raw)
    const index = record.index
    if (record.ok !== true || typeof index !== 'number' || !Number.isInteger(index)) {
      throw new CookbooksApiError(0, 'malformed /cells response')
    }
    // Re-read through the document route: the sidecar answers a mutation with
    // just the focus index, never the whole document.
    const document = await this.apiDocument(itemId)
    return { document, index }
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
