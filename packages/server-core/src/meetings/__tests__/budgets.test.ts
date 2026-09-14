import { describe, expect, it } from 'bun:test'
import { createBudget, remaining, reserve, settle } from '../observability.ts'

describe('meeting budgets (#386)', () => {
  it('rejects concurrent reserves that would exceed the cap', () => {
    const ledger = createBudget(10)
    expect(reserve(ledger, 6).ok).toBe(true)
    expect(reserve(ledger, 6).ok).toBe(false)
    expect(remaining(ledger)).toBe(4)
  })

  it('timeout and cancel do not silently restore unknown spend', () => {
    const ledger = createBudget(10)
    reserve(ledger, 4)
    expect(settle(ledger, 4, 'timeout')).toEqual({ ok: false, reason: 'timeout' })
    expect(settle(ledger, 4, 'cancel')).toEqual({ ok: false, reason: 'canceled' })
  })

  it('unknown settlement keeps the hold so the limit is not returned', () => {
    const ledger = createBudget(10)
    reserve(ledger, 5)
    expect(settle(ledger, 5, 'unknown')).toEqual({ ok: false, reason: 'unknown-settlement' })
    expect(remaining(ledger)).toBe(5)
    expect(reserve(ledger, 6).ok).toBe(false)
  })

  it('exhaustion then cancel is explicit', () => {
    const ledger = createBudget(2)
    expect(reserve(ledger, 2).ok).toBe(true)
    expect(reserve(ledger, 1)).toEqual({ ok: false, reason: 'exhausted' })
    expect(settle(ledger, 2, 'cancel')).toEqual({ ok: false, reason: 'canceled' })
  })
})
