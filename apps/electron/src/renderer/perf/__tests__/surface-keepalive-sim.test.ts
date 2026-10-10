/**
 * PERF-10 (#1577): the keep-alive/warm-up model must pass its own gate, and
 * the gate must have teeth — a smaller retention capacity or a skipped warm-up
 * shows up as a failed budget, not as a silent slowdown.
 */
import { describe, expect, it } from 'bun:test'
import { evaluateBudget } from '../evaluate'
import { gatedFailures } from '../evaluate'
import { summarizeDurations } from '../stats'
import {
  KEEPALIVE_WARM_SURFACES,
  SURFACE_RETAINED_PAINT_MS,
  SURFACE_WARM_FIRST_VISIT_MS,
  simulateSurfaceKeepAlive,
} from '../surface-sim'
import { PERF_BUDGETS } from '../budgets'
import { WARMUP_CPU_BUDGET_MS, WARMUP_SLICE_MS } from '../../lib/warmup'

const samplesNamed = async (
  name: 'surface_revisit' | 'surface_first_warm',
  input?: Parameters<typeof simulateSurfaceKeepAlive>[0],
) => (await simulateSurfaceKeepAlive(input)).samples.filter(sample => sample.name === name)

describe('surface keep-alive budget', () => {
  it('revisits five retained surfaces without a read and paints them from the kept tree', async () => {
    const samples = await samplesNamed('surface_revisit')
    expect(samples).toHaveLength(KEEPALIVE_WARM_SURFACES.length)
    expect(samples.every(sample => sample.durationMs === SURFACE_RETAINED_PAINT_MS)).toBe(true)
    expect(samples.every(sample => Object.keys(sample.ipc).length === 0)).toBe(true)

    const verdict = evaluateBudget('surface_revisit', samples)
    expect(verdict.passed).toBe(true)
    expect(verdict.gated).toBe(true)
    expect(summarizeDurations(samples.map(sample => sample.durationMs)).p95Ms).toBeLessThanOrEqual(
      PERF_BUDGETS.surface_revisit.p95Ms,
    )
  })

  it('fails the revisit budget when the retention capacity drops below five', async () => {
    const samples = await samplesNamed('surface_revisit', { capacity: 3 })
    const verdict = evaluateBudget('surface_revisit', samples)
    expect(verdict.passed).toBe(false)
    expect(verdict.reasons.some(reason => reason.includes('p95'))).toBe(true)
    expect(verdict.reasons.some(reason => reason.includes('sessions.messages'))).toBe(true)
  })

  it('fails both budgets when the shell never ran the warm-up', async () => {
    const first = await samplesNamed('surface_first_warm', { warmup: false })
    const firstVerdict = evaluateBudget('surface_first_warm', first)
    expect(firstVerdict.passed).toBe(false)
    expect(firstVerdict.reasons.some(reason => reason.includes('p95'))).toBe(true)
    expect(firstVerdict.reasons.some(reason => reason.includes('sessions.messages'))).toBe(true)

    const revisitVerdict = evaluateBudget('surface_revisit', await samplesNamed('surface_revisit', { warmup: false }))
    expect(revisitVerdict.passed).toBe(true)
  })

  it('warms up inside the slice and CPU budgets and paints a warm first visit', async () => {
    const simulation = await simulateSurfaceKeepAlive()
    expect(simulation.warmup.completed.length).toBeGreaterThan(0)
    expect(simulation.warmup.cancelledBy).toBeNull()
    expect(simulation.warmup.longestSliceMs).toBeLessThanOrEqual(WARMUP_SLICE_MS)
    expect(simulation.warmup.spentMs).toBeLessThan(WARMUP_CPU_BUDGET_MS)
    expect(simulation.retainedKeys).toEqual([...KEEPALIVE_WARM_SURFACES])

    const first = await samplesNamed('surface_first_warm')
    expect(first.every(sample => sample.durationMs === SURFACE_WARM_FIRST_VISIT_MS)).toBe(true)
    expect(first.every(sample => Object.keys(sample.ipc).length === 0)).toBe(true)
    expect(gatedFailures([evaluateBudget('surface_first_warm', first)])).toEqual([])
  })
})