/**
 * Queue steering policy — per-session lane + global lane (port of OpenClaw's
 * `steer | followup | collect | interrupt` queue modes).
 *
 * Provenance: port-analysis/areas/f-substrate-gateway.md §"Sessions, routing,
 * queues/steering" (row f.4) and the upstream OpenClaw reference
 * `docs/concepts/queue-steering.md` + `src/agents/embedded-agent-runner/
 * run-orchestrator.ts:106` (per-session `enqueueSession` + `enqueueGlobal`
 * lane binding). Clean-room re-expression: ROX already serializes turns through
 * the `ManagedSession.isProcessing` flag and a plain FIFO `messageQueue`; this
 * module extracts that serialization into an explicit policy object so the
 * queue verbs become first-class, testable semantics and a second (global) lane
 * can serialize cross-session work without touching session lanes.
 *
 * ---------------------------------------------------------------------------
 * EXACT SEMANTICS (what coalesces, what is dropped, what is ordered)
 * ---------------------------------------------------------------------------
 *
 * Lanes
 * - `session:<id>` — every task submitted for a session runs on that session's
 *   lane. At most ONE task runs per lane at a time (one active writer per
 *   session); pending tasks run strictly in submission order (FIFO).
 * - `global` — a single process-wide lane. At most ONE global task runs at a
 *   time. The global lane is independent of every session lane, so a long
 *   session task never blocks global work and vice versa.
 *
 * Verdicts
 * - `enqueued`  — the task was appended to the lane's pending FIFO and will run
 *                 after any already-pending tasks. Submission order is preserved.
 * - `coalesced` — the task's text was merged into an existing pending task
 *                 (`targetId`); no new run is created. Coalescing is in-place:
 *                 the merged task keeps the earliest submission position.
 * - `steered`   — a run is active on the lane and the message was delivered into
 *                 that run (`targetId` = the active task). The run drains these
 *                 via `SteeringRunContext.drainSteered()`. Nothing is queued.
 * - `preempted` — an `interrupt` preempted the lane: the active run (if any) was
 *                 aborted, every pending task was DROPPED (their ids are
 *                 reported in `dropped`, in submission order), and the interrupt
 *                 task itself was placed at the FRONT of the lane so it runs
 *                 next, immediately after the aborted run settles.
 *
 * Verb rules
 * - `steer`     — if the lane is busy, deliver into the active run (`steered`).
 *                 Otherwise coalesce into the trailing pending `steer` task if
 *                 one exists (append text, `coalesced`), else `enqueued`.
 * - `followup`  — never steers and never coalesces: always a new FIFO entry.
 * - `collect`   — never steers. Coalesces into the trailing pending `collect`
 *                 task if it is the newest pending entry (`coalesced`), else
 *                 `enqueued`. A trailing task of any other verb breaks the group.
 * - `interrupt` — aborts the active run and drops all pending tasks (reported),
 *                 then runs next.
 *
 * Ordering guarantees
 * - FIFO within a lane; interrupt is the only operation that reorders (it jumps
 *   the queue and discards everything behind it).
 * - A `steer` never reorders running work: it neither aborts nor requeues; it
 *   only reaches the active run.
 * - Dropped tasks never run and never resolve their submitters.
 */

import { randomUUID } from 'node:crypto'
import type { SteeringVerb } from '@rox/shared/protocol'

export type { SteeringVerb }

/** A unit of queued work on a lane. */
export interface SteeringTask {
  /** Stable id, generated when omitted from `submit`. */
  id: string
  verb: SteeringVerb
  /** Lane key this task runs on (`session:<id>` or `global`). */
  lane: string
  /** Message text — appended to a coalesced task, drained when steered. */
  text: string
}

/** Handle handed to the runner for one active task. */
export interface SteeringRunContext {
  /** Aborted when an `interrupt` preempts this run. */
  readonly signal: AbortSignal
  /** Drains messages steered into this run since the previous call. */
  drainSteered(): SteeringTask[]
  /** Resolves when an `interrupt` targets this run. */
  readonly preempted: Promise<void>
}

