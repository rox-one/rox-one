/**
 * The retained-set node budget is the bridge between the pure-JS perf harness
 * and the DOM the audit actually measured. These cases pin both directions: the
 * fixed policy stays inside the budget, and the pre-fix policy (count cap only)
 * demonstrably does not — so the gate cannot silently stop protecting anything.
 */
import { describe, expect, it } from 'bun:test'
import {
  AUDIT_ROUTE_WALK,
  MEASURED_SURFACE_NODE_WEIGHTS,
  evaluateRetainedNodeBudget,
  evaluateRetainedNodeBudgetGate,
  formatRetainedNodeReport,
  surfaceNodeWeight,
} from '../retained-node-budget'
import { SURFACE_KEEPALIVE_CAPACITY, SURFACE_KEEPALIVE_NODE_BUDGET } from '../../lib/surface-keepalive'

/** The audit's observation for the same route walk: this is what went wrong. */
const OBSERVED_RETAINED_NODES = 227_318

describe('evaluateRetainedNodeBudget', () => {
  it('keeps the audit route walk inside the node budget', () => {
    const verdict = evaluateRetainedNodeBudgetGate(SURFACE_KEEPALIVE_CAPACITY)
    expect(verdict.passed).toBe(true)
    expect(verdict.reasons).toEqual([])
    expect(verdict.nodeWeight).toBeLessThanOrEqual(SURFACE_KEEPALIVE_NODE_BUDGET)
    // Two orders of magnitude below what the running app reached.
    expect(verdict.nodeWeight).toBeLessThan(OBSERVED_RETAINED_NODES / 10)
    expect(verdict.retainedKeys.length).toBeLessThanOrEqual(SURFACE_KEEPALIVE_CAPACITY)
  })

  it('reproduces the regression when the count cap is the only bound', () => {
    // weightAware off is the pre-fix policy: LRU by count, weight invisible.
    const legacy = evaluateRetainedNodeBudget(AUDIT_ROUTE_WALK, SURFACE_KEEPALIVE_CAPACITY, {
      weightAware: false,
    })
    expect(legacy.nodeWeight).toBeGreaterThan(SURFACE_KEEPALIVE_NODE_BUDGET)
    expect(legacy.passed).toBe(false)
    expect(legacy.reasons.join(' ')).toContain('retained set')
    // The catalogs are what blow it up, and they survive the count cap.
    expect(legacy.heaviest?.key).toBe('settings/marketplace')
  })

  it('never retains more surfaces than the capacity allows', () => {
    const verdict = evaluateRetainedNodeBudget(AUDIT_ROUTE_WALK, 3)
    expect(verdict.retainedKeys.length).toBeLessThanOrEqual(3)
    expect(verdict.passed).toBe(true)
  })

  it('fires when the budget is genuinely exceeded', () => {
    const verdict = evaluateRetainedNodeBudget(['notes', 'sessions'], 5, { nodeBudget: 100 })
    expect(verdict.passed).toBe(false)
    expect(verdict.reasons.join(' ')).toContain('> budget 100')
  })

  it('treats an unmeasured route as an ordinary surface, never as free', () => {
    expect(surfaceNodeWeight('some/unknown/route')).toBeGreaterThan(0)
    expect(surfaceNodeWeight('skills')).toBe(MEASURED_SURFACE_NODE_WEIGHTS.skills)
  })

  it('names the heaviest retained surface in the report', () => {
    const text = formatRetainedNodeReport(evaluateRetainedNodeBudgetGate(SURFACE_KEEPALIVE_CAPACITY))
    expect(text).toContain('retained-set nodes:')
    expect(text).toContain('verdict:  pass')
  })
})
