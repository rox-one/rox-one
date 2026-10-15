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

/**
 * Wave 11: one rich display record — a single mime-bundle entry of a
 * `display_data` output. `data` is a string on every hop (base64 for `image/*`,
 * the payload itself for text mimes; `application/json` is a JSON document).
 */
export interface CookbooksDisplay {
  mime: string
  data: string
}

/** One persisted notebook output: stream/execute text, an error traceback, rich displays. */
export interface CookbooksOutput {
  text: string
  traceback: string | null
  /** Wave 11: rich records persisted after the text (`[]` on a pre-wave-11 copy). */
  displays: CookbooksDisplay[]
}

/** One notebook cell as stored in the copy (source is already a single string). */
export interface CookbooksCell {
  cellType: 'code' | 'markdown'
  source: string
  outputs: CookbooksOutput[]
  /** Wave 11: nbformat `execution_count` — `null` when the cell never ran. */
  executionCount: number | null
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
 * The structural notebook operations, addressed by position (the vendored
 * `.ipynb` carries no stable per-cell id). One discriminated union keeps the
 * protocol surface at a single `cookbooks-lab:mutate` channel.
 */
export type CookbooksCellMutation =
  | { op: 'add'; cellType: 'code' | 'markdown'; index: number; source?: string }
  | { op: 'delete'; index: number }
  | { op: 'move'; from: number; to: number }
  | { op: 'duplicate'; index: number }
  /** Wave 13: switch a cell between code and markdown in place (Colab's y/m). */
  | { op: 'convert'; index: number; cellType: 'code' | 'markdown' }

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
   * Wave 11: rich records the runner wrote to its results file — `[]` when the
   * cell produced none, and also when a kill/timeout left no file behind.
   */
  displays: CookbooksDisplay[]
  /**
   * `true` when the run was interrupted by a `/cancel` (additive sidecar field,
   * SPEC wave 9 §1). Absent on a sidecar that predates the field.
   */
  cancelled?: boolean
  /**
   * Wave 15: how long the cell took, in whole milliseconds. Measured host-side
   * and carried by the stream's `end` frame; `undefined` when it is unknown (a
   * pre-wave-15 payload, or a sidecar that sent no usable number).
   */
  durationMs?: number
}

/** Result of a "Run all" (`POST /run-all`): per-cell records + the run-wide flag. */
export interface CookbooksRunAllResult {
  cells: CookbooksRunCell[]
  /** `true` when the whole run was interrupted; cells without a record were cancelled. */
  cancelled?: boolean
  /**
   * Wave 15: the batch's total wall time in whole milliseconds, carried by the
   * stream's `end` frame. `undefined` when the sidecar sent no usable number.
   */
  durationMs?: number
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
  /** Wave 11: rich records this cell produced (`[]` when it produced none). */
  displays: CookbooksDisplay[]
  /**
   * Wave 13: the sidecar's own `duration_ms` for this cell, rounded to whole
   * milliseconds. `undefined` when the record carries no usable number — a
   * cell the runner never timed (a skipped one), or a malformed value.
   */
  durationMs?: number
}

// ---------------------------------------------------------------------------
// Wave 15: live streaming (SPEC wave 15 §Решения 7 + §Контракт кадров)
//
// `runStream`/`runAllStream` are FAST invokes: they resolve `{runId}` as soon
// as the sidecar accepts the run, so the 60 s transport ceiling never applies
// to the run itself. The frames then arrive on `cookbooks-lab:run-event`,
// converted from the sidecar's snake_case NDJSON to these camelCase events.
//
// The renderer mints `runId` (crypto.randomUUID) and passes it in the input,
// which removes the "event before the invoke answer" race.
// ---------------------------------------------------------------------------

/** Input of `cookbooks-lab:run-stream` — one cell's current source. */
export interface CookbooksRunStreamInput {
  /** Renderer-minted id; every event of this run carries it back. */
  runId: string
  itemId: string
  code: string
  index?: number
}

/** Input of `cookbooks-lab:run-all-stream` — the ordered cells of a batch run. */
export interface CookbooksRunAllStreamInput {
  runId: string
  itemId: string
  cells: { index: number; source: string }[]
}

/** The fast invoke answer: the caller's own `runId`, echoed back. */
export interface CookbooksRunStreamHandle {
  runId: string
}

/** `start` — the first frame of every stream (the sidecar accepted the run). */
interface CookbooksRunStreamStartEvent {
  t: 'start'
  runId: string
  seq: number
  itemId: string
  /** `null` for `/run-stream`; the submitted document indexes for run-all. */
  index: number | null
  cells: number[] | null
  timeout: number
}

/** `cell-start` — a batch run moved on to this cell (`/run-all-stream` only). */
interface CookbooksRunStreamCellStartEvent {
  t: 'cell-start'
  runId: string
  seq: number
  index: number
}

