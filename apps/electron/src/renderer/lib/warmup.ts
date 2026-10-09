/**
 * PERF-10 (#1577) — idle warm-up queue.
 *
 * After the shell is interactive the app warms what the user is most likely to
 * open next: session meta and the transcript tails of the most recent
 * sessions, then notes/tasks, catalogs, inbox/feed, the calendar and finally
 * every rail surface's route chunk. The scheduler runs it in strict priority
 * order during idle time, in short slices, stops the moment the user does
 * anything, and gives up when it has spent its CPU budget.
 *
 * Everything here is injectable (`requestIdle`, `now`, `inputTarget`), so the
 * unit tests and the CI bench drive the same scheduler the shell runs with a
 * virtual clock and no real timers.
 */
/** Longest synchronous slice: no idle callback may block the main thread longer. */
export const WARMUP_SLICE_MS = 4
/** Steps kept on battery/low memory (owner decision D2: "top 3 only"). */
export const WARMUP_LOW_POWER_STEPS = 3
/** Total idle CPU the warm-up may spend. */
export const WARMUP_CPU_BUDGET_MS = 1500
/** Transcript tails warmed for the most recent sessions. */
export const WARMUP_TRANSCRIPT_TAILS = 3
/** Calendar horizon: the current and the next week. */
export const WARMUP_CALENDAR_WEEKS_AHEAD = 1

export type WarmupStepId =
  | 'sessions-meta'
  | 'transcript-tails'
  | 'notes-tasks'
  | 'skills-sources'
  | 'agent-profiles'
  | 'inbox-feed'
  | 'calendar'
  | 'route-chunks'

export type WarmupCancelReason = 'input' | 'explicit' | 'budget' | 'hidden'

export interface WarmupStep {
  id: WarmupStepId
  run(): void | Promise<void>
}

export interface IdleDeadlineLike {
  didTimeout: boolean
  timeRemaining(): number
}

export interface WarmupSchedulerOptions {
  /** Longest slice; the queue yields when the slice is spent. */
  sliceMs?: number
  /** Total synchronous CPU the queue may spend before it gives up. */
  budgetMs?: number
  requestIdle?: (callback: (deadline: IdleDeadlineLike) => void) => number
  cancelIdle?: (handle: number) => void
  now?: () => number
  /** Anything here cancels the remaining queue (defaults to `window`). */
  inputTarget?: InputTargetLike | null
}

export interface InputTargetLike {
  addEventListener(type: string, listener: () => void, options?: AddEventListenerOptions): void
  removeEventListener(type: string, listener: () => void, options?: AddEventListenerOptions): void
}

export interface WarmupStatus {
  completed: WarmupStepId[]
  failed: WarmupStepId[]
  pending: WarmupStepId[]
  cancelledBy: WarmupCancelReason | null
  spentMs: number
  /** Longest idle callback this queue produced (the acceptance bound is 50 ms). */
  longestSliceMs: number
  running: boolean
}

const INPUT_EVENTS = ['pointerdown', 'keydown', 'wheel'] as const

interface ResolvedWarmup {
  resolve: (status: WarmupStatus) => void
}

/**
 * Runs `steps` in order during idle time. A step's promise is awaited before
 * the next one starts (priority order is the point of the queue), but the idle
 * callback itself never waits on it: the next slice is scheduled when the
 * promise settles.
 */
export class WarmupScheduler {
  private readonly sliceMs: number
  private readonly budgetMs: number
  private readonly requestIdle: (callback: (deadline: IdleDeadlineLike) => void) => number
  private readonly cancelIdle: (handle: number) => void
  private readonly now: () => number
  private readonly inputTarget: InputTargetLike | null
  private readonly completed: WarmupStepId[] = []
  private readonly failed: WarmupStepId[] = []
  private index = 0
  private spentMs = 0
  private longestSlice = 0
  private sliceStartedAt: number | null = null
  private handle: number | null = null
  private cancelledBy: WarmupCancelReason | null = null
  private listenersAttached = false
  private readonly waiters: ResolvedWarmup[] = []

