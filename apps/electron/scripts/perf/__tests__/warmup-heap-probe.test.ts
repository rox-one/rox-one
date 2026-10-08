import { describe, expect, it } from 'bun:test'
import type { WarmupStatus } from '../../../src/renderer/lib/warmup'
import { WARMUP_HEAP_BUDGET_MB, WARMUP_LONG_TASK_MS, buildNote, heapDeltaMb, summarizeLongTasks } from '../warmup-heap-probe'

function status(overrides: Partial<WarmupStatus>): WarmupStatus {
  return { completed: [], failed: [], pending: [], cancelledBy: null, spentMs: 0, longestSliceMs: 0, running: false, ...overrides }
}

describe('warm-up probe metrics', () => {
  it('reports the heap delta in MB and refuses half-readings', () => {
    expect(heapDeltaMb(100 * 1024 * 1024, 117.5 * 1024 * 1024)).toBe(17.5)
    expect(heapDeltaMb(120 * 1024 * 1024, 100 * 1024 * 1024)).toBe(-20)
    expect(heapDeltaMb(null, 1024)).toBeNull()
    expect(heapDeltaMb(1024, null)).toBeNull()
  })

  it('counts only long tasks strictly above the 50 ms bound', () => {
    const summary = summarizeLongTasks({
      tasks: [{ startMs: 10, durationMs: 50 }, { startMs: 20, durationMs: 51.4 }, { startMs: 30, durationMs: 120.6 }],
      observedFromMs: 1000.4,
      installs: 1,
      supported: true,
    })
    expect(summary?.count).toBe(3)
    expect(summary?.over50Ms).toBe(2)
    expect(summary?.longestMs).toBe(120.6)
    expect(summary?.observedFromMs).toBe(1000)
    expect(summarizeLongTasks({ tasks: [], observedFromMs: null, installs: 0, supported: false })).toBeNull()
  })

  it('spells out the terminal queue, the criteria and the measurement boundary', () => {
    const note = buildNote({
      warmup: status({ completed: ['sessions-meta'], failed: ['calendar'], pending: ['route-chunks'], cancelledBy: 'budget', spentMs: 1500.2, longestSliceMs: 6.25 }),
      hookPresent: true,
      heapDeltaMb: 18.4,
      heapSource: 'cdp',
      heapBaselineMb: 140.2,
      heapBaselineAtMs: 900,
      longTasks: { count: 0, over50Ms: 0, longestMs: 0, observedFromMs: 950, installs: 1 },
      retainedSurfaces: 3,
      waitMs: 8_200,
    })
    expect(note).toContain('queue 1/3 steps (failed: calendar), cancelled by budget')
    expect(note).toContain('cpu 1500 ms of 1500 ms')
    expect(note).toContain(`longest slice 6.3 ms of ${WARMUP_LONG_TASK_MS} ms`)
    expect(note).toContain(`heap +18.4 MB of ${WARMUP_HEAP_BUDGET_MB} MB`)
    expect(note).toContain('V8 usedSize after forced GC')
    expect(note).toContain('3 retained surface pane(s) mounted')
  })

  it('names the stale build, the unmeasured heap and partial long-task coverage instead of guessing', () => {
    const stale = buildNote({
      warmup: null, hookPresent: false, heapDeltaMb: null, heapSource: null, heapBaselineMb: null,
      heapBaselineAtMs: null, longTasks: null, retainedSurfaces: null, waitMs: 30_000,
    })
    expect(stale).toContain('no window.__roxWarmup')
    expect(stale).toContain('heap delta unavailable')
    expect(stale).toContain('long tasks not observed')

    const partial = buildNote({
      warmup: status({ completed: ['sessions-meta', 'transcript-tails', 'notes-tasks', 'skills-sources', 'agent-profiles', 'inbox-feed', 'calendar', 'route-chunks'], spentMs: 300, longestSliceMs: 3 }),
      hookPresent: true,
      heapDeltaMb: -2.5,
      heapSource: 'performance.memory',
      heapBaselineMb: 150,
      heapBaselineAtMs: 700,
      longTasks: { count: 4, over50Ms: 1, longestMs: 60, observedFromMs: 800, installs: 2 },
      retainedSurfaces: 1,
      waitMs: 5_000,
    })
    expect(partial).toContain('queue 8/8 steps;')
    expect(partial).toContain('performance.memory, not GC-forced')
    expect(partial).toContain(`1 long task(s) > ${WARMUP_LONG_TASK_MS} ms`)
    expect(partial).toContain('2 observer installs — entries may be partial')
  })
})