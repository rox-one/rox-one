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

/** Result of running one cell (`POST /run`). */
export interface CookbooksRunResult {
  ok: boolean
  stdout: string
  error: string | null
  timedOut: boolean
  missing: string[]
}

/** Per-cell record of a "Run all" (`POST /run-all`). */
export interface CookbooksRunCell {
  index: number
  status: 'ok' | 'error' | 'skipped'
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
