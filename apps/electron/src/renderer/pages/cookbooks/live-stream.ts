/**
 * Wave 15 (R1) — the pure half of the cookbooks live-streaming renderer.
 *
 * «Запустить ячейку» / «Запустить всё» no longer await one synchronous answer.
 * Main posts a fast `{runId}` and then re-publishes the sidecar's NDJSON frames
 * (`start` … `stdout`/`stderr`/`cell-end` … `end`) over `cookbooks-lab:run-event`
 * as `{runId, seq, …кадр}` (SPEC-wave15 §7). This module folds those frames into
 * one small state value — the live text of every cell, the run's own progress and
 * the terminal statuses it has seen — and coalesces the React publication so a
 * chatty cell costs one render per frame instead of one per chunk (SPEC §8).
 *
 * Everything here is pure or trivially scheduled: `applyRunEvent` never mutates
 * its input, the coalescer never leaks a timer past `cancel()`, and the frame
 * field names match the IPC event main sends (camelCase — `timedOut`/`durationMs`,
 * the same conversion `mapRunResult` already performs).
 */

/** A cell's terminal status as the renderer reports it (sidecar + local). */
export type LiveCellStatus = 'ok' | 'error' | 'skipped' | 'cancelled'

/**
 * One frame of a streamed run, as main pushes it (`cookbooks-lab:run-event`).
 * The `t` discriminator is the sidecar's own; every other field is optional
 * because each frame kind carries only its own.
 */
export interface CookbooksStreamFrame {
  /** The run this frame belongs to (minted by the renderer, echoed by main). */
  runId: string
  /** Monotone, gap-free per-run sequence assigned by main. */
  seq?: number
  /** `start|cell-start|stdout|stderr|display|cell-end|end|error`. */
  t: string
  /** Document index; `null` on a `/run-stream` text frame (one cell only). */
  index?: number | null
  /** A `stdout`/`stderr`/`display` chunk (already redacted by the sidecar). */
  data?: string
  /** A `display` frame's mime. */
  mime?: string
  /** A `cell-end` status string, or an `error` frame's HTTP status number. */
  status?: string | number
  ok?: boolean
  cancelled?: boolean
  timedOut?: boolean
  durationMs?: number | null
  /** The authoritative final DTO of an `end` frame. */
  result?: unknown
  /** The requested indices of a `start` frame (run-all only). */
  cells?: number[] | null
  error?: string | null
  stdout?: string
  stderr?: string
  displays?: unknown[]
  itemId?: string
  timeout?: number
}

/**
 * The live view of one run. `live` holds the raw stdout+stderr text of every
 * cell that has produced any — coalesced, never normalized (the incremental
 * buffer is shown as it arrives; the authoritative text replaces it once the
 * cell closes).
 */
export interface LiveStreamState {
  runId: string | null
  mode: 'single' | 'run-all'
  /** The cell a single run owns (`/run-stream` text frames carry `index: null`). */
  singleIndex: number | null
  /** The document indices the run covers, in run order. */
  order: number[]
  /** Live text per document index. */
  live: Record<number, string>
  /** Indices the run has reached (`cell-start`), in arrival order. */
  started: number[]
  /** Terminal statuses seen so far (`cell-end`), by index. */
  statuses: Record<number, LiveCellStatus>
  /** How many cells have closed (`cell-end`) — the N of «N из M». */
  done: number
  /** How many cells the run covers — the M of «N из M». */
  total: number
  /** The run ended through a cancel. */
  cancelled: boolean
  /** An `end`/`error` frame has landed. */
  finished: boolean
}

/** The empty state — a surface with no run in flight. */
export function createLiveStreamState(
  runId: string | null,
  init: {
    mode?: 'single' | 'run-all'
    singleIndex?: number | null
    order?: readonly number[]
  } = {},
): LiveStreamState {
  const order = init.order === undefined ? [] : [...init.order]
  return {
    runId,
    mode: init.mode ?? 'single',
    singleIndex: init.singleIndex ?? null,
    order,
    live: {},
    started: [],
    statuses: {},
    done: 0,
    total: order.length,
    cancelled: false,
    finished: false,
  }
}

const isIndex = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value)

/** A `cell-end` status guarded to the renderer's vocabulary (unknown ⇒ failure). */
export function normalizeStatus(status: string | number | undefined): LiveCellStatus {
  return status === 'ok' || status === 'error' || status === 'skipped' || status === 'cancelled' ? status : 'error'
}

/** The index a text frame belongs to; a `/run-stream` frame falls back to its cell. */
function resolveIndex(state: LiveStreamState, index: number | null | undefined): number | null {
  if (isIndex(index)) return index
  return state.singleIndex
}

/**
 * Fold one frame into the state. A frame from another run is ignored outright
 * (the page filters by runId too — this is the module's own guard), and every
 * other branch returns a fresh object so React sees a new reference.
 */
