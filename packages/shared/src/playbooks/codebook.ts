/**
 * Playbooks codebook contract (docs/specs/2026-10-09-dev-space-and-playbooks/03-SPEC-features §9, D12;
 * 04-UI-SPEC B.15 С-15; 05-PLAN В5).
 *
 * A codebook notebook is an ordered sequence of cells that a local run executes
 * step by step. The push channel `playbooks:codebookJob` follows ONE run, and
 * `seq` is monotonic per job and is the ONLY ordering authority (the
 * `voice/job-machine.ts` / `voice/podcast-job.ts` discipline).
 *
 * Cell kinds map onto the three execution seams the engine composes:
 * - `script` spawns an executable (`command` + `args`) with `shell:false` —
 *   NEVER a shell string and NEVER `shell:exec` (02-SPEC-foundations §6.3).
 * - `agent` reuses the server session mechanism (create session + send message)
 *   through an injected runner; a host without one answers `agent-unavailable`.
 * - `artifact` references an existing dev-space artifact by `artifactId` and
 *   never copies its content into the run journal.
 *
 * This module is renderer-safe: pure types and a job state machine, no Node IO.
 */

/** Execution kinds of a codebook cell. */
export type CodebookCellKind = 'script' | 'agent' | 'artifact'

/** Where a `script` cell runs; `repository` is the project working directory. */
export type CodebookCellCwd = 'repository' | 'workspace'

/**
 * One notebook cell as sent to the engine. `cells` order is the execution order;
 * `cellIds` may select a subset (run-one-cell) without reordering.
 *
 * A `script` cell carries an executable name (`command`) and an argv (`args`),
 * never a shell string: the engine spawns the binary directly with `shell:false`.
 */
export interface CodebookCell {
  readonly id: string
  readonly kind: CodebookCellKind
  readonly title?: string
  /** `script` cells: executable name; resolved on PATH, never interpreted by a shell. */
  readonly command?: string
  readonly args?: readonly string[]
  /** Defaults to `repository` when the project has a working directory, else `workspace`. */
  readonly cwd?: CodebookCellCwd
  /** `agent` cells: the prompt dispatched to a fresh (or reused) agent session. */
  readonly prompt?: string
  /** `artifact` cells: the referenced dev-space artifact id (`artifact_<sha256>`). */
  readonly artifactId?: string
}

/** Per-cell lifecycle inside one run. */
export type CodebookStepStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'skipped'

/** Typed failure codes a renderer branches on; never a message. */
export type CodebookErrorCode =
  | 'invalid-input'
  | 'not-found'
  | 'step-failed'
  | 'step-timeout'
  | 'agent-unavailable'
  | 'artifact-unavailable'
  | 'command-unavailable'
  | 'cancelled'
  | 'limit-exceeded'
  | 'storage-failed'

/**
 * A cell's output. Content is never duplicated: when the host composes an
 * artifact publisher, `artifactId`/`artifactPath` reference the persisted
 * artifact and `text` is omitted; otherwise `text` is the bounded run record.
 */
export interface CodebookStepOutput {
  /** Bounded inline output (script stdout / agent final text) when no artifact was published. */
  readonly text?: string
  /** Reference to a dev-space artifact (§7, В2); the journal never stores its bytes. */
  readonly artifactId?: string
  /** Path relative to the artifact root when known. */
  readonly artifactPath?: string
  readonly artifactFormat?: string
  /** `script` cells: process exit code (`null` when killed by a signal). */
  readonly exitCode?: number | null
  /** `script` cells: bounded stderr tail. */
  readonly stderr?: string
  /** `agent` cells: the session the step was dispatched to. */
  readonly sessionId?: string
  /** Code refs (`rox-code:v1:` / `CodeCitation`); opaque here so the contract stays renderer-safe. */
  readonly citations?: readonly string[]
}

export interface CodebookStepError {
  readonly code: CodebookErrorCode
  /** Sanitised detail (no source text, no secrets). */
  readonly detail?: string
}

/** One cell's terminal or in-flight result inside a run. */
export interface CodebookStepResult {
  readonly cellId: string
  /** Position in the notebook, independent of `cellIds` selection. */
  readonly index: number
  readonly kind: CodebookCellKind
  readonly status: CodebookStepStatus
  readonly output?: CodebookStepOutput
  readonly error?: CodebookStepError
  readonly startedAt?: number
  readonly finishedAt?: number
}

/** Run lifecycle (`playbooks:codebookJob`). */
export type CodebookJobState = 'queued' | 'running' | 'done' | 'failed' | 'cancelled'

export interface CodebookJobError {
  readonly code: CodebookErrorCode
  /** Index (in the notebook) of the cell that failed, when a single cell is at fault. */
  readonly cellIndex?: number
  readonly detail?: string
}

