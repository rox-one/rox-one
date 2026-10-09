import { describe, expect, it } from 'bun:test'
import {
  createBoardLiveRefresh,
  normaliseWorkboardRevision,
  type BoardLiveRefreshReadArgs,
  type BoardVisibilityDocument,
} from '../board-live-refresh'
import type { WorkboardReadResult } from '../../../../../shared/types'

/**
 * Deterministic timer harness — the coalescer takes its timers as options, so the
 * "fake-timer" behaviour is exercised without monkey-patching globals.
 */
class ManualClock {
  now = 0
  private seq = 0
  private timers = new Map<number, { due: number; fn: () => void }>()

  setTimeout = (fn: () => void, ms: number): unknown => {
    const id = ++this.seq
    this.timers.set(id, { due: this.now + ms, fn })
    return id
  }

  clearTimeout = (handle: unknown): void => {
    this.timers.delete(handle as number)
  }

  /** Run every timer due within `ms`, in due order, including timers armed by callbacks. */
  advance(ms: number): void {
    const target = this.now + ms
    for (;;) {
      let nextId: number | undefined
      let nextDue = Number.POSITIVE_INFINITY
      for (const [id, timer] of this.timers) {
        if (timer.due <= target && timer.due < nextDue) {
          nextDue = timer.due
          nextId = id
        }
      }
      if (nextId === undefined) break
      const timer = this.timers.get(nextId)!
      this.timers.delete(nextId)
      this.now = timer.due
      timer.fn()
    }
    this.now = target
  }

  pendingCount(): number {
    return this.timers.size
  }
}

class FakeVisibilityDocument implements BoardVisibilityDocument {
  hidden: boolean
  private listeners = new Set<() => void>()

  constructor(hidden = false) {
    this.hidden = hidden
  }

  addEventListener(_type: 'visibilitychange', listener: () => void): void {
    this.listeners.add(listener)
  }

  removeEventListener(_type: 'visibilitychange', listener: () => void): void {
    this.listeners.delete(listener)
  }

  emitVisibility(): void {
    for (const listener of [...this.listeners]) listener()
  }

  listenerCount(): number {
    return this.listeners.size
  }
}

/** Flush microtasks so a resolved `read` promise runs its continuation. */
async function tick(): Promise<void> {
  for (let i = 0; i < 6; i += 1) await Promise.resolve()
}

function makeHarness(overrides: {
  initialRevision?: number
  initialEpoch?: number
  hidden?: boolean
  writeInFlight?: () => boolean
  result?: WorkboardReadResult
  read?: (args: BoardLiveRefreshReadArgs) => Promise<WorkboardReadResult>
}) {
  const clock = new ManualClock()
  const doc = new FakeVisibilityDocument(overrides.hidden ?? false)
  const reads: BoardLiveRefreshReadArgs[] = []
  const reloads: Array<{ epoch: number; full: boolean; revision: number }> = []
  const defaultResult: WorkboardReadResult = overrides.result ?? { revision: 0, cards: [] }

  const handle = createBoardLiveRefresh({
    read:
      overrides.read ??
      (async args => {
        reads.push(args)
        return defaultResult
      }),
    onReloaded: reload => reloads.push({ epoch: reload.epoch, full: reload.full, revision: reload.revision }),
    isWriteInFlight: overrides.writeInFlight ?? (() => false),
    document: doc,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    initialRevision: overrides.initialRevision,
    initialEpoch: overrides.initialEpoch,
  })

  return { clock, doc, reads, reloads, handle }
}

describe('normaliseWorkboardRevision', () => {
  it('accepts a finite integer revision', () => {
    expect(normaliseWorkboardRevision({ revision: 7 })).toBe(7)
    expect(normaliseWorkboardRevision({ revision: 7.9 })).toBe(7)
  })

  it('rejects malformed payloads', () => {
    expect(normaliseWorkboardRevision(null)).toBeNull()
    expect(normaliseWorkboardRevision(undefined)).toBeNull()
    expect(normaliseWorkboardRevision({} as never)).toBeNull()
    expect(normaliseWorkboardRevision({ revision: Number.NaN })).toBeNull()
    expect(normaliseWorkboardRevision({ revision: Number.POSITIVE_INFINITY })).toBeNull()
    expect(normaliseWorkboardRevision({ revision: '5' } as never)).toBeNull()
  })
})

