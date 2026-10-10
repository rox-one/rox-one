/**
 * Codebook step engine (03-SPEC-features §9; 02-SPEC-foundations §6.3; 05-PLAN В5).
 *
 * Executes an ordered notebook of cells — `script`, `agent`, `artifact` — as a
 * long local run with cancellation and per-cell progress, reusing the existing
 * spawn/job patterns:
 *
 * - `script` spawns an executable directly (`command` + argv, `shell: false`),
 *   exactly like `devspace/clone.ts` runs git and `playbooks/assemble.ts` runs
 *   ffmpeg. It NEVER routes through the shell-exec RPC (20 s timeout / 1 MiB cap, §6.3).
 * - `agent` dispatches to the server session mechanism through an injected
 *   `CodebookAgentRunner`; a host without one answers `agent-unavailable`
 *   instead of inventing output.
 * - `artifact` references an existing dev-space artifact by id through an
 *   injected resolver; the journal keeps the reference, never the content.
 *
 * Every dependency is injected, so the whole flow is unit-testable with a fake
 * process runner / agent / resolver and no real binary, network or session.
 */
import { spawn } from 'node:child_process'
import { CodebookRunError } from '@rox/shared/playbooks'
import type {
  CodebookCell, CodebookCellKind, CodebookJobState, CodebookRun, CodebookStepResult,
} from '@rox/shared/playbooks'

/** Per-step wall-clock budget; long pipelines outlive the shell-exec RPC's 20 s budget. */
export const DEFAULT_STEP_TIMEOUT_MS = 15 * 60 * 1000
/** Bound on retained stdout/stderr per step (last N chars), mirroring `playbooks/assemble.ts`. */
export const MAX_STEP_OUTPUT_CHARS = 64 * 1024
/** Bound on the inline record kept when no artifact publisher is composed. */
export const MAX_INLINE_OUTPUT_CHARS = 16 * 1024
export const MAX_CELLS_PER_RUN = 64

export interface CodebookProcessInput {
  readonly command: string
  readonly args: readonly string[]
  readonly cwd: string
  readonly signal: AbortSignal
  readonly timeoutMs: number
}

export interface CodebookProcessResult {
  readonly code: number | null
  readonly stdout: string
  readonly stderr: string
}

/** Spawn seam. The default implementation spawns a binary — never a shell. */
export type CodebookProcessRunner = (input: CodebookProcessInput) => Promise<CodebookProcessResult>

export interface CodebookAgentStepInput {
  readonly prompt: string
  readonly workspaceId: string
  readonly notebookId: string
  readonly runId: string
  readonly cellId: string
  readonly projectSlug: string
  readonly workingDirectory?: string
  readonly signal: AbortSignal
}

export interface CodebookAgentRun {
  readonly sessionId: string
  readonly text: string
}

/** Server-session reuse seam (create session + send message). */
export interface CodebookAgentRunner {
  run(input: CodebookAgentStepInput): Promise<CodebookAgentRun>
}

export interface CodebookArtifactRef {
  readonly artifactId: string
  /** Path relative to the project's dev-space root, when known. */
  readonly path?: string
  readonly format?: string
}

export interface CodebookArtifactResolveInput {
  readonly artifactId: string
  readonly root: string
  readonly projectSlug: string
}

/** Resolves a dev-space artifact id to its reference (never its content). */
export interface CodebookArtifactResolver {
  resolve(input: CodebookArtifactResolveInput): Promise<CodebookArtifactRef | null>
}

export interface CodebookArtifactPublishInput {
  readonly root: string
  readonly projectSlug: string
  readonly runId: string
  readonly cellId: string
  readonly kind: CodebookCellKind
  readonly text: string
}

/** Optional: persist a step's output as a dev-space artifact and return its reference. */
export type CodebookArtifactPublisher = (input: CodebookArtifactPublishInput) => Promise<CodebookArtifactRef>

export interface CodebookEngineDeps {
  readonly run?: CodebookProcessRunner
  readonly agent?: CodebookAgentRunner
  readonly artifacts?: CodebookArtifactResolver
  readonly publishArtifact?: CodebookArtifactPublisher
  readonly now?: () => number
  readonly stepTimeoutMs?: number
}

export interface CodebookProgress {
  readonly state: CodebookJobState
  readonly cellIndex: number
  readonly doneSteps: number
  readonly steps: readonly CodebookStepResult[]
}

