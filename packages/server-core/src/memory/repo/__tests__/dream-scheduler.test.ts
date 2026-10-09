/**
 * DreamScheduler — interval gating, sequential runs (global mutex), runNow
 * while stopped, and status composition.
 * Acceptance: two banks, tick with a fixed clock ⇒ at most one run per bank
 * per interval; runs never overlap; runNow works with a stopped scheduler.
 *
 * The interval timer is never started here: tests drive `tickOnce()` directly
 * with an injected clock, and the fake runner yields through microtasks rather
 * than wall-clock timers, so the whole suite is deterministic.
 */
import { describe, expect, it, afterEach } from 'bun:test'
import type { MemoryDreamEvent } from '@rox/shared/memory/repo'
import type { MemoryRepoService } from '../MemoryRepoService'
import type { DreamRunner } from '../DreamRunner'
import { DreamCostTracker } from '../DreamCostTracker'
import type { DreamNotesScanner } from '../DreamNotesScanner'
import { DreamScheduler } from '../DreamScheduler'

const schedulers: DreamScheduler[] = []
afterEach(() => {
  for (const scheduler of schedulers.splice(0)) scheduler.stop()
})

interface FakeRunner {
  runner: DreamRunner
  counts: Map<string, number>
  events: MemoryDreamEvent[]
  maxActive: () => number
}