describe('createBoardLiveRefresh', () => {
  it('coalesces two rapid events into one reload', async () => {
    const { clock, reads, handle } = makeHarness({ read: async args => {
      reads.push(args)
      return { revision: 6, cards: [] }
    } })
    handle.notify({ revision: 5 })
    handle.notify({ revision: 6 })
    clock.advance(0)
    await tick()
    expect(reads).toHaveLength(1)
    expect(reads[0].sinceRevision).toBe(0)
    expect(handle.getRevision()).toBe(6)
  })

  it('no-ops when the payload revision equals the applied revision', async () => {
    const { clock, reads, handle } = makeHarness({ initialRevision: 7, initialEpoch: 1 })
    handle.notify({ revision: 7 })
    clock.advance(1000)
    await tick()
    expect(reads).toHaveLength(0)
    expect(handle.getRevision()).toBe(7)
    expect(handle.getEpoch()).toBe(1)
  })

  it('ignores malformed change payloads', async () => {
    const { clock, reads, handle } = makeHarness({})
    handle.notify(null)
    handle.notify({ revision: Number.NaN })
    clock.advance(1000)
    await tick()
    expect(reads).toHaveLength(0)
  })

  it('defers while the tab is hidden and refreshes on visibilitychange', async () => {
    const { clock, doc, reads, handle } = makeHarness({
      hidden: true,
      read: async args => {
        reads.push(args)
        return { revision: 5, cards: [] }
      },
    })
    handle.notify({ revision: 5 })
    clock.advance(0)
    await tick()
    expect(reads).toHaveLength(0)

    doc.hidden = false
    doc.emitVisibility()
    clock.advance(0)
    await tick()
    expect(reads).toHaveLength(1)
    expect(reads[0].sinceRevision).toBe(0)
    expect(handle.getRevision()).toBe(5)
  })

  it('defers while a card write is in flight then retries once', async () => {
    let inFlight = true
    const { clock, reads, handle } = makeHarness({
      writeInFlight: () => inFlight,
      read: async args => {
        reads.push(args)
        return { revision: 5, cards: [] }
      },
    })
    handle.notify({ revision: 5 })
    clock.advance(0)
    await tick()
    expect(reads).toHaveLength(0)

    // One retry after the delay — even though the write is still "in flight".
    clock.advance(1000)
    await tick()
    expect(reads).toHaveLength(1)

    // No further retries pile up once the deferred refresh has run.
    clock.advance(5000)
    await tick()
    expect(reads).toHaveLength(1)
    void inFlight
  })

  it('resumes the deferred refresh as soon as endWrite reports completion', async () => {
    let inFlight = true
    const { clock, reads, handle } = makeHarness({
      writeInFlight: () => inFlight,
      read: async args => {
        reads.push(args)
        return { revision: 5, cards: [] }
      },
    })
    handle.notify({ revision: 5 })
    clock.advance(0)
    await tick()
    expect(reads).toHaveLength(0)

    inFlight = false
    handle.endWrite()
    await tick()
    expect(reads).toHaveLength(1)
    // The 1 s fallback timer was cancelled — advancing does not re-read.
    clock.advance(2000)
    await tick()
    expect(reads).toHaveLength(1)
  })

  it('treats a revision regression as an epoch bump forcing a full reload', async () => {
    const { clock, reads, reloads, handle } = makeHarness({
      initialRevision: 9,
      initialEpoch: 2,
      read: async args => {
        reads.push(args)
        return { revision: 3, cards: [] }
      },
    })
    handle.notify({ revision: 3 })
    clock.advance(0)
    await tick()

    expect(reads).toHaveLength(1)
    expect(reads[0].sinceRevision).toBeUndefined()
    expect(reads[0].epoch).toBe(3)
    expect(handle.getEpoch()).toBe(3)
    expect(handle.getRevision()).toBe(3)
    expect(reloads).toEqual([{ epoch: 3, full: true, revision: 3 }])
  })

  it('re-reads when a newer revision lands during an in-flight read', async () => {
    let release: (() => void) | undefined
    const reads: BoardLiveRefreshReadArgs[] = []
    let revision = 5
    const { clock, handle } = makeHarness({
      read: async args => {
        reads.push(args)
        const captured = revision
        if (reads.length === 1) await new Promise<void>(resolve => { release = resolve })
        return { revision: captured, cards: [] }
      },
    })
    handle.notify({ revision: 5 })
    clock.advance(0)
    await tick()
    expect(reads).toHaveLength(1)

    // A second change arrives while the first read is still pending.
    revision = 6
    handle.notify({ revision: 6 })
    release?.()
    await tick()
    clock.advance(0)
    await tick()

    expect(reads).toHaveLength(2)
    expect(reads[1].sinceRevision).toBe(5)
    expect(handle.getRevision()).toBe(6)
  })

  it('dispose stops all timers and unsubscribes visibility', async () => {
    const { clock, doc, reads, handle } = makeHarness({
      writeInFlight: () => true,
      read: async args => {
        reads.push(args)
        return { revision: 5, cards: [] }
      },
    })
    handle.notify({ revision: 5 })
    clock.advance(0)
    await tick()
    // A retry timer is armed but blocked by the in-flight write.
    expect(clock.pendingCount()).toBeGreaterThan(0)
    expect(doc.listenerCount()).toBe(1)

    handle.dispose()
    expect(clock.pendingCount()).toBe(0)
    expect(doc.listenerCount()).toBe(0)

    clock.advance(5000)
    await tick()
    doc.emitVisibility()
    clock.advance(0)
    await tick()
    expect(reads).toHaveLength(0)
  })
})