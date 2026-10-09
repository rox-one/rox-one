/**
 * DreamCostTracker — pricing, estimation flag and the per-bank daily ledger.
 * Acceptance: known model + usage → exact USD; unknown model or missing usage
 * → `estimated:true`; missing usage approximates ≈4 chars/token.
 */
import { describe, expect, it } from 'bun:test'
import { DreamCostTracker, estimateTokens } from '../DreamCostTracker'

describe('DreamCostTracker', () => {
  it('prices a known model exactly from a usage block', () => {
    const tracker = new DreamCostTracker()
    const result = tracker.cost('gpt-4o-mini', { inputTokens: 1_000_000, outputTokens: 1_000_000 })
    expect(result.estimated).toBe(false)
    expect(result.usd).toBeCloseTo(0.15 + 0.6, 6)
  })

  it('prices partial usage (input only) exactly', () => {
    const tracker = new DreamCostTracker({ 'test-model': { inPerM: 2, outPerM: 8 } })
    const result = tracker.cost('test-model', { inputTokens: 500_000 })
    expect(result.estimated).toBe(false)
    expect(result.usd).toBeCloseTo(1, 6)
  })

  it('marks an unknown model as an estimate', () => {
    const tracker = new DreamCostTracker()
    const result = tracker.cost('totally-unknown-model', { inputTokens: 1000, outputTokens: 1000 })
    expect(result.estimated).toBe(true)
    expect(result.usd).toBe(0)
  })

  it('marks missing usage as an estimate', () => {
    const tracker = new DreamCostTracker()
    const result = tracker.cost('gpt-4o-mini', {})
    expect(result.estimated).toBe(true)
    expect(result.usd).toBe(0)
  })

  it('approximates tokens at about 4 chars/token', () => {
    expect(estimateTokens('')).toBe(0)
    expect(estimateTokens('abcd')).toBe(1)
    expect(estimateTokens('abcde')).toBe(2)
  })

  it('costFromText is always an estimate and fills token counts', () => {
    const tracker = new DreamCostTracker()
    const result = tracker.costFromText('gpt-4o-mini', 'a'.repeat(400), 'b'.repeat(800))
    expect(result.estimated).toBe(true)
    expect(result.inputTokens).toBe(100)
    expect(result.outputTokens).toBe(200)
    expect(result.usd).toBeGreaterThan(0)
  })

  it('accumulates per-bank totals for the current UTC day only', () => {
    const tracker = new DreamCostTracker()
    const now = new Date('2026-10-09T10:00:00Z')
    tracker.record('main', 0.5, '2026-10-09T09:00:00Z')
    tracker.record('main', 0.25, '2026-10-09T09:30:00Z', true)
    tracker.record('ws:a', 1, '2026-10-09T09:00:00Z')
    tracker.record('main', 9, '2026-10-08T09:00:00Z')

    expect(tracker.todayTotal('main', now)).toBeCloseTo(0.75, 6)
    expect(tracker.todayTotal('ws:a', now)).toBeCloseTo(1, 6)
    expect(tracker.todayTotal('ws:b', now)).toBe(0)
    expect(tracker.todaySummary('main', now).estimated).toBe(true)
    expect(tracker.todaySummary('ws:a', now).estimated).toBe(false)
  })

  it('ignores malformed records', () => {
    const tracker = new DreamCostTracker()
    tracker.record('', 1, '2026-10-09T09:00:00Z')
    tracker.record('main', Number.NaN, '2026-10-09T09:00:00Z')
    tracker.record('main', -5, '2026-10-09T09:00:00Z')
    expect(tracker.todayTotal('main', new Date('2026-10-09T10:00:00Z'))).toBe(0)
  })
})