function makeFakeRunner(): FakeRunner {
  const listeners = new Set<(e: MemoryDreamEvent) => void>()
  const counts = new Map<string, number>()
  const events: MemoryDreamEvent[] = []
  let active = 0
  let maxActive = 0

  const emit = (bankId: string, kind: MemoryDreamEvent['kind']): void => {
    const event: MemoryDreamEvent = {
      ts: '2026-10-09T12:00:00.000Z',
      dreamId: `${bankId}-${counts.get(bankId) ?? 0}`,
      bankId,
      kind,
      message: kind,
    }
    events.push(event)
    for (const listener of listeners) listener(event)
  }

  const runner = {
    cost: new DreamCostTracker(),
    notes: { listPending: async () => [{ id: 'n1.md', content: 'x' }] } as unknown as DreamNotesScanner,
    pendingNotes: async () => [{ id: 'n1.md', content: 'x' }],
    onEvent: (listener: (e: MemoryDreamEvent) => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    async run(bankId: string) {
      active += 1
      maxActive = Math.max(maxActive, active)
      emit(bankId, 'start')
      counts.set(bankId, (counts.get(bankId) ?? 0) + 1)
      // Yield repeatedly so any concurrent run would visibly interleave.
      for (let i = 0; i < 8; i += 1) await Promise.resolve()
      emit(bankId, 'end')
      active -= 1
      return {
        dreamId: `${bankId}-run`,
        bankId,
        startedAt: '2026-10-09T12:00:00.000Z',
        endedAt: '2026-10-09T12:00:00.010Z',
        status: 'ok' as const,
        costUsd: 0,
        costIsEstimate: false,
      }
    },
  } as unknown as DreamRunner

  return { runner, counts, events, maxActive: () => maxActive }
}

function buildScheduler(
  banks: string[],
  current: { value: Date },
  readJournal?: (bankId: string) => Promise<MemoryDreamEvent[]>,
) {
  const fake = makeFakeRunner()
  const repo = { dreamBankIds: async () => banks } as unknown as MemoryRepoService
  const scheduler = new DreamScheduler({
    runner: fake.runner,
    repo,
    log: async () => {},
    config: () => ({ dreamIntervalHours: 4, dreamModel: 'gpt-4o-mini', dreamNotes: true }),
    tickMs: 2,
    now: () => current.value,
    ...(readJournal ? { readJournal } : {}),
  })
  schedulers.push(scheduler)
  return { scheduler, fake }
}

describe('DreamScheduler', () => {
  it('runs each bank at most once per interval and never overlaps runs', async () => {
    const current = { value: new Date('2026-10-09T12:00:00Z') }
    const { scheduler, fake } = buildScheduler(['main', 'ws:a'], current)

    await scheduler.tickOnce()
    expect(fake.counts.get('main')).toBe(1)
    expect(fake.counts.get('ws:a')).toBe(1)
    expect(fake.maxActive()).toBe(1)

    // No interleaving: every `start` is matched by an `end` before the next start.
    let open = false
    for (const event of fake.events) {
      if (event.kind === 'start') {
        expect(open).toBe(false)
        open = true
      } else if (event.kind === 'end') {
        expect(open).toBe(true)
        open = false
      }
    }

    // Further ticks inside the same window change nothing.
    await scheduler.tickOnce()
    await scheduler.tickOnce()
    expect(fake.counts.get('main')).toBe(1)
    expect(fake.counts.get('ws:a')).toBe(1)

    // Past the interval window a new run becomes eligible.
    current.value = new Date('2026-10-09T17:00:00Z')
    await scheduler.tickOnce()
    expect(fake.counts.get('main')).toBe(2)
    expect(fake.counts.get('ws:a')).toBe(2)
    expect(fake.maxActive()).toBe(1)
  })

  it('serializes a tick against a concurrent runNow (global mutex)', async () => {
    const { scheduler, fake } = buildScheduler(['main', 'ws:a'], { value: new Date('2026-10-09T12:00:00Z') })
    await Promise.all([scheduler.tickOnce(), scheduler.runNow('ws:a')])
    expect(fake.counts.get('main')).toBe(1)
    expect(fake.counts.get('ws:a')).toBe(2)
    expect(fake.maxActive()).toBe(1)
  })

  it('runNow works with a stopped scheduler', async () => {
    const { scheduler, fake } = buildScheduler(['main', 'ws:a'], { value: new Date('2026-10-09T12:00:00Z') })
    const run = await scheduler.runNow('main')
    expect(run.bankId).toBe('main')
    expect(fake.counts.get('main')).toBe(1)
    expect(fake.counts.get('ws:a')).toBeUndefined()
  })

  it('status folds in interval, model, pending notes and next run time', async () => {
    const { scheduler } = buildScheduler(['main'], { value: new Date('2026-10-09T12:00:00Z') })

    const before = await scheduler.status('main')
    expect(before.intervalHours).toBe(4)
    expect(before.model).toBe('gpt-4o-mini')
    expect(before.pendingNoteIds).toEqual(['n1.md'])
    expect(before.running).toBe(false)
    expect(before.nextRunAt).toBeNull()
    expect(before.lastRun).toBeNull()

    await scheduler.runNow('main')
    const after = await scheduler.status('main')
    expect(after.lastRun?.bankId).toBe('main')
    expect(after.nextRunAt).toBe('2026-10-09T16:00:00.000Z')
  })

  it('hydrates last-run/window state from the journal so a restart does not re-run the bank', async () => {
    const current = { value: new Date('2026-10-09T12:00:00Z') }
    const journal: MemoryDreamEvent[] = [
      {
        ts: '2026-10-09T09:00:00.000Z',
        dreamId: 'd1',
        bankId: 'main',
        kind: 'start',
        message: 'dream started (interval)',
        model: 'gpt-4o-mini',
      },
      {
        ts: '2026-10-09T09:00:04.000Z',
        dreamId: 'd1',
        bankId: 'main',
        kind: 'cost',
        message: 'note n1.md: $0.001000 (estimate)',
        costUsd: 0.001,
        inputTokens: 10,
        outputTokens: 20,
      },
      { ts: '2026-10-09T09:00:05.000Z', dreamId: 'd1', bankId: 'main', kind: 'end', message: 'dream ok' },
    ]
    const { scheduler, fake } = buildScheduler(['main', 'ws:a'], current, async (bankId) =>
      bankId === 'main' ? journal : [],
    )

    await scheduler.hydrate()

    const status = await scheduler.status('main')
    expect(status.lastRun?.dreamId).toBe('d1')
    expect(status.lastRun?.status).toBe('ok')
    expect(status.lastRun?.startedAt).toBe('2026-10-09T09:00:00.000Z')
    expect(status.lastRun?.endedAt).toBe('2026-10-09T09:00:05.000Z')
    expect(status.lastRun?.model).toBe('gpt-4o-mini')
    expect(status.lastRun?.costUsd).toBe(0.001)
    expect(status.lastRun?.costIsEstimate).toBe(true)
    // 09:00 + 4h window → next eligible at 13:00, and TODAY's cost survived.
    expect(status.nextRunAt).toBe('2026-10-09T13:00:00.000Z')
    expect(status.costTodayUsd).toBe(0.001)

    // `main` ran 3h ago → NOT eligible inside the window; `ws:a` has no journal → eligible.
    await scheduler.tickOnce()
    expect(fake.counts.get('main')).toBeUndefined()
    expect(fake.counts.get('ws:a')).toBe(1)
  })

  it('leaves a bank eligible when it has no journal history', async () => {
    const { scheduler, fake } = buildScheduler(['main'], { value: new Date('2026-10-09T12:00:00Z') }, async () => [])
    await scheduler.hydrate()

    const status = await scheduler.status('main')
    expect(status.lastRun).toBeNull()
    expect(status.nextRunAt).toBeNull()

    await scheduler.tickOnce()
    expect(fake.counts.get('main')).toBe(1)
  })

  it('never breaks bootstrap when the journal is unreadable', async () => {
    const { scheduler, fake } = buildScheduler(['main'], { value: new Date('2026-10-09T12:00:00Z') }, async () => {
      throw new Error('corrupt journal')
    })

    await scheduler.hydrate() // resolves, not rejects

    const status = await scheduler.status('main')
    expect(status.lastRun).toBeNull()
    await scheduler.tickOnce()
    expect(fake.counts.get('main')).toBe(1)
  })
})