/**
 * Per-store FIFO write queue with key-disjoint concurrency.
 *
 * Every durable write in the unified state store funnels through one queue:
 * `run({storePath, keys, fn, signal})`.
 *
 * - `storePath` selects the lane (one lane per physical store, e.g. the SQLite
 *   file). Lanes are independent.
 * - `keys` names the rows/tables the write touches. Omitted or empty means
 *   whole-store exclusive (conflicts with everything). Disjoint key sets run
 *   concurrently; overlapping ones serialize.
 * - Strict FIFO: a later waiter never bypasses an earlier conflicting one —
 *   the drain reserves the keys of every earlier *pending* waiter, not just
 *   the running set.
 * - A rejecting writer never wedges the lane: the rejection is delivered and
 *   the drain continues.
 * - An aborted signal cancels only waiters that have not started; a running
 *   writer is never interrupted.
 * - Nested runs of the same store are allowed only with `reentrant: true`
 *   (the caller already holds overlapping keys); otherwise they queue behind
 *   the outer writer.
 */
import { AsyncLocalStorage } from 'node:async_hooks'

export interface WriteQueueRunOptions<T> {
  storePath: string
  /** Rows/tables touched. Omitted or empty = whole-store exclusive. */
  keys?: readonly string[]
  fn: () => T | Promise<T>
  signal?: AbortSignal
  /** Allow a nested run when this async context already holds overlapping keys. */
  reentrant?: boolean
}

export interface WriteQueue {
  run<T>(options: WriteQueueRunOptions<T>): Promise<T>
  pendingCount(storePath: string): number
  runningCount(storePath: string): number
  whenIdle(storePath: string): Promise<void>
}

interface HeldContext {
  storePath: string
  keys: ReadonlySet<string> | null
}

interface Waiter {
  keys: Set<string> | null
  fn: () => unknown
  resolve: (value: unknown) => void
  reject: (error: unknown) => void
  signal?: AbortSignal
  onAbort?: () => void
  started: boolean
  aborted: boolean
}

interface Lane {
  pending: Waiter[]
  runningKeys: Set<string>
  runningExclusive: boolean
  running: number
  idleResolvers: Array<() => void>
}

function conflicting(held: ReadonlySet<string> | null, requested: ReadonlySet<string> | null): boolean {
  if (held === null || requested === null) return true
  for (const key of requested) if (held.has(key)) return true
  return false
}

function abortError(): Error {
  const error = new Error('Write queue operation aborted')
  error.name = 'AbortError'
  return error
}

export function createWriteQueue(): WriteQueue {
  const lanes = new Map<string, Lane>()
  const held = new AsyncLocalStorage<HeldContext>()

  const laneFor = (storePath: string): Lane => {
    let lane = lanes.get(storePath)
    if (!lane) {
      lane = { pending: [], runningKeys: new Set(), runningExclusive: false, running: 0, idleResolvers: [] }
      lanes.set(storePath, lane)
    }
    return lane
  }

  const settleIdle = (lane: Lane): void => {
    if (lane.running > 0 || lane.pending.length > 0) return
    const waiters = lane.idleResolvers.splice(0)
    for (const resolve of waiters) resolve()
  }

  const finish = (lane: Lane, waiter: Waiter): void => {
    lane.running -= 1
    if (waiter.keys === null) lane.runningExclusive = false
    else for (const key of waiter.keys) lane.runningKeys.delete(key)
  }

  const drain = (storePath: string): void => {
    const lane = lanes.get(storePath)
    if (!lane) return

    // Keys already spoken for: running writers plus every earlier pending
    // waiter (so a later overlapping waiter can never jump the queue).
    const blocked = new Set(lane.runningKeys)
    let exclusiveBlocked = lane.runningExclusive
    const stillPending: Waiter[] = []

    for (const waiter of lane.pending) {
      if (waiter.started || waiter.aborted) continue

      const conflicts = exclusiveBlocked
        || (waiter.keys === null ? blocked.size > 0 : conflicting(blocked, waiter.keys))
      if (conflicts) {
        stillPending.push(waiter)
        if (waiter.keys === null) exclusiveBlocked = true
        else for (const key of waiter.keys) blocked.add(key)
        continue
      }

      waiter.started = true
      if (waiter.onAbort && waiter.signal) waiter.signal.removeEventListener('abort', waiter.onAbort)
      lane.running += 1
      if (waiter.keys === null) lane.runningExclusive = true
      else for (const key of waiter.keys) lane.runningKeys.add(key)

      Promise.resolve()
        .then(() => held.run({ storePath, keys: waiter.keys }, waiter.fn))
        .then(
          (value) => {
            finish(lane, waiter)
            waiter.resolve(value)
            drain(storePath)
          },
          (error) => {
            finish(lane, waiter)
            waiter.reject(error)
            drain(storePath)
          },
        )
    }

    lane.pending = stillPending
    settleIdle(lane)
  }

  const run = <T>(options: WriteQueueRunOptions<T>): Promise<T> => {
    const keys = options.keys && options.keys.length > 0 ? new Set(options.keys) : null

    if (options.reentrant) {
      const context = held.getStore()
      if (context && context.storePath === options.storePath && conflicting(context.keys, keys)) {
        return Promise.resolve().then(options.fn)
      }
    }

    return new Promise<T>((resolve, reject) => {
      if (options.signal?.aborted) {
        reject(abortError())
        return
      }
      const lane = laneFor(options.storePath)
      const waiter: Waiter = {
        keys,
        fn: options.fn as () => unknown,
        resolve: resolve as (value: unknown) => void,
        reject,
        signal: options.signal,
        started: false,
        aborted: false,
      }
      if (options.signal) {
        waiter.onAbort = () => {
          // Cancels only waiters; a writer that already started is never
          // interrupted (its fn owns the store mid-flight).
          if (waiter.started) return
          waiter.aborted = true
          lane.pending = lane.pending.filter((candidate) => candidate !== waiter)
          reject(abortError())
          drain(options.storePath)
        }
        options.signal.addEventListener('abort', waiter.onAbort, { once: true })
      }
      lane.pending.push(waiter)
      settleIdle(lane)
      drain(options.storePath)
    })
  }

  const whenIdle = (storePath: string): Promise<void> => {
    const lane = laneFor(storePath)
    if (lane.running === 0 && lane.pending.length === 0) return Promise.resolve()
    return new Promise<void>((resolve) => lane.idleResolvers.push(resolve))
  }

  return {
    run,
    pendingCount: (storePath) => lanes.get(storePath)?.pending.length ?? 0,
    runningCount: (storePath) => lanes.get(storePath)?.running ?? 0,
    whenIdle,
  }
}