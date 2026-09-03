import { describe, expect, it } from 'bun:test'
import { CACHED_SESSION_SWITCH_P95_MS } from '../budgets'
import { createSessionFixture } from '../fixtures'
import { IpcCallCounter } from '../ipc-counter'
import { evaluateBudget } from '../evaluate'
import { summarizeDurations } from '../stats'
import {
  pickSwitchTargets,
  switchCachedSession,
  switchWithFullReload,
  warmRendererCache,
} from '../switch-sim'
import type { BenchmarkSample } from '../types'

describe('cached session switch budget', () => {
  it('meets p95 < 120ms on a warm 2,000-session cache without a collection reload', () => {
    const fixture = createSessionFixture(2000)
    const cache = warmRendererCache(fixture.sessions)
    const ipc = new IpcCallCounter()
    const samples: BenchmarkSample[] = []

    for (const sessionId of pickSwitchTargets(cache, 60)) {
      const result = switchCachedSession(cache, sessionId, ipc)
      samples.push({
        name: 'cached_session_switch',
        durationMs: result.durationMs,
        ipc: result.ipc,
        reloadedCollection: result.reloadedCollection,
      })
    }

    const stats = summarizeDurations(samples.map((sample) => sample.durationMs))
    const verdict = evaluateBudget('cached_session_switch', samples)

    expect(fixture.sessions).toHaveLength(2000)
    expect(cache.byId.size).toBe(2000)
    expect(stats.p95Ms).toBeLessThan(CACHED_SESSION_SWITCH_P95_MS)
    expect(samples.every((sample) => sample.reloadedCollection === false)).toBe(true)
    expect(samples.every((sample) => (sample.ipc['sessions.list'] ?? 0) === 0)).toBe(true)
    expect(verdict.passed).toBe(true)
    expect(verdict.gated).toBe(true)
    expect(ipc.detectSessionMetadataNPlusOne(2000)).toEqual([])
  })

  it('fails the budget when a switch reloads the full collection', () => {
    const fixture = createSessionFixture(500)
    const ipc = new IpcCallCounter()
    const result = switchWithFullReload(fixture.sessions, fixture.sessions[1]!.id, ipc)
    const verdict = evaluateBudget('cached_session_switch', [{
      name: 'cached_session_switch',
      durationMs: result.durationMs,
      ipc: result.ipc,
      reloadedCollection: result.reloadedCollection,
    }])

    expect(result.reloadedCollection).toBe(true)
    expect(verdict.passed).toBe(false)
    expect(verdict.reasons.some((reason) => reason.includes('collection reloads'))).toBe(true)
    expect(ipc.detectSessionMetadataNPlusOne(500).length).toBeGreaterThan(0)
  })
})