  constructor(private readonly steps: readonly WarmupStep[], options: WarmupSchedulerOptions = {}) {
    this.sliceMs = options.sliceMs ?? WARMUP_SLICE_MS
    this.budgetMs = options.budgetMs ?? WARMUP_CPU_BUDGET_MS
    this.requestIdle = options.requestIdle ?? defaultRequestIdle
    this.cancelIdle = options.cancelIdle ?? defaultCancelIdle
    this.now = options.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()))
    this.inputTarget = options.inputTarget === undefined ? defaultInputTarget() : options.inputTarget
  }

  start(): void {
    if (this.handle !== null || this.cancelledBy !== null || this.index >= this.steps.length) return
    this.attachInput()
    this.handle = this.requestIdle(() => {
      this.handle = null
      this.sliceStartedAt = this.now()
      this.step()
    })
  }

  /** Stop the queue; already-completed steps stay completed. */
  cancel(reason: WarmupCancelReason = 'explicit'): void {
    if (this.cancelledBy !== null) return
    this.cancelledBy = reason
    if (this.handle !== null) {
      this.cancelIdle(this.handle)
      this.handle = null
    }
    this.detachInput()
    this.settle()
  }

  status(): WarmupStatus {
    return {
      completed: [...this.completed],
      failed: [...this.failed],
      pending: this.steps.slice(this.index).map(step => step.id),
      cancelledBy: this.cancelledBy,
      spentMs: this.spentMs,
      longestSliceMs: this.longestSlice,
      running: this.cancelledBy === null && this.index < this.steps.length,
    }
  }

  /** Resolves once the queue finished, failed out or was cancelled. */
  whenFinished(): Promise<WarmupStatus> {
    if (this.cancelledBy !== null || this.index >= this.steps.length) return Promise.resolve(this.status())
    return new Promise(resolve => { this.waiters.push({ resolve }) })
  }

  private step(): void {
    if (this.cancelledBy !== null) return
    const step = this.steps[this.index]
    if (!step) {
      this.detachInput()
      this.settle()
      return
    }
    const sliceStart = this.now()
    this.index += 1
    let pending: void | Promise<void>
    try {
      pending = step.run()
    } catch {
      this.failed.push(step.id)
      pending = undefined
    }
    this.spentMs += Math.max(0, this.now() - sliceStart)
    if (this.sliceStartedAt !== null) {
      this.longestSlice = Math.max(this.longestSlice, this.now() - this.sliceStartedAt)
    }
    const finish = (yieldNow: boolean) => {
      if (this.cancelledBy !== null) {
        this.settle()
        return
      }
      if (this.spentMs >= this.budgetMs) {
        this.cancel('budget')
        return
      }
      // Keep going inside this slice only for cheap synchronous steps; an
      // awaited read yields to a fresh idle callback so the main thread is free.
      // The slice is bounded from the start of the *callback*, not the step:
      // many small steps must not add up into one long task.
      const sliceSpent = this.sliceStartedAt === null ? this.now() - sliceStart : this.now() - this.sliceStartedAt
      if (yieldNow || sliceSpent >= this.sliceMs || this.now() - sliceStart >= this.sliceMs) {
        this.start()
        return
      }
      this.step()
    }
    if (pending instanceof Promise) {
      pending
        .then(() => { this.completed.push(step.id) }, () => { this.failed.push(step.id) })
        .then(() => finish(true))
      return
    }
    this.completed.push(step.id)
    finish(false)
  }

  private attachInput(): void {
    if (this.listenersAttached || !this.inputTarget) return
    for (const type of INPUT_EVENTS) {
      this.inputTarget.addEventListener(type, this.onInput, { passive: true, capture: true })
    }
    this.listenersAttached = true
  }

  private detachInput(): void {
    if (!this.listenersAttached || !this.inputTarget) return
    for (const type of INPUT_EVENTS) {
      this.inputTarget.removeEventListener(type, this.onInput, { passive: true, capture: true })
    }
    this.listenersAttached = false
  }

  private readonly onInput = (): void => { this.cancel('input') }

  private settle(): void {
    const status = this.status()
    for (const waiter of this.waiters.splice(0)) waiter.resolve(status)
  }
}

