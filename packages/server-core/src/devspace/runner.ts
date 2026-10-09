/**
 * Dev Space analysis runner (02-SPEC-foundations §6): an in-process, fire-and-forget
 * pipeline with a stage registry, monotonic progress pushes and cancellation.
 *
 * Execution is deliberately in-process (O3 verdict): stages run inside the local
 * server with an `AbortSignal`, never through `shell:exec` (20 s / 1 MiB caps, §6.3).
 * `registerDevSpaceHandlers` registers the full stage set (`reconcile`,
 * `structural`, `llm`, `publish`) at start; tests may register individual stages,
 * so a run over an unregistered stage honestly finishes `partial` instead of
 * fabricating artifacts.
 *
 * The run journal is rewritten atomically after every stage boundary, so resume and
 * crash recovery both read consistent state (§6.2).
 */
import type {
  DevSpaceRepositoryRecord, DevSpaceRun, DevSpaceRunProgress, DevSpaceRunStage, DevSpaceRunStatus,
} from '@rox/shared/dev-space'
import { writeDevSpaceRun } from './runs.ts'

/** What a stage contributes back to the run record. */
export interface DevSpaceStageOutcome {
  /** Only `reconcile` sets this: the snapshot the pipeline resolved for this run. */
  readonly snapshotId?: string
  /** Manifest entry ids produced by the stage (§7). */
  readonly artifacts?: readonly string[]
  /** The stage ran but could not finish everything (e.g. a deadline, §6.4). */
  readonly partial?: boolean
}

/** Monotonic progress reporter scoped to the currently executing stage. */
export type DevSpaceStageReport = (done: number, total: number) => void

export interface DevSpaceStageContext {
  readonly runId: string
  readonly repositoryId: string
  readonly snapshotId: string
  readonly workspaceId: string
  readonly projectSlug: string
  readonly root: string
  readonly record: DevSpaceRepositoryRecord
  readonly signal: AbortSignal
  readonly report: DevSpaceStageReport
}

export type DevSpaceStageFn = (context: DevSpaceStageContext) => Promise<DevSpaceStageOutcome | void> | DevSpaceStageOutcome | void

// ---------------------------------------------------------------------------
// Stage registry — populated by the slice that owns each stage.
// ---------------------------------------------------------------------------
const registeredStages = new Map<DevSpaceRunStage, DevSpaceStageFn>()

export function registerDevSpaceStage(stage: DevSpaceRunStage, fn: DevSpaceStageFn): void {
  registeredStages.set(stage, fn)
}

export function hasDevSpaceStage(stage: DevSpaceRunStage): boolean {
  return registeredStages.has(stage)
}

/** Test seam only: drop every registration so a fixture starts from a known registry. */
export function clearDevSpaceStages(): void {
  registeredStages.clear()
}

// ---------------------------------------------------------------------------
// Active-run registry — the cancellation handle behind `devSpace:cancel`.
// ---------------------------------------------------------------------------
export interface DevSpaceActiveRun {
  readonly controller: AbortController
  readonly status: DevSpaceRunStatus
}

const activeRuns = new Map<string, DevSpaceActiveRun>()

export function registerDevSpaceActiveRun(runId: string, controller: AbortController): void {
  activeRuns.set(runId, { controller, status: 'queued' })
}

export function unregisterDevSpaceActiveRun(runId: string): void {
  activeRuns.delete(runId)
}

export function isDevSpaceRunActive(runId: string): boolean {
  return activeRuns.has(runId)
}

/** Abort every in-flight run (server shutdown); returns how many were signaled. */
export function abortAllDevSpaceRuns(): number {
  const runIds = [...activeRuns.keys()]
  for (const run of activeRuns.values()) run.controller.abort()
  return runIds.length
}

function setActiveStatus(runId: string, status: DevSpaceRunStatus): void {
  const active = activeRuns.get(runId)
  if (active) activeRuns.set(runId, { controller: active.controller, status })
}

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------
export interface RunDevSpacePipelineInput {
  readonly run: DevSpaceRun
  readonly record: DevSpaceRepositoryRecord
  readonly root: string
  readonly clientId: string
  readonly signal: AbortSignal
  readonly emit: (progress: DevSpaceRunProgress) => void
  /** Best-effort audit sink; a failure here never fails the run. */
  readonly audit?: (event: Record<string, unknown>) => void
}

/** Error codes are surfaced to the journal, never raw messages (no secret leakage). */
function stageErrorCode(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code
  return typeof code === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(code) ? code : 'stage-failed'
}

/**
 * Execute (or resume) one run to a terminal status. Never throws: failures are
 * recorded as `failed`/`partial` on the journal. The caller owns the registry
 * entry, progress transport and cancellation wiring.
 */
export async function runDevSpacePipeline(input: RunDevSpacePipelineInput): Promise<DevSpaceRun> {
  const completed = new Set<DevSpaceRunStage>(input.run.completedStages ?? [])
  const artifacts = new Set<string>(input.run.artifacts ?? [])
  let partial = false
  let run: DevSpaceRun = input.run

  const emitProgress = (stage: DevSpaceRunStage, done: number, total: number): void => {
    run = { ...run, progress: { stage, done, total } }
    input.emit({ repositoryId: run.repositoryId, runId: run.id, stage, done, total })
  }

  const settle = async (status: DevSpaceRunStatus, error?: { code: string; stage: DevSpaceRunStage }): Promise<DevSpaceRun> => {
    run = { ...run, status, finishedAt: Date.now(), ...(error ? { error } : {}) }
    setActiveStatus(run.id, status)
    await writeDevSpaceRun(input.root, input.record.projectSlug, run)
    input.emit({ repositoryId: run.repositoryId, runId: run.id, stage: run.progress.stage, done: run.progress.done, total: run.progress.total })
    return run
  }

  run = { ...run, status: 'running' }
  setActiveStatus(run.id, 'running')
  await writeDevSpaceRun(input.root, input.record.projectSlug, run)

  for (const stage of run.stages) {
    if (completed.has(stage)) continue
    if (input.signal.aborted) return settle('cancelled')
    const fn = registeredStages.get(stage)
    if (!fn) { partial = true; continue }
    emitProgress(stage, 0, 1)
    try {
      const outcome = await fn({
        runId: run.id,
        repositoryId: run.repositoryId,
        snapshotId: run.snapshotId,
        workspaceId: input.record.workspaceId,
        projectSlug: input.record.projectSlug,
        root: input.root,
        record: input.record,
        signal: input.signal,
        report: (done, total) => emitProgress(stage, done, total),
      })
      if (input.signal.aborted) return settle('cancelled')
      completed.add(stage)
      if (outcome?.partial) partial = true
      for (const id of outcome?.artifacts ?? []) artifacts.add(id)
      run = {
        ...run,
        completedStages: [...run.stages].filter(candidate => completed.has(candidate)),
        artifacts: [...artifacts],
      }
      emitProgress(stage, 1, 1)
      await writeDevSpaceRun(input.root, input.record.projectSlug, run)
    } catch (error) {
      if (input.signal.aborted) return settle('cancelled')
      input.audit?.({ event: 'run-stage-failed', runId: run.id, stage, code: stageErrorCode(error) })
      return settle('failed', { code: stageErrorCode(error), stage })
    }
  }

  return settle(partial ? 'partial' : 'succeeded')
}