export type SteeringTaskRunner = (task: SteeringTask, ctx: SteeringRunContext) => Promise<void>

export type SteeringDisposition = 'enqueued' | 'coalesced' | 'steered' | 'preempted'

/** Minimal shape the policy kernel needs from a pending entry. */
export interface SteeringPendingEntry {
  id: string
  verb: SteeringVerb
}

/** Result of classifying one submission against a lane's pending list. */
export interface SteeringPlan {
  disposition: SteeringDisposition
  /** Index in the pending list the message merges into (only for `coalesced`). */
  coalesceIndex?: number
  /** Id of the active task the message steers into (only for `steered`). */
  steerTargetId?: string
  /** Pending ids an interrupt drops, in submission order (only for `preempted`). */
  droppedIds: string[]
}

/**
 * The steering policy kernel — the single source of truth for verb semantics,
 * shared by {@link QueueSteering} (lane executor) and `SessionManager`'s durable
 * `messageQueue` (so the runtime queue and the in-memory lane can never drift on
 * what coalesces, what is steered and what an interrupt drops).
 *
 * `activeTaskId` is the id of the task currently running on the lane (undefined
 * when idle). `pending` is ordered oldest → newest.
 */
export function planSteeringSubmit(
  pending: readonly SteeringPendingEntry[],
  activeTaskId: string | undefined,
  verb: SteeringVerb,
): SteeringPlan {
  if (verb === 'interrupt') {
    return { disposition: 'preempted', droppedIds: pending.map((entry) => entry.id) }
  }

  if (verb === 'steer' && activeTaskId !== undefined) {
    return { disposition: 'steered', steerTargetId: activeTaskId, droppedIds: [] }
  }

  // `steer` (delivery unavailable) coalesces into the trailing pending steer;
  // `collect` coalesces into the trailing pending collect. Any other trailing
  // verb breaks the coalescing group.
  const coalesceVerb: SteeringVerb | null = verb === 'steer' ? 'steer' : verb === 'collect' ? 'collect' : null
  if (coalesceVerb) {
    const tailIndex = pending.length - 1
    const tail = pending[tailIndex]
    if (tail && tail.verb === coalesceVerb) {
      return { disposition: 'coalesced', coalesceIndex: tailIndex, droppedIds: [] }
    }
  }

  return { disposition: 'enqueued', droppedIds: [] }
}

export interface SteeringSubmitResult {
  taskId: string
  lane: string
  disposition: SteeringDisposition
  /** The pending task a message merged into, or the active task it steered. */
  targetId?: string
  /** Pending task ids cancelled by an interrupt, in submission order. */
  dropped: string[]
  /** The active task id aborted by an interrupt, when one was running. */
  abortedActiveId?: string
}

interface PendingTask extends SteeringTask {
  seq: number
}

interface ActiveRun {
  task: PendingTask
  controller: AbortController
  steered: SteeringTask[]
  preempt: Promise<void>
  resolvePreempt: () => void
}

interface LaneState {
  key: string
  pending: PendingTask[]
  active: ActiveRun | null
  seq: number
  draining: boolean
  idleWaiters: Array<() => void>
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((r) => { resolve = r })
  return { promise, resolve }
}

/**
 * Deterministic queue-steering policy. Construct with a runner that performs one
 * task; the queue owns serialization, coalescing, steering and preemption.
 */
export class QueueSteering {
  private readonly lanes = new Map<string, LaneState>()
  private globalTail: Promise<unknown> = Promise.resolve()

  constructor(private readonly runner: SteeringTaskRunner) {}

  /** Lane key for a session id. */
  static laneKey(sessionId: string): string {
    return `session:${sessionId}`
  }

  /** Submit work for a session lane. */
  submitSession(sessionId: string, verb: SteeringVerb, text: string, id?: string): SteeringSubmitResult {
    return this.submit(QueueSteering.laneKey(sessionId), verb, text, id)
  }