export interface CodebookJob {
  readonly schemaVersion: 1
  readonly id: string
  readonly notebookId: string
  /** Durable journal record this job writes on completion. */
  readonly runId: string
  readonly projectSlug: string
  readonly state: CodebookJobState
  /** Monotonic per job, mirroring `voice/job-machine.ts` seq semantics. */
  readonly seq: number
  /** Position of the cell currently executing, or the last one executed. */
  readonly cellIndex: number
  readonly totalCells: number
  readonly doneSteps: number
  readonly steps: readonly CodebookStepResult[]
  readonly error?: CodebookJobError
}

export const CODEBOOK_JOB_TRANSITIONS: Readonly<Record<CodebookJobState, readonly CodebookJobState[]>> = {
  queued: ['running', 'failed', 'cancelled'],
  running: ['done', 'failed', 'cancelled'],
  done: [],
  failed: [],
  cancelled: [],
}

export function createCodebookJob(input: {
  readonly id: string
  readonly notebookId: string
  readonly runId: string
  readonly projectSlug: string
  /** Ordered cells the run will execute (already filtered by `cellIds`). */
  readonly cells: readonly CodebookCell[]
  /** Full-notebook index of every executed cell. */
  readonly indexes?: readonly number[]
}): CodebookJob {
  const steps: CodebookStepResult[] = input.cells.map((cell, position) => ({
    cellId: cell.id,
    index: input.indexes?.[position] ?? position,
    kind: cell.kind,
    status: 'pending',
  }))
  return {
    schemaVersion: 1,
    id: input.id,
    notebookId: input.notebookId,
    runId: input.runId,
    projectSlug: input.projectSlug,
    state: 'queued',
    seq: 0,
    cellIndex: -1,
    totalCells: steps.length,
    doneSteps: 0,
    steps,
  }
}

/**
 * Apply an event to a job. Identity and monotonic-seq guards mirror
 * `voice/job-machine.ts`: a foreign job id or a non-advancing `seq` is ignored,
 * so a late push can never rewind a finished run.
 */
export function applyCodebookJobEvent(
  current: CodebookJob,
  next: Partial<CodebookJob> & { seq: number; id: string },
): CodebookJob {
  if (next.id !== current.id) return current
  if (next.seq <= current.seq) return current
  return { ...current, ...next, seq: next.seq }
}

/** Advance to `next` only along `CODEBOOK_JOB_TRANSITIONS`; illegal moves are ignored. */
export function advanceCodebookJob(
  current: CodebookJob,
  next: CodebookJobState,
  seq: number,
  patch: Partial<CodebookJob> = {},
): CodebookJob {
  if (next === current.state) return applyCodebookJobEvent(current, { ...patch, id: current.id, seq })
  if (!CODEBOOK_JOB_TRANSITIONS[current.state].includes(next)) return current
  return applyCodebookJobEvent(current, { ...patch, id: current.id, seq, state: next })
}

// ---------------------------------------------------------------------------
// RPC payload contract (`playbooks:runCodebook` / `cancelCodebook` / `codebookRuns`)
// ---------------------------------------------------------------------------

export interface CodebookEnvelope {
  readonly workspaceId: string
  readonly requestId?: string
}

export interface CodebookRunInput extends CodebookEnvelope {
  readonly notebookId: string
  /** Target project; omitted uses the workspace's `playbooks` container (created on demand). */
  readonly projectSlug?: string
  readonly title?: string
  readonly cells: readonly CodebookCell[]
  /** Run only these cells (in notebook order); omitted runs every cell. */
  readonly cellIds?: readonly string[]
}

export interface CodebookRunResult {
  readonly jobId: string
  readonly runId: string
  readonly notebookId: string
}

export interface CodebookCancelInput extends CodebookEnvelope {
  /** Defaults to the caller's active codebook job. */
  readonly jobId?: string
  /** When no jobId is given, restrict to this notebook's active job. */
  readonly notebookId?: string
}

export interface CodebookCancelResult {
  readonly cancelled: boolean
}

export interface CodebookRunsInput extends CodebookEnvelope {
  /** Omitted lists the workspace's default `playbooks` container. */
  readonly projectSlug?: string
}

/** The durable journal record written to `projects/<slug>/dev-space/codebook/runs/<runId>.json`. */
export interface CodebookRun {
  readonly schemaVersion: 1
  readonly id: string
  readonly notebookId: string
  readonly projectSlug: string
  readonly title?: string
  readonly status: 'succeeded' | 'failed' | 'cancelled'
  readonly startedAt: number
  readonly finishedAt?: number
  readonly steps: readonly CodebookStepResult[]
  readonly error?: CodebookJobError
}

export interface CodebookRunsResult {
  readonly runs: readonly CodebookRun[]
}

/**
 * Typed engine failure. The engine throws it with a `CodebookErrorCode`; the RPC
 * layer maps the code onto a protocol `ErrorCode` and the job record carries the
 * same code, so a client branches on the code rather than on a message.
 */
export class CodebookRunError extends Error {
  constructor(readonly code: CodebookErrorCode, detail?: string, /** Partial cell output captured before the failure (e.g. a script's exit code/stderr). */
    readonly output?: CodebookStepOutput) {
    super(detail ? `${code}: ${detail}` : code)
    this.name = 'CodebookRunError'
  }
}