/** `stdout`/`stderr` — one already-REDACTED live fragment. */
interface CookbooksRunStreamOutputEvent {
  t: 'stdout' | 'stderr'
  runId: string
  seq: number
  index: number | null
  data: string
}

/** `display` — one rich record, emitted just before `end` (`/run-stream`). */
interface CookbooksRunStreamDisplayEvent {
  t: 'display'
  runId: string
  seq: number
  index: number | null
  mime: string
  data: string
}

/**
 * `cell-end` — the full record of one batch cell (the same shape as one entry
 * of `CookbooksRunAllResult.cells`), so the renderer can merge it incrementally.
 */
interface CookbooksRunStreamCellEndEvent {
  t: 'cell-end'
  runId: string
  seq: number
  index: number
  status: 'ok' | 'error' | 'skipped'
  ok: boolean
  timedOut: boolean
  durationMs?: number
  returncode: number | null
  error: string | null
  stdout: string
  stderr: string
  displays: CookbooksDisplay[]
}

/**
 * `end` — the authoritative final frame (also sent on cancel/timeout, with
 * `cancelled: true`). `result` is the complete run DTO, so the surface replaces
 * its live buffers with the runner's own record.
 */
interface CookbooksRunStreamEndEvent {
  t: 'end'
  runId: string
  seq: number
  ok: boolean
  returncode: number | null
  timedOut: boolean
  cancelled: boolean
  missing: string[]
  durationMs: number | null
  result: CookbooksRunResult | CookbooksRunAllResult
}

/**
 * `error` — a per-frame failure after the stream started. Main also emits it
 * itself (with `status: 0`) when the connection breaks or the reader hits its
 * budget, so the surface never waits for an `end` that cannot arrive.
 */
interface CookbooksRunStreamErrorEvent {
  t: 'error'
  runId: string
  seq: number
  status: number
  error: string
}

/** One push of `cookbooks-lab:run-event`: a frame plus its identity and order. */
export type CookbooksRunStreamEvent =
  | CookbooksRunStreamStartEvent
  | CookbooksRunStreamCellStartEvent
  | CookbooksRunStreamOutputEvent
  | CookbooksRunStreamDisplayEvent
  | CookbooksRunStreamCellEndEvent
  | CookbooksRunStreamEndEvent
  | CookbooksRunStreamErrorEvent

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
  /**
   * Wave 11: rich records to persist as `display_data` outputs — written after
   * the stream outputs, in emission order.
   */
  displays?: CookbooksDisplay[]
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
 * when non-empty; its `displays` follow them as `display_data` outputs (wave 11);
 * markdown cells carry just their source.
 */
export function buildNotebookExport(input: {
  title: string
  cells: CookbooksExportCell[]
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
    // Wave 11: one `display_data` output per rich record, after the streams.
    // nbformat keeps an `application/json` bundle parsed (a nested value), so a
    // JSON payload that parses is written as-is; one that does not is kept
    // verbatim. Every other mime — base64 images included — is already a string.
    const displays: CookbooksDisplay[] = Array.isArray(cell.displays) ? cell.displays : []
    for (const display of displays) {
      let value: unknown = display.data
      if (display.mime === 'application/json') {
        try {
          value = JSON.parse(display.data) as unknown
        } catch {
          value = display.data
        }
      }
      outputs.push({ output_type: 'display_data', metadata: {}, data: { [display.mime]: value } })
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

/**
 * Split `text` into raw lines for the `.py` builder: `\n`-separated, with a
 * single trailing newline folded away (so `'a\n'` and `'a'` both yield `['a']`).
 * Empty text yields no lines at all — never a phantom `['']`.
 */
function toScriptLines(text: string): string[] {
  if (text.length === 0) return []
  const lines = text.split('\n')
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop()
  return lines
}

/**
 * Build a deterministic `.py` script from the notebook cells (wave 14 §8).
 *
 * Layout: a `# <title>` header comment, then one block per cell, each opened by
 * a `# %%` cell marker (the Jupytext / VS Code "percent" format). A code cell is
 * written verbatim; a markdown cell becomes `# `-prefixed comments, line by
 * line. Execution counts and outputs have no place in a script.
 *
 * Pure: no `Date`, no randomness, so the same input always renders byte-equal.
 * The script always ends with exactly one `\n`.
 */
export function buildPythonScript(input: { title: string; cells: CookbooksExportCell[] }): string {
  const lines: string[] = [input.title.length === 0 ? '#' : `# ${input.title}`]
  for (const cell of input.cells) {
    lines.push('# %%')
    const sourceLines = toScriptLines(cell.source)
    if (cell.cellType === 'markdown') {
      // A markdown cell becomes line-by-line comments; a blank line is a bare `#`.
      for (const sourceLine of sourceLines) lines.push(sourceLine.length === 0 ? '#' : `# ${sourceLine}`)
    } else {
      for (const sourceLine of sourceLines) lines.push(sourceLine)
    }
  }
  return `${lines.join('\n')}\n`
}
