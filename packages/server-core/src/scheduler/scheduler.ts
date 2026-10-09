/**
 * Single host-timer scheduler.
 *
 * Clean-room re-expression of the OpenClaw `GatewayScheduler` contract
 * (port row f.8; upstream `src/infra/gateway-scheduler.ts`): one process-wide
 * timer owner instead of per-job `setTimeout`s, monotonic-anchored cadences,
 * coalesced missed ticks, and `beginClose()`/`stop()` shutdown semantics where
 * `stop()` is idempotent, no tick fires after close, and in-flight callbacks are
 * awaited.
 *
 * Differences from upstream that this port deliberately keeps simple:
 *   - The only seam is a `SchedulerClock` (wall `now`, `monotonicNow`, `arm`);
 *     tests inject a fake clock, production uses `setTimeout`.
 *   - Cadence jobs carry an explicit UTC `CronExpression` (see `cron-expr.ts`)
 *     rather than the upstream persistence-backed job store.
 *   - Every registration may name a hook event; the same tick that runs the job
 *     dispatches that named event through the owned `HookRegistry`, so both cron
 *     registrations and event hooks are driven by this one timer.
 */

import { HookRegistry, type HookDispatchResult } from './hooks.ts'
import { parseCronExpression, type CronExpression } from './cron-expr.ts'

export interface SchedulerClock {
  /** Wall-clock epoch milliseconds (drives due-time comparisons). */
  now: () => number
  /** Monotonic milliseconds (never rewinds on wall-clock corrections). */
  monotonicNow: () => number
  /** Arm a one-shot host timer; returns a cancel function. */
  arm: (run: () => void, delayMs: number) => () => void
}

export interface SchedulerLogger {
  error: (message: string, error?: unknown) => void
}

const hostClock: SchedulerClock = {
  now: () => Date.now(),
  monotonicNow: () => performance.now(),
  arm: (run, delayMs) => {
    const timer = setTimeout(run, delayMs)
    timer.unref?.()
    return () => clearTimeout(timer)
  },
}

/** Node clamps timer delays to this; never arm a timer outside it. */
const MAX_TIMER_DELAY_MS = 2_147_483_647

export type ScheduledKind = 'once' | 'every' | 'cron'

export interface JobRunContext {
  readonly id: string
  readonly kind: ScheduledKind
  /** Number of scheduled instants collapsed into this single run (0 when on time). */
  readonly missed: number
  /** The scheduled instant this run represents (UTC epoch ms, exact multiple of the cadence). */
  readonly scheduledAtMs: number
  readonly firedAtMs: number
}

export type JobRun = (context: JobRunContext) => void | Promise<void>

export interface ScheduledJob {
  readonly id: string
  readonly kind: ScheduledKind
  /** Stop future runs and do not wait for a run already in flight. */
  cancel: () => void
  /** Stop future runs and await any run already in flight. */
  stop: () => Promise<void>
}

interface Registration {
  readonly id: string
  readonly kind: ScheduledKind
  readonly run: JobRun
  readonly event?: string
  readonly everyMs?: number
  readonly expression?: CronExpression
  /** Scheduled instant of the most recent run (or the registration instant for the first). */
  anchorMs: number
  /** Next scheduled instant. */
  nextMs: number
  cancelled: boolean
  running?: Promise<void>
}

export interface ScheduleOnceParams {
  id: string
  run: JobRun
  event?: string
  atMs?: number
  delayMs?: number
}

export interface ScheduleEveryParams {
  id: string
  run: JobRun
  everyMs: number
  event?: string
  /** Anchor for the cadence; defaults to the current time. */
  startAtMs?: number
}

export interface RegisterCronParams {
  id: string
  run: JobRun
  expression: string
  event?: string
}

export class SchedulerError extends Error {
  readonly code: 'INVALID_SCHEDULE' | 'ALREADY_CLOSED'

  constructor(code: 'INVALID_SCHEDULE' | 'ALREADY_CLOSED', message: string) {
    super(message)
    this.name = 'SchedulerError'
    this.code = code
  }
}

export class HostScheduler {
  readonly hooks = new HookRegistry()

