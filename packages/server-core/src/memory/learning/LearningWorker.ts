/**
 * LearningWorker (PRD §33-34): drains the durable LearningQueue and drives the
 * LearningService background jobs (reflection, consolidation, skill curation,
 * policy learning, garbage collection, outcome evaluation).
 *
 * - One interval only (injectable timer fns) — never a growing timer chain.
 * - Exponential backoff with a cap; per-job try/catch so one failure never
 *   aborts a tick.
 * - Periodic jobs reuse a single deterministic row per type; `ensurePeriodic`
 *   moves a finished row to `notBefore = lastDone + cadence` instead of
 *   accumulating rows.
 */
import type { LearningServicePorts } from './learning-types'
import { learningJobId } from './LearningQueue'
import type { LearningJobRow, LearningJobType, LearningQueue, LearningQueueStatusCounts } from './LearningQueue'

export interface LearningWorkerLogger {
  info?(message: string, meta?: unknown): void
  warn?(message: string, meta?: unknown): void
  error?(message: string, meta?: unknown): void
}

export interface LearningWorkerCadences {
  consolidationMs?: number
  skillCurationMs?: number
  policyLearningMs?: number
  garbageCollectionMs?: number
  outcomeEvaluationMs?: number
}

export interface LearningWorkerDeps {
  queue: LearningQueue
  service: LearningServicePorts
  workspaceId: string
  clock?: () => number
  logger?: LearningWorkerLogger
  retryBaseMs?: number
  retryMaxMs?: number
  maxAttempts?: number
  cadences?: LearningWorkerCadences
  /** Injectable timers so tests never touch real ones. */
  setIntervalFn?: (fn: () => void, ms: number) => unknown
  clearIntervalFn?: (handle: unknown) => void
  /** Tick period for the single interval. */
  intervalMs?: number
}

const SIX_HOURS = 6 * 60 * 60 * 1000
const DAY = 24 * 60 * 60 * 1000
const WEEK = 7 * DAY

/** Periodic job type → cadence (ms). `session_reflection` is event-driven, not periodic. */
const PERIODIC_TYPES: ReadonlyArray<readonly [LearningJobType, keyof LearningWorkerCadences]> = [
  ['consolidation', 'consolidationMs'],
  ['skill_curation', 'skillCurationMs'],
  ['policy_learning', 'policyLearningMs'],
  ['garbage_collection', 'garbageCollectionMs'],
  ['outcome_evaluation', 'outcomeEvaluationMs'],
]

export class LearningWorker {
  private readonly queue: LearningQueue
  private readonly service: LearningServicePorts
  private readonly workspaceId: string
  private readonly clock: () => number
  private readonly logger: LearningWorkerLogger
  private readonly retryBaseMs: number
  private readonly retryMaxMs: number
  private readonly maxAttempts: number
  private readonly cadences: Required<LearningWorkerCadences>
  private readonly setIntervalFn: (fn: () => void, ms: number) => unknown
  private readonly clearIntervalFn: (handle: unknown) => void
  private readonly intervalMs: number
  private timer: unknown = null
  private inFlight: Promise<void> | null = null

  constructor(deps: LearningWorkerDeps) {
    this.queue = deps.queue
    this.service = deps.service
    this.workspaceId = deps.workspaceId
    this.clock = deps.clock ?? (() => Date.now())
    this.logger = deps.logger ?? {}
    this.retryBaseMs = deps.retryBaseMs ?? 60_000
    this.retryMaxMs = deps.retryMaxMs ?? 3_600_000
    this.maxAttempts = deps.maxAttempts ?? 5
    this.cadences = {
      consolidationMs: deps.cadences?.consolidationMs ?? SIX_HOURS,
      skillCurationMs: deps.cadences?.skillCurationMs ?? DAY,
      policyLearningMs: deps.cadences?.policyLearningMs ?? DAY,
      garbageCollectionMs: deps.cadences?.garbageCollectionMs ?? WEEK,
      outcomeEvaluationMs: deps.cadences?.outcomeEvaluationMs ?? SIX_HOURS,
    }
    this.setIntervalFn = deps.setIntervalFn ?? ((fn, ms) => setInterval(fn, ms))
    this.clearIntervalFn =
      deps.clearIntervalFn ?? ((handle) => clearInterval(handle as ReturnType<typeof setInterval>))
    this.intervalMs = deps.intervalMs ?? 60_000
  }