export interface CodebookEngineInput {
  readonly root: string
  readonly workspaceId: string
  readonly projectSlug: string
  readonly notebookId: string
  readonly runId: string
  readonly workingDirectory?: string
  readonly title?: string
  readonly cells: readonly CodebookCell[]
  /** Full-notebook index of each executed cell (parallel to `cells`); defaults to 0..n-1. */
  readonly indexes?: readonly number[]
  readonly signal: AbortSignal
  readonly onProgress: (progress: CodebookProgress) => void
}

/**
 * Default spawn runner: no shell, bounded output, abort → SIGTERM and a
 * timeout → `ETIMEDOUT` so the engine can surface a typed `step-timeout`.
 */
export const spawnCodebookProcess: CodebookProcessRunner = (input) => {
  const child = spawn(input.command, [...input.args], { shell: false, cwd: input.cwd, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
  const { promise, resolve, reject } = Promise.withResolvers<CodebookProcessResult>()
  let stdout = ''
  let stderr = ''
  let settled = false
  const finish = (result: CodebookProcessResult | Error) => {
    if (settled) return
    settled = true
    clearTimeout(timer)
    input.signal.removeEventListener('abort', onAbort)
    if (result instanceof Error) reject(result)
    else resolve(result)
  }
  const onAbort = () => child.kill('SIGTERM')
  const timer = setTimeout(() => {
    child.kill('SIGTERM')
    finish(Object.assign(new Error('step timeout'), { code: 'ETIMEDOUT' }))
  }, input.timeoutMs)
  if (input.signal.aborted) onAbort()
  else input.signal.addEventListener('abort', onAbort, { once: true })
  child.stdout?.on('data', (chunk: Buffer) => { stdout = (stdout + chunk.toString('utf8')).slice(-MAX_STEP_OUTPUT_CHARS) })
  child.stderr?.on('data', (chunk: Buffer) => { stderr = (stderr + chunk.toString('utf8')).slice(-MAX_STEP_OUTPUT_CHARS) })
  child.once('error', error => finish(error))
  child.once('close', code => finish({ code, stdout, stderr }))
  return promise
}

function requireString(value: unknown, detail: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new CodebookRunError('invalid-input', detail)
  return value
}

/** Validate one cell's shape for its kind; refuses anything the engine cannot execute safely. */
function validateCell(cell: CodebookCell): void {
  requireString(cell.id, 'codebook-cell-id')
  if (cell.kind !== 'script' && cell.kind !== 'agent' && cell.kind !== 'artifact') {
    throw new CodebookRunError('invalid-input', 'codebook-cell-kind')
  }
  if (cell.kind === 'script') {
    const command = requireString(cell.command, 'codebook-cell-command')
    // A shell string is never a valid executable: refuse metacharacters and whitespace
    // so a raw shell line cannot smuggle shell-exec semantics through the spawn seam.
    if (/[\s;&|`$><*?()[\]{}"'\\]/.test(command)) throw new CodebookRunError('invalid-input', 'codebook-cell-command-shell')
    if (cell.args !== undefined && (!Array.isArray(cell.args) || cell.args.some(arg => typeof arg !== 'string'))) {
      throw new CodebookRunError('invalid-input', 'codebook-cell-args')
    }
  }
  if (cell.kind === 'agent') requireString(cell.prompt, 'codebook-cell-prompt')
  if (cell.kind === 'artifact') requireString(cell.artifactId, 'codebook-cell-artifact')
}

function cancelled(signal: AbortSignal): boolean {
  return signal.aborted
}

/**
 * Execute one cell and return its result. Throws `CodebookRunError` for a
 * terminal failure; the caller owns the run-level status.
 */
async function executeCell(input: {
  readonly cell: CodebookCell
  readonly index: number
  readonly environment: CodebookEngineInput
  readonly deps: CodebookEngineDeps
  readonly now: () => number
}): Promise<CodebookStepResult> {
  const { cell, index } = input
  const base = { cellId: cell.id, index, kind: cell.kind, startedAt: input.now() } as const

  if (cell.kind === 'script') {
    const command = cell.command as string
    const repository = input.environment.workingDirectory
    if (cell.cwd === 'repository' && !repository) throw new CodebookRunError('invalid-input', 'codebook-cell-repository-cwd')
    // Default is the repository working directory when the project has one, else the workspace root.
    const cwd = cell.cwd === 'workspace' || (cell.cwd === undefined && !repository) ? input.environment.root : (repository as string)
    const runner = input.deps.run ?? spawnCodebookProcess
    let result: CodebookProcessResult
    try {
      result = await runner({ command, args: cell.args ?? [], cwd, signal: input.environment.signal, timeoutMs: input.deps.stepTimeoutMs ?? DEFAULT_STEP_TIMEOUT_MS })
    } catch (error) {
      if (cancelled(input.environment.signal)) throw new CodebookRunError('cancelled', 'codebook.cancelled')
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new CodebookRunError('command-unavailable', 'codebook.command')
      if ((error as NodeJS.ErrnoException).code === 'ETIMEDOUT') throw new CodebookRunError('step-timeout', 'codebook.step-timeout')
      throw new CodebookRunError('step-failed', error instanceof Error ? error.message.slice(0, 200) : 'codebook.step')
    }
    if (cancelled(input.environment.signal)) throw new CodebookRunError('cancelled', 'codebook.cancelled')
    if (result.code !== 0) {
      throw new CodebookRunError('step-failed', `codebook.exit-${result.code ?? 'signal'}`,
        { exitCode: result.code, ...(result.stderr ? { stderr: result.stderr.slice(-4_000) } : {}) })
    }
    const output = await recordOutput({ text: result.stdout, kind: 'script', cell, environment: input.environment, deps: input.deps,
      extra: { exitCode: result.code, ...(result.stderr ? { stderr: result.stderr.slice(-4_000) } : {}) } })
    return { ...base, status: 'succeeded', output, finishedAt: input.now() }
  }

  if (cell.kind === 'agent') {
    if (!input.deps.agent) throw new CodebookRunError('agent-unavailable', 'codebook.agent')
    const run = await input.deps.agent.run({
      prompt: cell.prompt as string,
      workspaceId: input.environment.workspaceId,
      notebookId: input.environment.notebookId,
      runId: input.environment.runId,
      cellId: cell.id,
      projectSlug: input.environment.projectSlug,
      ...(input.environment.workingDirectory ? { workingDirectory: input.environment.workingDirectory } : {}),
      signal: input.environment.signal,
    }).catch(error => {
      if (cancelled(input.environment.signal)) throw new CodebookRunError('cancelled', 'codebook.cancelled')
      if (error instanceof CodebookRunError) throw error
      throw new CodebookRunError('step-failed', error instanceof Error ? error.message.slice(0, 200) : 'codebook.agent')
    })
    if (cancelled(input.environment.signal)) throw new CodebookRunError('cancelled', 'codebook.cancelled')
    const output = await recordOutput({ text: run.text, kind: 'agent', cell, environment: input.environment, deps: input.deps,
      extra: { sessionId: run.sessionId } })
    return { ...base, status: 'succeeded', output, finishedAt: input.now() }
  }

  // artifact: resolve a reference, never copy content.
  if (!input.deps.artifacts) throw new CodebookRunError('artifact-unavailable', 'codebook.artifacts')
  const resolved = await input.deps.artifacts.resolve({
    artifactId: cell.artifactId as string, root: input.environment.root, projectSlug: input.environment.projectSlug,
  }).catch(() => null)
  if (!resolved) throw new CodebookRunError('artifact-unavailable', 'codebook.artifact')
  return {
    ...base,
    status: 'succeeded',
    output: {
      artifactId: resolved.artifactId,
      ...(resolved.path ? { artifactPath: resolved.path } : {}),
      ...(resolved.format ? { artifactFormat: resolved.format } : {}),
    },
    finishedAt: input.now(),
  }
}

/**
 * Persist a step's output: when a publisher is composed, store it as an artifact
 * and keep only the reference; otherwise keep a bounded inline record (the run
 * journal is the step's own transcript, not a copy of an artifact).
 */
async function recordOutput(input: {
  readonly text: string
  readonly kind: CodebookCellKind
  readonly cell: CodebookCell
  readonly environment: CodebookEngineInput
  readonly deps: CodebookEngineDeps
  readonly extra: Partial<CodebookStepResult['output']>
}): Promise<CodebookStepResult['output']> {
  const extra = input.extra
  if (input.deps.publishArtifact) {
    const reference = await input.deps.publishArtifact({
      root: input.environment.root,
      projectSlug: input.environment.projectSlug,
      runId: input.environment.runId,
      cellId: input.cell.id,
      kind: input.kind,
      text: input.text,
    })
    return {
      artifactId: reference.artifactId,
      ...(reference.path ? { artifactPath: reference.path } : {}),
      ...(reference.format ? { artifactFormat: reference.format } : {}),
      ...extra,
    }
  }
  const text = input.text.slice(0, MAX_INLINE_OUTPUT_CHARS)
  return { ...(text ? { text } : {}), ...extra }
}

/**
 * Run a notebook end to end. Cells execute strictly in order; the first failure
 * (or cancellation) stops the run, and the returned record carries the failing
 * cell's index. A cancelled or failed run is only journaled by the RPC layer,
 * never published as a success.
 */
export async function runCodebook(input: CodebookEngineInput, deps: CodebookEngineDeps = {}): Promise<CodebookRun> {
  const now = deps.now ?? (() => Date.now())
  if (input.cells.length === 0) throw new CodebookRunError('invalid-input', 'codebook-empty')
  if (input.cells.length > MAX_CELLS_PER_RUN) throw new CodebookRunError('limit-exceeded', 'codebook-cells')
  const seen = new Set<string>()
  for (const cell of input.cells) {
    validateCell(cell)
    if (seen.has(cell.id)) throw new CodebookRunError('invalid-input', 'codebook-cell-duplicate')
    seen.add(cell.id)
  }
  const indexes = input.indexes ?? input.cells.map((_, position) => position)
  if (indexes.length !== input.cells.length) throw new CodebookRunError('invalid-input', 'codebook-indexes')

  const startedAt = now()
  const steps: CodebookStepResult[] = input.cells.map((cell, position) => ({
    cellId: cell.id, index: indexes[position] as number, kind: cell.kind, status: 'pending',
  }))
  const emit = (state: CodebookJobState, cellIndex: number, doneSteps: number): void => {
    input.onProgress({ state, cellIndex, doneSteps, steps: steps.map(step => ({ ...step })) })
  }
  emit('running', -1, 0)

  for (const [position, cell] of input.cells.entries()) {
    if (cancelled(input.signal)) {
      const run: CodebookRun = { schemaVersion: 1, id: input.runId, notebookId: input.notebookId, projectSlug: input.projectSlug,
        ...(input.title ? { title: input.title } : {}), status: 'cancelled', startedAt, finishedAt: now(), steps,
        error: { code: 'cancelled', cellIndex: indexes[position] } }
      emit('cancelled', indexes[position] as number, position)
      return run
    }
    steps[position] = { ...(steps[position] as CodebookStepResult), status: 'running', startedAt: now() }
    emit('running', indexes[position] as number, position)
    try {
      steps[position] = await executeCell({ cell, index: indexes[position] as number, environment: input, deps, now })
      emit('running', indexes[position] as number, position + 1)
    } catch (error) {
      const failure = error instanceof CodebookRunError ? error : new CodebookRunError('step-failed', 'codebook.step')
      if (failure.code === 'cancelled') {
        steps[position] = { ...(steps[position] as CodebookStepResult), status: 'cancelled', finishedAt: now(), error: { code: failure.code } }
        const run: CodebookRun = { schemaVersion: 1, id: input.runId, notebookId: input.notebookId, projectSlug: input.projectSlug,
          ...(input.title ? { title: input.title } : {}), status: 'cancelled', startedAt, finishedAt: now(), steps,
          error: { code: 'cancelled', cellIndex: indexes[position] } }
        emit('cancelled', indexes[position] as number, position)
        return run
      }
      steps[position] = { ...(steps[position] as CodebookStepResult), status: 'failed', finishedAt: now(),
        ...(failure.output ? { output: failure.output } : {}),
        error: { code: failure.code, detail: failure.message.slice(0, 200) } }
      const run: CodebookRun = { schemaVersion: 1, id: input.runId, notebookId: input.notebookId, projectSlug: input.projectSlug,
        ...(input.title ? { title: input.title } : {}), status: 'failed', startedAt, finishedAt: now(), steps,
        error: { code: failure.code, cellIndex: indexes[position] as number, detail: failure.message.slice(0, 200) } }
      emit('failed', indexes[position] as number, position)
      return run
    }
  }

  const run: CodebookRun = { schemaVersion: 1, id: input.runId, notebookId: input.notebookId, projectSlug: input.projectSlug,
    ...(input.title ? { title: input.title } : {}), status: 'succeeded', startedAt, finishedAt: now(), steps }
  emit('done', indexes[indexes.length - 1] ?? -1, input.cells.length)
  return run
}