import { describe, expect, it } from 'bun:test'
import {
  createMemoryMoneyStore,
  release,
  reserve,
  settle,
  topUp,
  type Account,
  type MemoryMoneyStore,
} from '../entitlement.ts'
import { checkAccountLimits } from '../limits.ts'
import { reconcileUsage } from '../reconciliation.ts'
import { provisionSandbox, type PaidEntitlement, type PaidProvisionRuntime } from '../daytona-sandbox.ts'
import { CloudRunnerError } from '../types.ts'

function account(overrides: Partial<Account> = {}): Account {
  return {
    id: 'acc_1',
    paid: true,
    balanceCents: 0,
    reservedCents: 0,
    monthlyCapCents: 0,
    monthSpentCents: 0,
    ...overrides,
  }
}

function seeded(overrides: Partial<Account> = {}) {
  const store = createMemoryMoneyStore()
  store.saveAccount(account(overrides))
  return store
}

function reserveOk(store: MemoryMoneyStore, cents: number, ref: string): void {
  const result = reserve(store, 'acc_1', cents, ref, 2)
  if (!result.ok) throw new Error(result.error)
}

describe('wallet ledger', () => {
  it('tops up, then reserves against the paid balance', () => {
    const store = seeded()
    const top = topUp(store, 'acc_1', 1000, 1)
    expect(top.account.balanceCents).toBe(1000)
    expect(top.entries).toHaveLength(2)

    const held = reserve(store, 'acc_1', 250, 'sbx_1', 2)
    if (!held.ok) throw new Error(held.error)
    expect(held.entry.kind).toBe('reserve')
    expect(held.entry.counterparty).toBe('reserve')
    expect(held.entry.amountCents).toBe(250)
    expect(held.entry.ref).toBe('sbx_1')
    expect(held.entry.balanceAfterCents).toBe(750)
    expect(held.entry.reservedAfterCents).toBe(250)

    expect(store.getAccount('acc_1')).toMatchObject({ balanceCents: 750, reservedCents: 250 })
    expect(store.findReservation('acc_1', 'sbx_1')).toBe(250)
    expect(store.listReservations('acc_1')).toEqual([{ ref: 'sbx_1', cents: 250 }])
  })

  it('refuses unpaid accounts, an empty wallet and the monthly cap', () => {
    const unpaid = seeded({ paid: false, balanceCents: 5000 })
    expect(reserve(unpaid, 'acc_1', 100, 'sbx_1', 1)).toEqual({
      ok: false,
      error: 'entitlement_required',
    })

    const poor = seeded({ balanceCents: 100 })
    expect(reserve(poor, 'acc_1', 500, 'sbx_1', 1)).toEqual({
      ok: false,
      error: 'insufficient_balance',
    })
    expect(poor.getAccount('acc_1')?.balanceCents).toBe(100)

    const capped = seeded({ balanceCents: 5000, monthlyCapCents: 1000, monthSpentCents: 900 })
    expect(reserve(capped, 'acc_1', 200, 'sbx_1', 1)).toEqual({
      ok: false,
      error: 'budget_exceeded',
    })
    expect(capped.findReservation('acc_1', 'sbx_1')).toBeUndefined()
  })

  it('settles: releases the hold and debits only the actual amount', () => {
    const store = seeded({ balanceCents: 1000 })
    reserveOk(store, 400, 'sbx_1')

    const result = settle(store, 'acc_1', 'sbx_1', 250, 3)
    expect(result.chargedCents).toBe(250)
    expect(result.shortfallCents).toBe(0)
    expect(result.account.balanceCents).toBe(750)
    expect(result.account.reservedCents).toBe(0)
    expect(result.account.monthSpentCents).toBe(250)
    expect(store.findReservation('acc_1', 'sbx_1')).toBeUndefined()
    expect(store.listReservations('acc_1')).toEqual([])
  })

  it('settles beyond the balance down to zero and records the shortfall', () => {
    const store = seeded({ balanceCents: 100 })
    reserveOk(store, 100, 'sbx_1')

    const result = settle(store, 'acc_1', 'sbx_1', 300, 3)
    expect(result.chargedCents).toBe(100)
    expect(result.shortfallCents).toBe(200)
    expect(result.account.balanceCents).toBe(0)
    expect(result.account.monthSpentCents).toBe(100)
    const settleRows = result.entries.filter((entry) => entry.kind === 'settle')
    expect(settleRows).toHaveLength(2)
    expect(settleRows.every((entry) => entry.shortfallCents === 200)).toBe(true)
  })

  it('releases the hold without charging, and repeats safely', () => {
    const store = seeded({ balanceCents: 1000 })
    reserveOk(store, 300, 'sbx_1')
    expect(store.getAccount('acc_1')?.balanceCents).toBe(700)

    const once = release(store, 'acc_1', 'sbx_1', 3)
    expect(once.account.balanceCents).toBe(1000)
    expect(once.account.reservedCents).toBe(0)
    expect(once.entries).toHaveLength(2)

    const twice = release(store, 'acc_1', 'sbx_1', 4)
    expect(twice.entries).toEqual([])
    expect(twice.account.balanceCents).toBe(1000)
  })

  it('writes double-entry pairs whose sums match the account', () => {
    const store = seeded()
    topUp(store, 'acc_1', 1000, 1)
    reserveOk(store, 400, 'sbx_1')
    settle(store, 'acc_1', 'sbx_1', 250, 3)
    topUp(store, 'acc_1', 500, 4)
    reserveOk(store, 200, 'sbx_2')
    release(store, 'acc_1', 'sbx_2', 5)

    const ledger = store.listLedger('acc_1')
    const wallet = store.getAccount('acc_1')
    if (!wallet) throw new Error('account vanished')
    const bucket = (counterparty: string) =>
      ledger
        .filter((entry) => entry.counterparty === counterparty)
        .reduce((total, entry) => total + entry.amountCents, 0)

    expect(bucket('customer')).toBe(wallet.balanceCents)
    expect(bucket('reserve')).toBe(wallet.reservedCents)
    expect(bucket('revenue')).toBe(-(wallet.balanceCents + wallet.reservedCents))
    expect(ledger.reduce((total, entry) => total + entry.amountCents, 0)).toBe(0)

    expect(ledger.length % 2).toBe(0)
    for (let index = 0; index < ledger.length; index += 2) {
      const debit = ledger[index]!
      const credit = ledger[index + 1]!
      expect(debit.counterparty).toBe('customer')
      expect(debit.amountCents + credit.amountCents).toBe(0)
      expect(credit.id).not.toBe(debit.id)
    }
  })

  it('rejects negative, fractional and unknown-account money with provider_error', () => {
    const store = seeded()
    expect(() => topUp(store, 'acc_1', -1, 1)).toThrow(CloudRunnerError)
    expect(() => topUp(store, 'acc_1', 10.5, 1)).toThrow(CloudRunnerError)
    expect(() => topUp(store, 'missing', 100, 1)).toThrow(CloudRunnerError)

    try {
      topUp(store, 'acc_1', -1, 1)
      throw new Error('expected a refusal')
    } catch (error) {
      expect(error).toBeInstanceOf(CloudRunnerError)
      expect((error as CloudRunnerError).code).toBe('provider_error')
    }
  })
})

