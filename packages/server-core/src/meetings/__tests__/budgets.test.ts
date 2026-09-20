import { describe, expect, it, test } from 'bun:test'
import { MeetingBudgetLedger, createBudget, remaining, reserve, settle } from '../observability.ts'

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
    expect(settle(ledger, 4, 'timeout').reason).toBe('timeout')
    expect(settle(ledger, 4, 'cancel').reason).toBe('canceled')
  })

  it('unknown settlement keeps the hold so the limit is not returned', () => {
    const ledger = createBudget(10)
    reserve(ledger, 5)
    expect(settle(ledger, 5, 'unknown').reason).toBe('unknown-settlement')
    expect(remaining(ledger)).toBe(5)
    expect(reserve(ledger, 6).ok).toBe(false)
  })

  it('exhaustion then cancel is explicit', () => {
    const ledger = createBudget(2)
    expect(reserve(ledger, 2).ok).toBe(true)
    expect(reserve(ledger, 1).reason).toBe('exhausted')
    expect(settle(ledger, 2, 'cancel').reason).toBe('canceled')
  })
})

describe('MeetingBudgetLedger (issue 386 / I030)', () => {
  test('parallel reserve does not exceed the cap', () => {
    const ledger = new MeetingBudgetLedger(10)
    const first = ledger.reserve('op-1', 6)
    const second = ledger.reserve('op-2', 6)
    const third = ledger.reserve('op-3', 4)
    expect(first.ok).toBe(true)
    expect(second.ok).toBe(false)
    if (!second.ok) expect(second.code).toBe('cap-exceeded')
    expect(third.ok).toBe(true)
    expect(ledger.remaining()).toBe(0)
  })

  test('unknown does not silently return budget', () => {
    const ledger = new MeetingBudgetLedger(20)
    expect(ledger.reserve('op-1', 8).ok).toBe(true)
    expect(ledger.markUnknown('op-1').status).toBe('unknown')
    expect(ledger.remaining()).toBe(12)
    expect(() => ledger.settle('op-1', 0)).toThrow('unknown-budget-must-reconcile')
    expect(ledger.remaining()).toBe(12)
    const reconciled = ledger.reconcile('op-1', 3)
    expect(reconciled.status).toBe('settled')
    expect(reconciled.settled).toBe(3)
    expect(ledger.remaining()).toBe(17)
  })

  test('settle after receipt frees unused tokens', () => {
    const ledger = new MeetingBudgetLedger(40)
    expect(ledger.reserve('op-a', 10).ok).toBe(true)
    expect(ledger.settle('op-a', 4).settled).toBe(4)
    expect(ledger.remaining()).toBe(36)
  })

  test('re-reserving a settled operation does not double count the old row', () => {
    const ledger = new MeetingBudgetLedger(10)
    expect(ledger.reserve('op-a', 10).ok).toBe(true)
    expect(ledger.settle('op-a', 8).settled).toBe(8)
    const again = ledger.reserve('op-a', 10)
    expect(again.ok).toBe(true)
    expect(ledger.remaining()).toBe(0)
  })
})