  /**
   * The global lane: run `fn` exclusively, FIFO across every caller. Used for
   * cross-session work that must not overlap (e.g. mutating the shared session
   * index). Independent of every session lane, so a busy session never blocks it
   * and a long global run never blocks a session lane. A failed run still
   * releases the lane (the next run continues).
   */
  runGlobal<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.globalTail.then(fn, fn)
    this.globalTail = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  /** Number of tasks waiting behind the active one on a lane. */
  pendingCount(laneKey: string): number {
    return this.lanes.get(laneKey)?.pending.length ?? 0
  }

  /** True while a task is running on the lane. */
  isActive(laneKey: string): boolean {
    return !!this.lanes.get(laneKey)?.active
  }

  /** Resolves once the lane has neither an active nor a pending task. */
  whenIdle(laneKey: string): Promise<void> {
    const lane = this.lanes.get(laneKey)
    if (!lane || (!lane.active && lane.pending.length === 0)) return Promise.resolve()
    return new Promise<void>((resolve) => lane.idleWaiters.push(resolve))
  }

  private lane(key: string): LaneState {
    let lane = this.lanes.get(key)
    if (!lane) {
      lane = { key, pending: [], active: null, seq: 0, draining: false, idleWaiters: [] }
      this.lanes.set(key, lane)
    }
    return lane
  }

  private submit(key: string, verb: SteeringVerb, text: string, id?: string): SteeringSubmitResult {
    const lane = this.lane(key)
    const taskId = id ?? randomUUID()
    const plan = planSteeringSubmit(lane.pending, lane.active?.task.id, verb)

    if (plan.disposition === 'preempted') {
      lane.pending = []
      let abortedActiveId: string | undefined
      if (lane.active) {
        abortedActiveId = lane.active.task.id
        lane.active.controller.abort()
        lane.active.resolvePreempt()
      }
      // Interrupt runs next, ahead of anything enqueued afterwards.
      lane.pending.unshift({ id: taskId, verb, lane: key, text, seq: ++lane.seq })
      this.scheduleDrain(lane)
      return { taskId, lane: key, disposition: 'preempted', dropped: plan.droppedIds, abortedActiveId }
    }

    if (plan.disposition === 'steered') {
      lane.active!.steered.push({ id: taskId, verb, lane: key, text })
      return { taskId, lane: key, disposition: 'steered', targetId: lane.active!.task.id, dropped: [] }
    }

    if (plan.disposition === 'coalesced') {
      const target = lane.pending[plan.coalesceIndex!]
      target.text = target.text.length ? `${target.text}\n\n${text}` : text
      return { taskId, lane: key, disposition: 'coalesced', targetId: target.id, dropped: [] }
    }

    lane.pending.push({ id: taskId, verb, lane: key, text, seq: ++lane.seq })
    this.scheduleDrain(lane)
    return { taskId, lane: key, disposition: 'enqueued', dropped: [] }
  }

  private scheduleDrain(lane: LaneState): void {
    if (lane.draining || lane.active || lane.pending.length === 0) return
    lane.draining = true
    void this.drain(lane)
  }

  private async drain(lane: LaneState): Promise<void> {
    try {
      while (!lane.active && lane.pending.length > 0) {
        const task = lane.pending.shift()!
        const controller = new AbortController()
        const preempt = deferred()
        const active: ActiveRun = { task, controller, steered: [], preempt: preempt.promise, resolvePreempt: preempt.resolve }
        lane.active = active
        const ctx: SteeringRunContext = {
          signal: controller.signal,
          drainSteered: () => {
            const drained = active.steered
            active.steered = []
            return drained
          },
          preempted: active.preempt,
        }
        try {
          await this.runner(task, ctx)
        } catch {
          // A failing task must not stall the lane; the next pending task runs.
        } finally {
          lane.active = null
        }
      }
    } finally {
      lane.draining = false
      if (!lane.active && lane.pending.length > 0) {
        // Work arrived while the last runner was settling.
        this.scheduleDrain(lane)
      } else if (!lane.active && lane.pending.length === 0) {
        const waiters = lane.idleWaiters
        lane.idleWaiters = []
        for (const resolve of waiters) resolve()
      }
    }
  }
}