describe('account limits', () => {
  const limits = { maxConcurrentSandboxes: 2, maxCpuPerSandbox: 4, maxMonthlyCents: 1000 }

  it('refuses each axis on its own', () => {
    expect(
      checkAccountLimits({
        limits,
        activeCount: 2,
        requestedCpu: 1,
        monthSpentCents: 0,
        requestedReserveCents: 10,
      }),
    ).toBe('concurrency_exceeded')

    expect(
      checkAccountLimits({
        limits,
        activeCount: 1,
        requestedCpu: 8,
        monthSpentCents: 0,
        requestedReserveCents: 10,
      }),
    ).toBe('sandbox_too_large')

    expect(
      checkAccountLimits({
        limits,
        activeCount: 0,
        requestedCpu: 1,
        monthSpentCents: 900,
        requestedReserveCents: 200,
      }),
    ).toBe('monthly_cap_exceeded')
  })

  it('allows a request inside every ceiling, and treats zero as unlimited', () => {
    expect(
      checkAccountLimits({
        limits,
        activeCount: 1,
        requestedCpu: 4,
        monthSpentCents: 900,
        requestedReserveCents: 100,
      }),
    ).toBeNull()

    expect(
      checkAccountLimits({
        limits: { maxConcurrentSandboxes: 0, maxCpuPerSandbox: 0, maxMonthlyCents: 0 },
        activeCount: 9999,
        requestedCpu: 9999,
        monthSpentCents: 9999,
        requestedReserveCents: 9999,
      }),
    ).toBeNull()
  })
})