  private readonly clock: SchedulerClock
  private readonly logger?: SchedulerLogger
  private readonly jobs = new Map<string, Registration>()
  private readonly pending = new Set<Promise<void>>()
  private readonly controller = new AbortController()
  private cancelTimer?: () => void
  private timerGeneration = 0
  private dispatching = false
  private closed = false

  constructor(options: { clock?: SchedulerClock; logger?: SchedulerLogger } = {}) {
    this.clock = options.clock ?? hostClock
    this.logger = options.logger
  }

  get signal(): AbortSignal {
    return this.controller.signal
  }

  get isClosed(): boolean {
    return this.closed
  }

  now(): number {
    return this.clock.now()
  }

  /** Schedule a one-shot run at an absolute or relative time. */
  scheduleOnce(params: ScheduleOnceParams): ScheduledJob {
    const hasAt = params.atMs !== undefined
    const hasDelay = params.delayMs !== undefined
    if (hasAt === hasDelay) {
      throw new SchedulerError('INVALID_SCHEDULE', `${params.id}: provide exactly one of atMs or delayMs`)
    }
    const atMs = hasAt ? params.atMs! : this.clock.now() + params.delayMs!
    if (!Number.isFinite(atMs)) {
      throw new SchedulerError('INVALID_SCHEDULE', `${params.id}: invalid absolute time`)
    }
    return this.register({ id: params.id, kind: 'once', run: params.run, event: params.event, anchorMs: atMs, nextMs: atMs })
  }

  /** Schedule a fixed-period run anchored to `startAtMs` (default: now). Drift-free. */
  scheduleEvery(params: ScheduleEveryParams): ScheduledJob {
    if (!Number.isFinite(params.everyMs) || params.everyMs <= 0) {
      throw new SchedulerError('INVALID_SCHEDULE', `${params.id}: everyMs must be a positive finite number`)
    }
    const anchor = params.startAtMs ?? this.clock.now()
    if (!Number.isFinite(anchor)) {
      throw new SchedulerError('INVALID_SCHEDULE', `${params.id}: invalid startAtMs`)
    }
    return this.register({
      id: params.id,
      kind: 'every',
      run: params.run,
      event: params.event,
      everyMs: params.everyMs,
      anchorMs: anchor,
      nextMs: anchor + params.everyMs,
    })
  }

  /** Schedule a cron run; the expression is validated eagerly (throws `CronExpressionError`). */
  registerCron(params: RegisterCronParams): ScheduledJob {
    const expression = parseCronExpression(params.expression)
    const anchor = this.clock.now()
    return this.register({
      id: params.id,
      kind: 'cron',
      run: params.run,
      event: params.event,
      expression,
      anchorMs: anchor,
      nextMs: expression.nextAfter(anchor),
    })
  }

  /** Cancel a registration by id. Returns whether it existed. */
  cancel(id: string): boolean {
    const job = this.jobs.get(id)
    if (!job) return false
    job.cancelled = true
    this.jobs.delete(id)
    this.arm()
    return true
  }

  /**
   * Close admission: stop arming timers, cancel every registration and abort
   * `signal`. In-flight callbacks keep running and are joined by `stop()`.
   */
  beginClose(): void {
    if (this.closed) return
    this.closed = true
    this.controller.abort()
    this.timerGeneration += 1
    this.cancelTimer?.()
    this.cancelTimer = undefined
    for (const job of this.jobs.values()) job.cancelled = true
    this.jobs.clear()
  }

  /** Idempotent shutdown: `beginClose()` then await every in-flight callback. */
  async stop(): Promise<void> {
    this.beginClose()
    while (this.pending.size > 0) {
      await Promise.all([...this.pending])
    }
  }

