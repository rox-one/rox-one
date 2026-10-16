/**
 * `live-stream.ts` — the pure half of the wave-15 streaming renderer (R1).
 *
 * The reducer folds the sidecar's frames into the surface's live state (the
 * per-cell text, the run's own progress and the statuses it has seen), the
 * coalescer collapses a burst of publishes into one, and the cancel helpers
 * decide which cell keeps its partial text when a run is stopped. Nothing here
 * touches React, so the cases below drive the frames directly.
 */
import { describe, expect, it, vi } from 'bun:test'
import {
  applyRunEvent,
  cellStatusFor,
  clearLive,
  createCoalescer,
  createLiveStreamState,
  interruptedCells,
  liveTextFor,
  normalizeStatus,
  progressFor,
  retainLive,
  type CookbooksStreamFrame,
} from '../live-stream'

const run = (overrides: Partial<CookbooksStreamFrame>): CookbooksStreamFrame => ({
  runId: 'run-1',
  t: 'stdout',
  ...overrides,
})

describe('createLiveStreamState', () => {
  it('starts empty, with the batch size derived from the requested order', () => {
    const state = createLiveStreamState('run-1', { mode: 'run-all', order: [1, 2, 3] })
    expect(state.runId).toBe('run-1')
    expect(state.mode).toBe('run-all')
    expect(state.total).toBe(3)
    expect(state.done).toBe(0)
    expect(state.live).toEqual({})
    expect(state.finished).toBe(false)
  })
})

describe('applyRunEvent — frames → state', () => {
  it('accumulates stdout/stderr chunks per index and leaves the input untouched', () => {
    const start = createLiveStreamState('run-1', { mode: 'run-all', order: [1, 2] })
    const first = applyRunEvent(start, run({ seq: 1, t: 'stdout', index: 1, data: 'one\n' }))
    const second = applyRunEvent(first, run({ seq: 2, t: 'stderr', index: 1, data: 'warn\n' }))
    const third = applyRunEvent(second, run({ seq: 3, t: 'stdout', index: 2, data: 'two\n' }))

    expect(start.live).toEqual({})
    expect(third.live[1]).toBe('one\nwarn\n')
    expect(third.live[2]).toBe('two\n')
    expect(liveTextFor(third, 1)).toBe('one\nwarn\n')
    expect(liveTextFor(third, 3)).toBeUndefined()
  })

  it('routes a `/run-stream` chunk carrying `index: null` to the run’s own cell', () => {
    const state = createLiveStreamState('run-1', { mode: 'single', singleIndex: 4 })
    const next = applyRunEvent(state, run({ t: 'stdout', index: null, data: 'hi' }))
    expect(next.live[4]).toBe('hi')
  })

  it('counts a closed cell once (`cell-end`), never a duplicate', () => {
    let state = createLiveStreamState('run-1', { mode: 'run-all', order: [1, 2, 3] })
    state = applyRunEvent(state, run({ t: 'cell-end', index: 1, status: 'ok' }))
    expect(state.done).toBe(1)
    expect(state.statuses[1]).toBe('ok')
    state = applyRunEvent(state, run({ t: 'cell-end', index: 1, status: 'ok' }))
    expect(state.done).toBe(1)
    state = applyRunEvent(state, run({ t: 'cell-end', index: 2, status: 'error' }))
    expect(state.done).toBe(2)
  })

  it('ignores a frame that belongs to another run', () => {
    const state = createLiveStreamState('run-1', { mode: 'single', singleIndex: 1 })
    const next = applyRunEvent(state, run({ runId: 'other', t: 'stdout', index: 1, data: 'nope' }))
    expect(next).toBe(state)
  })

  it('marks the run cancelled + finished from the `end` frame', () => {
    const state = createLiveStreamState('run-1', { mode: 'run-all', order: [1] })
    const next = applyRunEvent(state, run({ t: 'end', cancelled: true, result: { cells: [] } }))
    expect(next.cancelled).toBe(true)
    expect(next.finished).toBe(true)
  })

  it('treats an `error` frame as a finish without a cancel', () => {
    const state = createLiveStreamState('run-1', { mode: 'single', singleIndex: 1 })
    const next = applyRunEvent(state, run({ t: 'error', status: 500, error: 'boom' }))
    expect(next.finished).toBe(true)
    expect(next.cancelled).toBe(false)
  })

  it('derives the batch shape from the `start` frame’s own cell list', () => {
    const state = createLiveStreamState('run-1')
    const next = applyRunEvent(state, run({ t: 'start', index: null, cells: [2, 4] }))
    expect(next.mode).toBe('run-all')
    expect(next.total).toBe(2)
  })
})

describe('progressFor — the honest N/M', () => {
  it('is null for a single run and grows with each `cell-end`', () => {
    let single = createLiveStreamState('run-1', { mode: 'single', singleIndex: 1 })
    expect(progressFor(single)).toBeNull()

    let batch = createLiveStreamState('run-1', { mode: 'run-all', order: [1, 2, 3] })
    expect(progressFor(batch)).toEqual({ done: 0, total: 3 })
    batch = applyRunEvent(batch, run({ t: 'cell-end', index: 1, status: 'ok' }))
    expect(progressFor(batch)).toEqual({ done: 1, total: 3 })
  })

  it('is null for a batch that covers no cell', () => {
    expect(progressFor(createLiveStreamState('run-1', { mode: 'run-all', order: [] }))).toBeNull()
  })
})