  /** Deterministic jobId of the enqueued job. */
  enqueue(type: LearningJobType, sourceId?: string): string {
    return this.queue.enqueue(type, sourceId ?? this.workspaceId, { at: this.clock() }).jobId
  }

  /**
   * Ensure every periodic type has exactly one row. Missing rows are enqueued
   * to run now; finished rows are moved to `lastDone + cadence`. No duplicates.
   */
  ensurePeriodic(now: number = this.clock()): void {
    for (const [type, cadenceKey] of PERIODIC_TYPES) {
      const jobId = learningJobId(type, this.workspaceId)
      const existing = this.queue.get(jobId)
      if (!existing) {
        this.queue.enqueue(type, this.workspaceId, { at: now, notBefore: now })
        continue
      }
      if (existing.status === 'done' || existing.status === 'failed') {
        this.queue.reschedule(jobId, existing.updatedAt + this.cadences[cadenceKey], undefined, {
          attempt: 0,
          at: now,
        })
      }
    }
  }

  /**
   * Process the jobs that are due now. Reentrant-safe: a second call joins the
   * in-flight run. Does not enqueue periodic work (use {@link ensurePeriodic}).
   */
  runDue(now?: number): Promise<void> {
    return this.process(now)
  }

  start(): void {
    if (this.timer !== null) return
    this.timer = this.setIntervalFn(() => {
      void this.tick()
    }, this.intervalMs)
  }

  stop(): void {
    if (this.timer === null) return
    this.clearIntervalFn(this.timer)
    this.timer = null
  }

  /** Resolves once the in-flight tick (if any) has finished. */
  whenIdle(): Promise<void> {
    return this.inFlight ?? Promise.resolve()
  }

  statusCounts(): LearningQueueStatusCounts {
    return this.queue.statusCounts()
  }

  /** One scheduled wake-up: top up the periodic rows, then drain due jobs. */
  private tick(now?: number): Promise<void> {
    const at = now ?? this.clock()
    return this.process(at, () => this.ensurePeriodic(at))
  }

  private process(now?: number, before?: () => void): Promise<void> {
    if (this.inFlight) return this.inFlight
    const at = now ?? this.clock()
    const run = this.runTick(at, before).finally(() => {
      if (this.inFlight === run) this.inFlight = null
    })
    this.inFlight = run
    return run
  }

  private async runTick(now: number, before?: () => void): Promise<void> {
    before?.()
    for (const row of this.queue.listDue(now)) {
      this.queue.markRunning(row.jobId, now)
      try {
        await this.dispatch(row)
        this.queue.markDone(row.jobId, now)
      } catch (err) {
        const attempt = row.attempt + 1
        const message = err instanceof Error ? err.message : String(err)
        if (attempt < this.maxAttempts) {
          const delay = Math.min(this.retryMaxMs, this.retryBaseMs * 2 ** attempt)
          this.queue.reschedule(row.jobId, now + delay, message, { attempt, at: now })
        } else {
          this.queue.markFailed(row.jobId, message, { attempt, at: now })
        }
        this.logger.error?.('learning worker job failed', { jobId: row.jobId, attempt, error: message })
      }
    }
  }

  private dispatch(row: LearningJobRow): Promise<unknown> {
    switch (row.type) {
      case 'session_reflection':
        return this.service.reflectSession(this.workspaceId, row.sourceId)
      case 'consolidation':
        return this.service.runConsolidation(this.workspaceId)
      case 'skill_curation':
        return this.service.runSkillCuration(this.workspaceId)
      case 'policy_learning':
        return this.service.runPolicyLearning(this.workspaceId)
      case 'garbage_collection':
        return this.service.runGarbageCollection(this.workspaceId)
      case 'outcome_evaluation':
        return this.service.evaluateOutcomes(this.workspaceId)
      default:
        return Promise.reject(new Error(`unknown job type: ${String(row.type)}`))
    }
  }
}