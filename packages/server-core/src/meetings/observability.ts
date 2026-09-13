/**
 * RMA-I030 / #386 — budget reserve/settle/reconcile.
 * Parallel reserves cannot exceed the cap. Unknown settlement does not silently restore quota.
 */

export type BudgetLedger = {
  cap: number
  reserved: number
  settled: number
  unknown: number
}

export function createBudget(cap: number): BudgetLedger {
  return { cap, reserved: 0, settled: 0, unknown: 0 }
}

export type BudgetResult =
  | { ok: true; reserved: number }
  | { ok: false; reason: 'exhausted' | 'unknown-settlement' | 'canceled' | 'timeout' }

export function reserve(ledger: BudgetLedger, amount: number): BudgetResult {
  if (ledger.reserved + ledger.unknown + amount > ledger.cap) {
    return { ok: false, reason: 'exhausted' }
  }
  ledger.reserved += amount
  return { ok: true, reserved: amount }
}

export function settle(ledger: BudgetLedger, amount: number, kind: 'ok' | 'timeout' | 'unknown' | 'cancel'): BudgetResult {
  if (kind === 'timeout') return { ok: false, reason: 'timeout' }
  if (kind === 'cancel') {
    ledger.reserved = Math.max(0, ledger.reserved - amount)
    return { ok: false, reason: 'canceled' }
  }
  if (kind === 'unknown') {
    ledger.unknown += amount
    ledger.reserved = Math.max(0, ledger.reserved - amount)
    return { ok: false, reason: 'unknown-settlement' }
  }
  ledger.settled += amount
  ledger.reserved = Math.max(0, ledger.reserved - amount)
  return { ok: true, reserved: 0 }
}

export function remaining(ledger: BudgetLedger): number {
  return ledger.cap - ledger.settled - ledger.reserved - ledger.unknown
}