describe('cancel handling — the cell a stop cut short', () => {
  const started = () =>
    applyRunEvent(
      applyRunEvent(createLiveStreamState('run-1', { mode: 'run-all', order: [1, 2, 3] }), run({ t: 'cell-start', index: 1 })),
      run({ t: 'stdout', index: 1, data: 'partial-1\n' }),
    )

  it('reports a started-but-unclosed cell as cancelled once the run finished', () => {
    let state = started()
    state = applyRunEvent(state, run({ t: 'stdout', index: 2, data: 'partial-2\n' }))
    state = applyRunEvent(state, run({ t: 'cell-start', index: 2 }))
    expect(cellStatusFor(state, 1)).toBeUndefined()
    state = applyRunEvent(state, run({ t: 'end', cancelled: true, result: { cells: [] } }))
    expect(cellStatusFor(state, 1)).toBe('cancelled')
    expect(cellStatusFor(state, 2)).toBe('cancelled')
    expect(cellStatusFor(state, 3)).toBeUndefined()
    expect(interruptedCells(state)).toEqual([1, 2])
  })

  it('lets a closed cell keep its own status over the cancel fallback', () => {
    let state = started()
    state = applyRunEvent(state, run({ t: 'cell-end', index: 1, status: 'ok' }))
    state = applyRunEvent(state, run({ t: 'end', cancelled: true, result: { cells: [] } }))
    expect(cellStatusFor(state, 1)).toBe('ok')
    expect(interruptedCells(state)).toEqual([])
  })

  it('retains only the interrupted cells’ partial text', () => {
    let state = started()
    state = applyRunEvent(state, run({ t: 'stdout', index: 2, data: 'partial-2\n' }))
    state = applyRunEvent(state, run({ t: 'cell-start', index: 2 }))
    state = applyRunEvent(state, run({ t: 'end', cancelled: true, result: { cells: [] } }))
    const kept = retainLive(state, interruptedCells(state))
    expect(kept.live).toEqual({ 1: 'partial-1\n', 2: 'partial-2\n' })
  })

  it('drops a closed cell’s buffer and is a no-op when there is nothing to drop', () => {
    const state = started()
    expect(clearLive(state, 9)).toBe(state)
    expect(clearLive(state, 1).live).toEqual({})
  })
})

describe('normalizeStatus', () => {
  it('keeps the sidecar’s own three values and treats anything else as a failure', () => {
    expect(normalizeStatus('ok')).toBe('ok')
    expect(normalizeStatus('error')).toBe('error')
    expect(normalizeStatus('skipped')).toBe('skipped')
    expect(normalizeStatus('cancelled')).toBe('cancelled')
    expect(normalizeStatus(undefined)).toBe('error')
    expect(normalizeStatus(500)).toBe('error')
  })
})

describe('coalescer — one publish per frame, not per chunk', () => {
  /** A deterministic frame scheduler: nothing runs until the test flushes it. */
  function manualScheduler() {
    const pending = new Map<number, () => void>()
    let next = 1
    return {
      requestFrame: (callback: () => void) => {
        const handle = next
        next += 1
        pending.set(handle, callback)
        return handle
      },
      cancelFrame: (handle: number) => {
        pending.delete(handle)
      },
      run: () => {
        const callbacks = [...pending.values()]
        pending.clear()
        for (const callback of callbacks) callback()
      },
      get size() {
        return pending.size
      },
    }
  }

  it('collapses a burst of schedules into one publish of the latest state', () => {
    const scheduler = manualScheduler()
    const published: number[] = []
    let value = 0
    const coalescer = createCoalescer(() => published.push(value), scheduler)

    value = 1
    coalescer.schedule()
    value = 2
    coalescer.schedule()
    value = 3
    coalescer.schedule()
    expect(published).toEqual([])
    expect(coalescer.pending).toBe(true)

    scheduler.run()
    expect(published).toEqual([3])
    expect(coalescer.pending).toBe(false)

    // A schedule after the frame runs again.
    value = 4
    coalescer.schedule()
    scheduler.run()
    expect(published).toEqual([3, 4])
  })

  it('flushes immediately and drops the scheduled publish', () => {
    const scheduler = manualScheduler()
    const published: string[] = []
    const coalescer = createCoalescer(() => published.push('p'), scheduler)

    coalescer.schedule()
    coalescer.flush()
    expect(published).toEqual(['p'])
    expect(scheduler.size).toBe(0)
    // Nothing pending, so a second flush is a no-op.
    coalescer.flush()
    expect(published).toEqual(['p'])
  })

  it('cancels a pending publish without running it', () => {
    const scheduler = manualScheduler()
    const published: string[] = []
    const coalescer = createCoalescer(() => published.push('p'), scheduler)

    coalescer.schedule()
    coalescer.cancel()
    expect(coalescer.pending).toBe(false)
    expect(scheduler.size).toBe(0)
    scheduler.run()
    expect(published).toEqual([])
  })

  it('publishes through a timer scheduler just as it does through rAF', () => {
    vi.useFakeTimers()
    try {
      const published: string[] = []
      const coalescer = createCoalescer(() => published.push('p'), {
        requestFrame: (callback) => globalThis.setTimeout(callback, 0) as unknown as number,
        cancelFrame: (handle) => globalThis.clearTimeout(handle),
      })
      coalescer.schedule()
      expect(published).toEqual([])
      vi.advanceTimersByTime(1)
      expect(published).toEqual(['p'])
    } finally {
      vi.useRealTimers()
    }
  })
})