function defaultInputTarget(): InputTargetLike | null {
  return typeof window === 'undefined' ? null : window
}

function defaultRequestIdle(callback: (deadline: IdleDeadlineLike) => void): number {
  if (typeof requestIdleCallback === 'function') return requestIdleCallback(callback)
  return setTimeout(() => callback({ didTimeout: false, timeRemaining: () => WARMUP_SLICE_MS }), 0) as unknown as number
}

function defaultCancelIdle(handle: number): void {
  if (typeof cancelIdleCallback === 'function') {
    cancelIdleCallback(handle)
    return
  }
  clearTimeout(handle as unknown as ReturnType<typeof setTimeout>)
}

export interface WarmupStepBudget {
  lowMemory: boolean
  onBattery: boolean
}

/** Battery or low memory keeps only the first three steps (owner decision D2). */
export function warmupStepBudget({ lowMemory, onBattery }: WarmupStepBudget, total: number): number {
  return lowMemory || onBattery ? Math.min(WARMUP_LOW_POWER_STEPS, total) : total
}

export interface WarmupDeps {
  warmSessionMeta(): void | Promise<void>
  /** Most recently used sessions, newest first. */
  recentSessionIds(limit: number): readonly string[]
  warmTranscriptTail(sessionId: string): void | Promise<void>
  warmNotesAndTasks(): void | Promise<void>
  warmSkillsAndSources(): void | Promise<void>
  warmAgentProfiles(): void | Promise<void>
  warmInboxAndFeed(): void | Promise<void>
  warmCalendar(weeksAhead: number): void | Promise<void>
  warmRouteChunks(names: readonly string[]): void | Promise<void>
  routeChunkNames: readonly string[]
}

/** The warm-up order from the PERF-10 plan; every step is a read that lands in the shared cache. */
export function buildWarmupSteps(deps: WarmupDeps): WarmupStep[] {
  return [
    { id: 'sessions-meta', run: () => deps.warmSessionMeta() },
    {
      id: 'transcript-tails',
      run: async () => {
        await Promise.all(deps.recentSessionIds(WARMUP_TRANSCRIPT_TAILS).map(id => deps.warmTranscriptTail(id)))
      },
    },
    { id: 'notes-tasks', run: () => deps.warmNotesAndTasks() },
    { id: 'skills-sources', run: () => deps.warmSkillsAndSources() },
    { id: 'agent-profiles', run: () => deps.warmAgentProfiles() },
    { id: 'inbox-feed', run: () => deps.warmInboxAndFeed() },
    { id: 'calendar', run: () => deps.warmCalendar(WARMUP_CALENDAR_WEEKS_AHEAD) },
    { id: 'route-chunks', run: () => deps.warmRouteChunks(deps.routeChunkNames) },
  ]
}

/** `navigator.getBattery()` when available; a machine without it counts as plugged in. */
export async function probeOnBattery(): Promise<boolean> {
  if (typeof navigator === 'undefined') return false
  const withBattery = navigator as Navigator & { getBattery?: () => Promise<{ charging: boolean }> }
  if (typeof withBattery.getBattery !== 'function') return false
  try {
    const battery = await withBattery.getBattery()
    return battery.charging === false
  } catch {
    return false
  }
}

/** `navigator.deviceMemory` (Chromium) at or below 4 GB counts as low memory. */
export function detectLowMemory(deviceMemoryGb?: number): boolean {
  const memory = deviceMemoryGb
    ?? (typeof navigator !== 'undefined'
      ? (navigator as Navigator & { deviceMemory?: number }).deviceMemory
      : undefined)
  return typeof memory === 'number' && Number.isFinite(memory) && memory <= 4
}