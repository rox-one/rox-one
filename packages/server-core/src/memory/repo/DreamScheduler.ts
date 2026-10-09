/**
 * DreamScheduler — the process-wide owner of the memory dream schedule (spec §9).
 *
 * Why one scheduler for the whole process: `MemoryService` is created lazily
 * per workspace root, so a per-service timer would both multiply by workspace
 * and never fire for the global `main` bank. Instead the host starts a single
 * scheduler next to the RPC registration. It ticks every 60 s (`tickMs`
 * injectable for tests), enumerates the dream banks through
 * `repo.dreamBankIds()`, and starts a run for any bank whose interval window
 * has elapsed.
 *
 * Guarantees:
 *  - at most one run per bank per interval window (`lastRunAt` ledger);
 *  - runs are strictly sequential — a single global promise chain (mutex), so
 *    two banks never overlap and a manual `runNow` queues behind an interval run;
 *  - `runNow` ignores the interval window and works while stopped;
 *  - `status` folds in the runner's cost ledger and the scanner's pending notes.
 *
 * The scheduler is fail-soft: a runner or repo error is logged, never thrown.
 */
import type { MemoryDreamEvent, MemoryDreamRun, MemoryDreamStatus } from '@rox/shared/memory/repo'
import type { MemoryRepoService } from './MemoryRepoService'
import type { DreamRunner, DreamRunOptions } from './DreamRunner'

export interface DreamSchedulerConfig {
  dreamIntervalHours: number
  dreamModel?: string
  dreamNotes: boolean
}

export interface DreamSchedulerDeps {
  runner: DreamRunner
  repo: MemoryRepoService
  log: (e: MemoryDreamEvent) => Promise<void>
  config: () => DreamSchedulerConfig
  /** Tick period, default 60_000 ms. */
  tickMs?: number
  now?: () => Date
  /**
   * Bootstrap journal accessor: a bank's dream-journal events in append
   * (chronological) order. `hydrate()` replays them to restore window state
   * across a restart. Absent → hydration is a no-op (the in-memory ledger
   * stands, as it did before this seam existed).
   */
  readJournal?: (bankId: string) => Promise<MemoryDreamEvent[]>
}

const DEFAULT_TICK_MS = 60_000
const HOUR_MS = 3_600_000

function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6
}

export type DreamEventlistener = (e: MemoryDreamEvent) => void

/** Called with a finished run right after `lastRun`/`lastRunAt` are recorded. */
export type DreamRunFinishedListener = (run: MemoryDreamRun) => void

export class DreamScheduler {
  private readonly deps: DreamSchedulerDeps
  private readonly now: () => Date
  private readonly tickMs: number
  private readonly listeners = new Set<DreamEventlistener>()
  private readonly runFinishedListeners = new Set<DreamRunFinishedListener>()
  private readonly lastRunAt = new Map<string, number>()
  private readonly lastRun = new Map<string, MemoryDreamRun>()
  private readonly running = new Set<string>()
  private timer: ReturnType<typeof setInterval> | null = null
  private chain: Promise<unknown> = Promise.resolve()
  private ticking = false
  private unsubscribeRunner: (() => void) | null = null
  private hydration: Promise<void> | null = null

  constructor(deps: DreamSchedulerDeps) {
    this.deps = deps
    this.now = deps.now ?? (() => new Date())
    this.tickMs = deps.tickMs && deps.tickMs > 0 ? deps.tickMs : DEFAULT_TICK_MS
  }

  /** Begin ticking. Idempotent; safe to call twice. */
  start(): void {
    if (this.timer) return
    if (!this.unsubscribeRunner) {
      this.unsubscribeRunner = this.deps.runner.onEvent((event) => this.forward(event))
    }
    this.timer = setInterval(() => {
      void this.tick()
    }, this.tickMs)
    // Do not keep the event loop alive on the interval alone (mirrors
    // MemoryRepoService.notifyMutation); `stop()` still clears it.
    if (typeof this.timer.unref === 'function') this.timer.unref()
  }