export function applyRunEvent(state: LiveStreamState, frame: CookbooksStreamFrame): LiveStreamState {
  if (state.runId !== null && frame.runId !== state.runId) return state
  switch (frame.t) {
    case 'start': {
      const cells = Array.isArray(frame.cells) ? frame.cells : null
      const batch = cells !== null
      const order = cells ? cells.filter(isIndex) : state.order
      return {
        ...state,
        mode: batch ? 'run-all' : 'single',
        singleIndex: isIndex(frame.index) ? frame.index : state.singleIndex,
        order,
        total: order.length,
      }
    }
    case 'cell-start': {
      if (!isIndex(frame.index)) return state
      if (state.started.includes(frame.index)) return state
      return { ...state, started: [...state.started, frame.index] }
    }
    case 'stdout':
    case 'stderr': {
      const index = resolveIndex(state, frame.index)
      if (index === null || typeof frame.data !== 'string' || frame.data.length === 0) return state
      return { ...state, live: { ...state.live, [index]: (state.live[index] ?? '') + frame.data } }
    }
    case 'display':
      // A `/run-stream` display record only ever lands as a frame just before
      // `end`; the surface draws it from the final result, never from the live
      // text (SPEC §Contract «/run-stream» emission).
      return state
    case 'cell-end': {
      if (!isIndex(frame.index)) return state
      const index = frame.index
      const status = normalizeStatus(frame.status)
      const opened = state.statuses[index]
      return {
        ...state,
        statuses: { ...state.statuses, [index]: status },
        started: state.started.includes(index) ? state.started : [...state.started, index],
        // A repeated `cell-end` (a late duplicate) never inflates N.
        done: opened === undefined ? state.done + 1 : state.done,
      }
    }
    case 'end':
      return { ...state, cancelled: frame.cancelled === true, finished: true }
    case 'error':
      return { ...state, finished: true }
    default:
      return state
  }
}

/** The live text a cell is showing, or `undefined` when it has printed nothing. */
export function liveTextFor(state: LiveStreamState, index: number): string | undefined {
  const text = state.live[index]
  return text === undefined || text.length === 0 ? undefined : text
}

/**
 * The N/M counter to render, or `null` when there is nothing honest to show: a
 * single run has no batch to count (SPEC F6).
 */
export function progressFor(state: LiveStreamState): { done: number; total: number } | null {
  if (state.mode !== 'run-all' || state.total === 0) return null
  return { done: state.done, total: state.total }
}

/**
 * The status to draw for a cell: the `cell-end` status once it landed, else
 * `cancelled` for a cell the run reached but never closed once the run finished
 * (an interrupted batch), else `undefined` (still running, or never reached).
 */
export function cellStatusFor(state: LiveStreamState, index: number): LiveCellStatus | undefined {
  const closed = state.statuses[index]
  if (closed !== undefined) return closed
  if (state.finished && state.cancelled && state.started.includes(index)) return 'cancelled'
  return undefined
}

/**
 * The cells the run reached but never closed, in run order. On a normal finish
 * this is empty; on a cancel it is exactly the cell that was mid-flight, whose
 * partial live text the surface keeps (SPEC §8).
 */
export function interruptedCells(state: LiveStreamState): number[] {
  if (!state.finished) return []
  return state.started.filter((index) => state.statuses[index] === undefined)
}

/** Drop every live buffer except `indices` — the partial text of an interrupted cell. */
export function retainLive(state: LiveStreamState, indices: readonly number[]): LiveStreamState {
  const keep = new Set(indices)
  let changed = false
  const live: Record<number, string> = {}
  for (const key of Object.keys(state.live)) {
    const index = Number(key)
    if (keep.has(index)) live[index] = state.live[index]
    else changed = true
  }
  return changed ? { ...state, live } : state
}

/** Drop one cell's live buffer — its run is closed, the result takes over. */
export function clearLive(state: LiveStreamState, index: number): LiveStreamState {
  if (state.live[index] === undefined) return state
  const live = { ...state.live }
  delete live[index]
  return { ...state, live }
}

// ---------------------------------------------------------------------------
// Coalescing publication
// ---------------------------------------------------------------------------

/**
 * A publish coalescer: `schedule()` asks for one publish on the next animation
 * frame (or after `intervalMs` where no rAF exists — the SPEC's 80 ms cap), and
 * a burst of `schedule()` calls collapses into that single publish. `flush()`
 * publishes immediately (the finalize path, so the surface never renders a
 * half-folded state); `cancel()` drops a pending publish without running it.
 */
export interface Coalescer {
  schedule(): void
  flush(): void
  cancel(): void
  readonly pending: boolean
}

export interface CoalescerOptions {
  /** Overrides the frame scheduler (tests drive it deterministically). */
  requestFrame?: (callback: () => void) => number
  /** Overrides the frame canceller — must pair with `requestFrame`. */
  cancelFrame?: (handle: number) => void
  /** Fallback delay where no rAF exists (default 80 ms). */
  intervalMs?: number
}

export function createCoalescer(publish: () => void, options: CoalescerOptions = {}): Coalescer {
  const intervalMs = options.intervalMs ?? 80
  const raf =
    typeof globalThis.requestAnimationFrame === 'function' ? globalThis.requestAnimationFrame.bind(globalThis) : null
  const caf =
    typeof globalThis.cancelAnimationFrame === 'function' ? globalThis.cancelAnimationFrame.bind(globalThis) : null
  const requestFrame =
    options.requestFrame ??
    (raf ?? ((callback: () => void): number => globalThis.setTimeout(callback, intervalMs) as unknown as number))
  const cancelFrame =
    options.cancelFrame ?? (raf !== null && caf !== null ? caf : (handle: number) => globalThis.clearTimeout(handle))

  let handle: number | null = null
  let dirty = false

  const onDue = () => {
    handle = null
    if (!dirty) return
    dirty = false
    publish()
  }

  return {
    schedule() {
      dirty = true
      if (handle === null) handle = requestFrame(onDue)
    },
    flush() {
      if (handle !== null) {
        cancelFrame(handle)
        handle = null
      }
      if (!dirty) return
      dirty = false
      publish()
    },
    cancel() {
      if (handle !== null) {
        cancelFrame(handle)
        handle = null
      }
      dirty = false
    },
    get pending() {
      return handle !== null
    },
  }
}