describe('usage reconciliation', () => {
  it('shows a 7 percent drift, a matched row and both missing sides', () => {
    const ours = [
      { ref: 'sbx_a', provider: 'daytona', amountCents: 10_700 },
      { ref: 'sbx_b', provider: 'daytona', amountCents: 500 },
      { ref: 'sbx_c', provider: 'daytona', amountCents: 300 },
    ]
    const theirs = [
      { ref: 'sbx_a', provider: 'daytona', amountCents: 10_000 },
      { ref: 'sbx_b', provider: 'daytona', amountCents: 500 },
      { ref: 'sbx_d', provider: 'daytona', amountCents: 200 },
    ]

    const result = reconcileUsage(ours, theirs)
    expect(result.oursCents).toBe(11_500)
    expect(result.theirsCents).toBe(10_700)
    expect(result.driftPct).toBe(7.48)
    expect(result.matched).toEqual(['sbx_b'])
    expect(result.missingInProvider).toEqual(['sbx_c'])
    expect(result.missingInOurs).toEqual(['sbx_d'])
    expect(result.drifted).toEqual([
      { ref: 'sbx_a', oursCents: 10_700, theirsCents: 10_000, driftPct: 7 },
    ])
  })

  it('keeps small differences inside the tolerance', () => {
    const result = reconcileUsage(
      [{ ref: 'sbx_a', provider: 'daytona', amountCents: 10_400 }],
      [{ ref: 'sbx_a', provider: 'daytona', amountCents: 10_000 }],
    )
    expect(result.drifted).toEqual([])
    expect(result.matched).toEqual(['sbx_a'])
    expect(result.driftPct).toBe(4)
  })
})

describe('platform fee reservation', () => {
  const entitlement: PaidEntitlement = {
    accountId: 'acc_1',
    paid: true,
    budgetUsd: 20,
    usedUsd: 0,
    inactivityTtlMs: 60_000,
  }

  function runtime(store: MemoryMoneyStore, rateCentsPerHour: number): PaidProvisionRuntime {
    return {
      store,
      limits: { maxConcurrentSandboxes: 0, maxCpuPerSandbox: 0, maxMonthlyCents: 0 },
      featureEnabled: true,
      now: 1_000,
      rateCentsPerHour,
    }
  }

  it('reserves ceil(ttlMs / 3_600_000 * rateCentsPerHour)', () => {
    const store = seeded({ balanceCents: 10_000 })
    const ttlMs = 90_000
    const rateCentsPerHour = 125
    const result = provisionSandbox(entitlement, runtime(store, rateCentsPerHour), {
      id: 'sbx_fee',
      cpu: 1,
      ttlMs,
    })
    if (!result.ok) throw new Error(result.error)
    expect(store.findReservation('acc_1', 'sbx_fee')).toBe(
      Math.ceil((ttlMs / 3_600_000) * rateCentsPerHour),
    )
    expect(store.findReservation('acc_1', 'sbx_fee')).toBe(4)
  })

  it('never reserves provider compute cost, only the fee the caller set', () => {
    const store = seeded({ balanceCents: 10_000 })
    const result = provisionSandbox(entitlement, runtime(store, 50), {
      id: 'sbx_fee',
      cpu: 8,
      memoryGb: 32,
      ttlMs: 3_600_000,
    })
    if (!result.ok) throw new Error(result.error)
    expect(store.findReservation('acc_1', 'sbx_fee')).toBe(50)
  })

  it('refuses a create when the fee rate is not positive integer cents', () => {
    const store = seeded({ balanceCents: 10_000 })
    expect(() =>
      provisionSandbox(entitlement, runtime(store, 0), { id: 'sbx_fee', cpu: 1, ttlMs: 60_000 }),
    ).toThrow(CloudRunnerError)
    expect(() =>
      provisionSandbox(entitlement, runtime(store, 2.5), { id: 'sbx_fee', cpu: 1, ttlMs: 60_000 }),
    ).toThrow(CloudRunnerError)
  })
})
