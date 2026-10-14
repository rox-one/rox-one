/** Coalesce persist progress to ≤ `hz` events/s. Payload is counts, not per-file. */

export interface ForeignImportProgress {
  done: number
  total: number
  phase: 'persist' | 'ingest'
}

export interface CoalescedProgressClock {
  now: () => number
  setTimeout: (fn: () => void, ms: number) => unknown
  clearTimeout: (id: unknown) => void
}

export function createCoalescedProgress(
  emit: (progress: ForeignImportProgress) => void,
  options: { hz?: number; clock?: CoalescedProgressClock } = {},
): { report: (progress: ForeignImportProgress) => void; flush: () => void } {
  const hz = options.hz ?? 10
  const minGap = 1000 / hz
  const clock = options.clock ?? {
    now: () => Date.now(),
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
  }
  let last = 0
  let pending: ForeignImportProgress | null = null
  let timer: unknown = null

  const flush = () => {
    if (timer != null) {
      clock.clearTimeout(timer)
      timer = null
    }
    if (!pending) return
    const value = pending
    pending = null
    last = clock.now()
    emit(value)
  }

  const report = (progress: ForeignImportProgress) => {
    pending = progress
    const elapsed = clock.now() - last
    if (elapsed >= minGap) {
      flush()
      return
    }
    if (timer == null) {
      timer = clock.setTimeout(flush, minGap - elapsed)
    }
  }

  return { report, flush }
}
