/**
 * Cookbooks — shared contract module (SPEC §Data & API contracts + §Amendment 1).
 *
 * The single common module of the `cookbooks-surface` program: the runtime
 * state/failure vocabulary, the frozen discovery-line parser, the data-plane
 * DTOs the native ROX surface renders, and the typed API error main raises.
 *
 * SECURITY: main is the only HTTP client of the sidecar; nothing in this module
 * (or in the IPC contract built on it) ever carries the bearer token or the full
 * loopback URL. `CookbooksStatus` deliberately exposes just `port` while
 * running — no `token`, no `url` — and the DTOs below are pure document data.
 */

/** Runtime states of the vendored Cookbooks sidecar (SPEC §Состояния). */
export type CookbooksState = 'idle' | 'starting' | 'running' | 'stopping' | 'stopped' | 'failed'

/** Why the sidecar is not running; `null` while idle/starting/running/stopping/stopped. */
export type CookbooksFailureReason =
  | 'python-missing' // interpreter not found in any source
  | 'spawn-failed' // spawn threw or the process died before the ready line (pre-ready attempts exhausted)
  | 'ready-timeout' // the discovery line did not arrive within preReadyTimeoutMs
  | 'crashed' // more than maxCrashes falls after readiness

/**
 * Renderer-facing status. Contains the port only while `state === 'running'`;
 * NEVER a token or a full URL (invariant asserted by tests).
 */
export interface CookbooksStatus {
  state: CookbooksState
  reason: CookbooksFailureReason | null
  port: number | null
}

/** Main-only discovery payload: the full loopback URL with its bearer token. */
export interface CookbooksStartup {
  port: number
  token: string
  url: string
}

// ---------------------------------------------------------------------------
// Data plane DTOs (SPEC §Amendment 1) — main maps the sidecar's JSON into these.
// ---------------------------------------------------------------------------

/** One catalog entry. Credential key NAMES only — never values (ADR §5). */
export interface CookbooksCard {
  id: string
  title: string
  vendor: string
  kind: 'ipynb' | 'md'
  secretsHave: string[]
  secretsMissing: string[]
  disabled: boolean
  disabledReason: string | null
}

/** One persisted notebook output: stream/execute text, or an error traceback. */
export interface CookbooksOutput {
  text: string
  traceback: string | null
}

/** One notebook cell as stored in the copy (source is already a single string). */
export interface CookbooksCell {
  cellType: 'code' | 'markdown'
  source: string
  outputs: CookbooksOutput[]
}

/** An opened document. `text` is set for playbooks (`.md`), `cells` for notebooks. */
export interface CookbooksDocument {
  itemId: string
  kind: 'ipynb' | 'md'
  title: string
  supported: boolean
  missing: string[]
  cells: CookbooksCell[]
  text: string | null
}

// ---------------------------------------------------------------------------
// Structural cell mutations (SPEC wave 10 §Контракт shared/main/IPC)
// ---------------------------------------------------------------------------

/**
 * The four structural notebook operations, addressed by position (the vendored
 * `.ipynb` carries no stable per-cell id). One discriminated union keeps the
 * protocol surface at a single `cookbooks-lab:mutate` channel.
 */
export type CookbooksCellMutation =
  | { op: 'add'; cellType: 'code' | 'markdown'; index: number; source?: string }
  | { op: 'delete'; index: number }
  | { op: 'move'; from: number; to: number }
  | { op: 'duplicate'; index: number }

/** Input of `cookbooks-lab:mutate`: the target copy plus the operation. */
export type CookbooksMutateInput = { itemId: string } & CookbooksCellMutation

/**
 * Result of a structural mutation: the document re-read after the sidecar
 * applied it, plus the cell index the renderer should focus (`-1` when a
 * delete emptied the notebook).
 */
export interface CookbooksMutateResult {
  document: CookbooksDocument
  index: number
}

/** Result of running one cell (`POST /run`). */
export interface CookbooksRunResult {
  ok: boolean
  stdout: string
  error: string | null
  timedOut: boolean
  missing: string[]
  /**
   * `true` when the run was interrupted by a `/cancel` (additive sidecar field,
   * SPEC wave 9 §1). Absent on a sidecar that predates the field.
   */
  cancelled?: boolean
}

/** Result of a "Run all" (`POST /run-all`): per-cell records + the run-wide flag. */
export interface CookbooksRunAllResult {
  cells: CookbooksRunCell[]
  /** `true` when the whole run was interrupted; cells without a record were cancelled. */
  cancelled?: boolean
}