  /** Stop ticking and detach from the runner. A run in flight is not cancelled. */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    if (this.unsubscribeRunner) {
      this.unsubscribeRunner()
      this.unsubscribeRunner = null
    }
  }

  /**
   * Restore `lastRunAt`/`lastRun` (and today's cost) from the durable dream
   * journal, so a process restart does not re-run every bank on the first tick
   * and `status()` stops claiming the bank "never dreamed".
   *
   * `lastRunAt` comes from the bank's last `start` event (a bank that ran before
   * the restart is therefore not eligible again inside the window); `lastRun` is
   * rebuilt from the bank's last completed run (`end` event + that dream's other
   * events); today's `cost` events replay into the runner's tracker.
   *
   * Best-effort by construction: an absent reader, a failing `dreamBankIds()`, or
   * an unreadable/corrupt journal is swallowed and leaves the maps untouched.
   * Awaitable — `status()` and `tickOnce()` await the in-flight hydration, so no
   * caller (or first tick) ever observes pre-hydration state.
   */
  hydrate(): Promise<void> {
    if (!this.hydration) this.hydration = this.runHydration().catch(() => undefined)
    return this.hydration
  }

  private async runHydration(): Promise<void> {
    const readJournal = this.deps.readJournal
    if (!readJournal) return
    let banks: string[]
    try {
      banks = await this.deps.repo.dreamBankIds()
    } catch {
      return
    }
    for (const bankId of banks) {
      let events: MemoryDreamEvent[]
      try {
        events = await readJournal(bankId)
      } catch {
        continue
      }
      this.applyJournal(bankId, events)
    }
  }

  /** Fold one bank's journal events into the ledger (events are chronological). */
  private applyJournal(bankId: string, events: MemoryDreamEvent[]): void {
    const day = this.now().toISOString().slice(0, 10)
    let lastStartTs: string | null = null
    let lastEnd: MemoryDreamEvent | null = null
    for (const event of events) {
      // All `main*` banks share one journal file, so filter on the event's bankId.
      if (!event || event.bankId !== bankId) continue
      if (event.kind === 'start') {
        lastStartTs = event.ts
      } else if (event.kind === 'end') {
        lastEnd = event
      } else if (
        event.kind === 'cost' &&
        typeof event.costUsd === 'number' &&
        Number.isFinite(event.costUsd) &&
        event.ts.slice(0, 10) === day
      ) {
        // `MemoryDreamEvent` carries no explicit `estimated` flag; the runner
        // appends ' (estimate)' to an approximated call's message, the only
        // carrier the frozen schema offers.
        this.deps.runner.cost.record(bankId, event.costUsd, event.ts, event.message.includes('(estimate)'))
      }
    }
    if (lastStartTs) {
      const startedAt = Date.parse(lastStartTs)
      if (Number.isFinite(startedAt)) this.lastRunAt.set(bankId, startedAt)
    }
    if (lastEnd) this.lastRun.set(bankId, this.reconstructRun(bankId, lastEnd, events))
  }

  /** Rebuild a finished run from the journal events of its last completed dream. */
  private reconstructRun(bankId: string, end: MemoryDreamEvent, events: MemoryDreamEvent[]): MemoryDreamRun {
    let startedAt = end.ts
    let model: string | undefined
    let costUsd = 0
    let costIsEstimate = false
    const errors: string[] = []
    for (const event of events) {
      if (!event || event.bankId !== bankId || event.dreamId !== end.dreamId) continue
      if (event.kind === 'start') {
        startedAt = event.ts
        if (event.model) model = event.model
      } else if (event.kind === 'cost') {
        if (typeof event.costUsd === 'number' && Number.isFinite(event.costUsd)) costUsd += event.costUsd
        if (event.message.includes('(estimate)')) costIsEstimate = true
      } else if (event.kind === 'error') {
        errors.push(event.message)
      }
    }
    // The `end` event message is `dream <status>` — the journal's only carrier
    // of the terminal status; a mid-run error event forces `error` regardless.
    const tail = end.message.trim().split(/\s+/).pop()
    const status: MemoryDreamRun['status'] = errors.length > 0 ? 'error' : tail === 'error' || tail === 'skipped' ? tail : 'ok'
    const run: MemoryDreamRun = {
      dreamId: end.dreamId,
      bankId,
      startedAt,
      endedAt: end.ts,
      status,
      costUsd: round6(costUsd),
      costIsEstimate,
    }
    if (model) run.model = model
    if (errors.length > 0) run.error = errors.join('; ')
    return run
  }

  /** Subscribe to every dream event. Returns the unsubscribe function. */
  onEvent(listener: DreamEventlistener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /**
   * Subscribe to finished runs. Fires synchronously (before `runBank` resolves)
   * right after the run is recorded in `lastRun`/`lastRunAt`, so a listener can
   * push the finished run without racing the runner's trailing `end` event or
   * its journal I/O. Returns the unsubscribe function.
   */
  onRunFinished(listener: DreamRunFinishedListener): () => void {
    this.runFinishedListeners.add(listener)
    return () => {
      this.runFinishedListeners.delete(listener)
    }
  }

  private notifyRunFinished(run: MemoryDreamRun): void {
    for (const listener of this.runFinishedListeners) {
      try {
        listener(run)
      } catch {
        // A broken listener never breaks the scheduler.
      }
    }
  }

  private forward(event: MemoryDreamEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event)
      } catch {
        // A broken listener never breaks the scheduler.
      }
    }
  }

  /** Serialize `fn` behind every previously enqueued run (global mutex). */
  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.chain.then(fn, fn)
    this.chain = next.then(
      () => undefined,
      () => undefined,
    )
    return next
  }

  private async logEvent(event: MemoryDreamEvent): Promise<void> {
    this.forward(event)
    try {
      await this.deps.log(event)
    } catch {
      // Journaling is best-effort.
    }
  }

  private async runBank(bankId: string, reason: string, opts?: DreamRunOptions): Promise<MemoryDreamRun> {
    this.running.add(bankId)
    this.lastRunAt.set(bankId, this.now().getTime())
    try {
      const run = await this.deps.runner.run(bankId, reason, opts)
      this.lastRun.set(bankId, run)
      // Both paths (interval `tickOnce`, manual `runNow`) funnel through here;
      // notify while still inside the run so `lastRun` and the notification
      // never disagree.
      this.notifyRunFinished(run)
      return run
    } finally {
      this.running.delete(bankId)
    }
  }

  /** Run now, bypassing the interval window. Works while stopped. */
  runNow(bankId: string, opts?: DreamRunOptions): Promise<MemoryDreamRun> {
    return this.enqueue(() => this.runBank(bankId, 'manual', opts))
  }

  /** One tick: run every bank whose interval window has elapsed, sequentially. */
  private tick(): void {
    this.tickOnce().catch(() => undefined)
  }

  /**
   * Await one full tick (additive over the frozen contract; the interval timer
   * calls it, tests drive it directly). Serialized behind the global mutex, so
   * it never overlaps an in-flight run.
   */
  async tickOnce(): Promise<void> {
    if (this.ticking) return
    this.ticking = true
    try {
      if (this.hydration) await this.hydration
      await this.enqueue(async () => {
        let banks: string[]
        try {
          banks = await this.deps.repo.dreamBankIds()
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          await this.logEvent({
            ts: this.now().toISOString(),
            dreamId: 'scheduler',
            bankId: 'main',
            kind: 'error',
            message: `dreamBankIds failed: ${message}`,
          })
          return
        }
        const nowMs = this.now().getTime()
        const intervalMs = Math.max(1, this.deps.config().dreamIntervalHours) * HOUR_MS
        for (const bankId of banks) {
          const last = this.lastRunAt.get(bankId)
          if (last !== undefined && nowMs - last < intervalMs) continue
          try {
            await this.runBank(bankId, 'interval')
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            await this.logEvent({
              ts: this.now().toISOString(),
              dreamId: 'scheduler',
              bankId,
              kind: 'error',
              message: `dream run failed: ${message}`,
            })
          }
        }
      })
    } finally {
      this.ticking = false
    }
  }

  private async pendingNoteIds(bankId: string): Promise<string[]> {
    try {
      const pending = await this.deps.runner.pendingNotes(bankId)
      return pending.map((note) => note.id)
    } catch {
      return []
    }
  }

  async status(bankId: string): Promise<MemoryDreamStatus> {
    if (this.hydration) await this.hydration
    const config = this.deps.config()
    const intervalHours = config.dreamIntervalHours
    const last = this.lastRun.get(bankId) ?? null
    const lastAt = this.lastRunAt.get(bankId)
    const summary = this.deps.runner.cost.todaySummary(bankId, this.now())
    return {
      bankId,
      running: this.running.has(bankId),
      lastRun: last,
      nextRunAt: lastAt === undefined ? null : new Date(lastAt + intervalHours * HOUR_MS).toISOString(),
      intervalHours,
      ...(config.dreamModel ? { model: config.dreamModel } : {}),
      costTodayUsd: round6(summary.usd),
      costIsEstimate: summary.estimated,
      pendingNoteIds: await this.pendingNoteIds(bankId),
    }
  }
}