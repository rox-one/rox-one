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

export type BudgetReservation = {
  operationId: string
  amount: number
  status: 'reserved' | 'settled' | 'unknown'
  settled?: number
}

export type BudgetReserveOk = {
  ok: true
  reservationId: string
  reserved: number
  remaining: number
}

export type BudgetReserveDenied = {
  ok: false
  code: 'cap-exceeded' | 'already-reserved' | 'invalid-amount'
  remaining: number
}

export class MeetingBudgetLedger {
  private readonly rows = new Map<string, BudgetReservation>()

  constructor(private readonly cap: number) {
    if (!Number.isFinite(cap) || cap < 0) throw new Error('Budget cap must be a non-negative number')
  }

  remaining(): number {
    return this.cap - this.held()
  }

  held(): number {
    let used = 0
    for (const row of this.rows.values()) {
      if (row.status === 'settled') used += row.settled ?? 0
      else used += row.amount
    }
    return used
  }

  get(operationId: string): BudgetReservation | undefined {
    const row = this.rows.get(operationId)
    return row ? { ...row } : undefined
  }

  reserve(operationId: string, amount: number): BudgetReserveOk | BudgetReserveDenied {
    if (!Number.isFinite(amount) || amount <= 0) {
      return { ok: false, code: 'invalid-amount', remaining: this.remaining() }
    }
    const existing = this.rows.get(operationId)
    if (existing && existing.status !== 'settled') {
      return { ok: false, code: 'already-reserved', remaining: this.remaining() }
    }
    const replaced = existing?.settled ?? 0
    if (this.held() - replaced + amount > this.cap) {
      return { ok: false, code: 'cap-exceeded', remaining: this.remaining() }
    }
    this.rows.set(operationId, { operationId, amount, status: 'reserved' })
    return { ok: true, reservationId: operationId, reserved: amount, remaining: this.remaining() }
  }

  settle(operationId: string, actual: number): BudgetReservation {
    const row = this.require(operationId)
    if (row.status === 'unknown') {
      throw new Error('unknown-budget-must-reconcile')
    }
    const settled = Math.max(0, actual)
    if (settled > this.cap) {
      throw new Error('settle-exceeds-cap')
    }
    const next: BudgetReservation = { ...row, status: 'settled', settled }
    this.rows.set(operationId, next)
    return { ...next }
  }

  markUnknown(operationId: string): BudgetReservation {
    const row = this.require(operationId)
    const next: BudgetReservation = { ...row, status: 'unknown' }
    this.rows.set(operationId, next)
    return { ...next }
  }

  reconcile(operationId: string, observed?: number): BudgetReservation {
    const row = this.require(operationId)
    if (row.status !== 'unknown' && observed === undefined) {
      return { ...row }
    }
    const settled = observed === undefined ? row.amount : Math.max(0, observed)
    const next: BudgetReservation = { ...row, status: 'settled', settled }
    this.rows.set(operationId, next)
    return { ...next }
  }

  private require(operationId: string): BudgetReservation {
    const row = this.rows.get(operationId)
    if (!row) throw new Error(`Unknown budget reservation ${operationId}`)
    return row
  }
}