/** Result of `POST /cancel` — how many active executions it stopped. */
export interface CookbooksCancelResult {
  ok: boolean
  cancelled: number
}

/** Result of the main-side `.ipynb` export (`cookbooks-lab:export`). */
export interface CookbooksExportResult {
  saved: boolean
  path?: string
}

/** Per-cell record of a "Run all" (`POST /run-all`). */
export interface CookbooksRunCell {
  index: number
  status: 'ok' | 'error' | 'skipped' | 'cancelled'
  stdout: string
  error: string | null
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * Typed failure of a data-plane call.
 *
 * - `status === 0` — nothing was answered: the runtime was not `running`, the
 *   request never reached the sidecar (network error), or the response was not
 *   JSON. `message` is the local reason.
 * - `status > 0` — the sidecar answered with that HTTP status; `message` is its
 *   own `error` field verbatim (or the HTTP status text when it sent none).
 */
export class CookbooksApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'CookbooksApiError'
    this.status = status
  }
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

/**
 * Frozen discovery-line grammar (SPEC §Discovery-строка, contract §3.1):
 * a single stdout line `http://127.0.0.1:<port>/lab.html?token=<t>`.
 *
 * - the WHOLE line must match (anchored), so partial/embedded URLs never parse;
 * - port is `\d{1,5}` and must be in 1–65535 (else `null`);
 * - token is base64url, at least 24 characters;
 * - with several matching lines in the buffer, the FIRST wins;
 * - nothing is ever logged here.
 */
const STARTUP_LINE_PATTERN =
  /^http:\/\/127\.0\.0\.1:(\d{1,5})\/lab\.html\?token=([A-Za-z0-9_-]{24,})$/

export function parseCookbooksStartupLine(line: string): CookbooksStartup | null {
  if (typeof line !== 'string' || line.length === 0) return null
  for (const raw of line.split(/\r?\n/)) {
    const candidate = raw.trim()
    if (candidate.length === 0) continue
    const match = STARTUP_LINE_PATTERN.exec(candidate)
    if (!match) continue
    const port = Number(match[1])
    if (!Number.isInteger(port) || port < 1 || port > 65535) return null
    const token = match[2]
    return { port, token, url: `http://127.0.0.1:${port}/lab.html?token=${token}` }
  }
  return null
}

// ---------------------------------------------------------------------------
// Notebook export (SPEC wave 9 §4)
// ---------------------------------------------------------------------------

/** One cell of the export builder input — a run result flattened for the file. */
export interface CookbooksExportCell {
  cellType: 'code' | 'markdown'
  source: string
  executionCount?: number | null
  stdout?: string
  error?: string
}

/**
 * nbformat 4.5 line split: every line keeps its trailing `\n` except the last,
 * and an empty string yields no lines at all (nbformat's `[]`, never `['']`).
 */
function toNotebookLines(text: string): string[] {
  if (text.length === 0) return []
  const lines = text.split('\n').map((line, index, all) => (index < all.length - 1 ? `${line}\n` : line))
  // A final newline produced an empty trailing element — it belongs to the line
  // before it, not to a line of its own.
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop()
  return lines
}

/**
 * Build a deterministic nbformat 4.5 `.ipynb` document as pretty-printed JSON.
 *
 * Pure: no `Date`, no randomness, so the same input always renders byte-equal.
 * A code cell's `stdout`/`error` become stream outputs (`stdout`/`stderr`) only
 * when non-empty; markdown cells carry just their source.
 */
export function buildNotebookExport(input: {
  title: string
  cells: Array<{
    cellType: 'code' | 'markdown'
    source: string
    executionCount?: number | null
    stdout?: string
    error?: string
  }>
}): string {
  const cells = input.cells.map((cell) => {
    if (cell.cellType === 'markdown') {
      return {
        cell_type: 'markdown' as const,
        metadata: {},
        source: toNotebookLines(cell.source),
      }
    }
    const outputs: Array<Record<string, unknown>> = []
    if (typeof cell.stdout === 'string' && cell.stdout.length > 0) {
      outputs.push({ output_type: 'stream', name: 'stdout', text: toNotebookLines(cell.stdout) })
    }
    if (typeof cell.error === 'string' && cell.error.length > 0) {
      outputs.push({ output_type: 'stream', name: 'stderr', text: toNotebookLines(cell.error) })
    }
    return {
      cell_type: 'code' as const,
      source: toNotebookLines(cell.source),
      execution_count: cell.executionCount ?? null,
      metadata: {},
      outputs,
    }
  })
  return JSON.stringify({ cells, metadata: { title: input.title }, nbformat: 4, nbformat_minor: 5 }, null, 2)
}