  private register(job: {
    id: string
    kind: ScheduledKind
    run: JobRun
    event?: string
    everyMs?: number
    expression?: CronExpression
    anchorMs: number
    nextMs: number
  }): ScheduledJob {
    if (this.signal.aborted) {
      throw new SchedulerError('ALREADY_CLOSED', `${job.id}: scheduler is closed`)
    }
    const previous = this.jobs.get(job.id)
    if (previous) {
      previous.cancelled = true
      this.jobs.delete(job.id)
    }
    const registration: Registration = { ...job, cancelled: false }
    this.jobs.set(job.id, registration)
    this.arm()
    return {
      id: job.id,
      kind: job.kind,
      cancel: () => this.cancel(job.id),
      stop: async () => {
        this.cancel(job.id)
        await registration.running
      },
    }
  }

  private nextDueMs(): number | null {
    let next: number | null = null
    for (const job of this.jobs.values()) {
      if (job.cancelled || job.running) continue
      next = next === null ? job.nextMs : Math.min(next, job.nextMs)
    }
    return next
  }

  private arm(): void {
    if (this.closed || this.signal.aborted || this.dispatching) return
    this.cancelTimer?.()
    this.cancelTimer = undefined
    const next = this.nextDueMs()
    if (next === null) return
    const generation = ++this.timerGeneration
    const delayMs = Math.min(MAX_TIMER_DELAY_MS, Math.max(0, Math.ceil(next - this.clock.now())))
    this.cancelTimer = this.clock.arm(() => {
      if (generation !== this.timerGeneration) return
      void this.wake()
    }, delayMs)
  }

  private advance(job: Registration, nowMs: number): { missed: number; nextMs: number } {
    if (job.kind === 'once') {
      return { missed: 0, nextMs: job.nextMs }
    }
    if (job.kind === 'every') {
      const period = job.everyMs!
      const elapsed = Math.floor((nowMs - job.anchorMs) / period)
      // `nextMs = anchor + period <= now` guarantees elapsed >= 1.
      const safeElapsed = Math.max(1, elapsed)
      return { missed: safeElapsed - 1, nextMs: job.anchorMs + safeElapsed * period }
    }
    let instant = job.nextMs
    let missed = 0
    let following = job.expression!.nextAfter(instant)
    while (following <= nowMs) {
      instant = following
      missed += 1
      following = job.expression!.nextAfter(instant)
    }
    return { missed, nextMs: instant }
  }

  private wake(): Promise<void> | void {
    this.cancelTimer = undefined
    if (this.closed || this.signal.aborted) return
    const nowMs = this.clock.now()
    const due: Registration[] = []
    for (const job of this.jobs.values()) {
      if (!job.cancelled && !job.running && job.nextMs <= nowMs) due.push(job)
    }
    due.sort((a, b) => a.nextMs - b.nextMs)

    const started: Promise<void>[] = []
    this.dispatching = true
    try {
      for (const job of due) {
        if (this.closed || job.cancelled || this.jobs.get(job.id) !== job) continue
        const { missed, nextMs } = this.advance(job, nowMs)
        if (job.kind === 'once') {
          job.cancelled = true
          this.jobs.delete(job.id)
        } else {
          job.anchorMs = nextMs
          job.nextMs = job.kind === 'every' ? nextMs + job.everyMs! : job.expression!.nextAfter(nextMs)
        }
        started.push(this.run(job, missed, nextMs))
      }
    } finally {
      this.dispatching = false
      this.arm()
    }
    if (started.length > 0) return Promise.all(started).then(() => undefined)
  }

  private run(job: Registration, missed: number, scheduledAtMs: number): Promise<void> {
    const context: JobRunContext = {
      id: job.id,
      kind: job.kind,
      missed,
      scheduledAtMs,
      firedAtMs: this.clock.now(),
    }
    const execute = async (): Promise<void> => {
      if (job.event) {
        const result: HookDispatchResult = await this.hooks.emit(job.event, context)
        for (const failure of result.failures) {
          this.logger?.error(`scheduler hook "${job.event}" listener ${failure.index} failed`, failure.error)
        }
      }
      try {
        await job.run(context)
      } catch (error) {
        this.logger?.error(`scheduler job "${job.id}" failed`, error)
      }
    }
    const promise = execute().finally(() => {
      job.running = undefined
      this.pending.delete(promise)
      this.arm()
    })
    job.running = promise
    this.pending.add(promise)
    return promise
  }
}