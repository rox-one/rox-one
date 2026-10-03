import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AgentBudgetLedger } from '../agent-budget.ts'

const REMAINING_USD_TOLERANCE = 1e-12

const roots: string[] = []
const ledgers: AgentBudgetLedger[] = []
const openLedger = () => {
  const root = mkdtempSync(join(tmpdir(), 'agent-budget-'))
  roots.push(root)
  const ledger = new AgentBudgetLedger(join(root, 'budget.sqlite'))
  ledgers.push(ledger)
  return { root, ledger }
}

afterEach(() => {
  for (const ledger of ledgers.splice(0)) ledger.close()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('AgentBudgetLedger', () => {
  it('atomically reserves the remaining daily allowance across concurrent runs', () => {
    const { ledger } = openLedger()
    expect(ledger.reserve('workspace-a', 'run-a', 1, 0.7, 1_800_000)).not.toBeNull()
    expect(ledger.reserve('workspace-a', 'run-b', 1, 0.4, 1_800_001)).toBeNull()
    const snapshot = ledger.snapshot('workspace-a', 1, 1_800_001)
    expect(snapshot.reservedUsd).toBe(0.7)
    expect(Math.abs(snapshot.remainingUsd! - 0.3)).toBeLessThanOrEqual(REMAINING_USD_TOLERANCE)
  })

  it('settles provider usage once and releases the unused reservation only after completion', () => {
    const { ledger } = openLedger()
    ledger.reserve('workspace-a', 'run-a', 1, 0.8, 1_800_000)
    ledger.settleUsage('workspace-a', 'run-a', 'usage-1', 0.2, 1_800_100)
    ledger.settleUsage('workspace-a', 'run-a', 'usage-1', 0.2, 1_800_101)
    expect(ledger.snapshot('workspace-a', 1, 1_800_101)).toMatchObject({ spentUsd: 0.2, reservedUsd: 0.8 })
    ledger.complete('workspace-a', 'run-a', 1_800_200)
    expect(ledger.snapshot('workspace-a', 1, 1_800_200)).toMatchObject({ spentUsd: 0.2, reservedUsd: 0, remainingUsd: 0.8 })
    ledger.settleUsage('workspace-a', 'run-a', 'usage-1', 0.2, 1_800_201)
  })

  it('keeps a timed-out run unresolved and blocks another reservation until reconciliation', () => {
    const { ledger } = openLedger()
    ledger.reserve('workspace-a', 'run-a', 1, 1, 1_800_000)
    ledger.markUnresolved('workspace-a', 'run-a', 1_800_100)
    expect(ledger.reserve('workspace-a', 'run-b', 1, 0.01, 1_800_101)).toBeNull()
    ledger.reconcile('workspace-a', 'run-a', 'usage-1', 0.4, 1_800_200)
    expect(ledger.snapshot('workspace-a', 1, 1_800_200)).toMatchObject({ spentUsd: 0.4, unresolvedUsd: 0, remainingUsd: 0.6 })
  })

  it('recovers a process-crash reservation as unresolved rather than available budget', () => {
    const { root, ledger } = openLedger()
    ledger.reserve('workspace-a', 'run-a', 1, 1, 1_800_000)
    ledger.close()
    const recovered = new AgentBudgetLedger(join(root, 'budget.sqlite'))
    ledgers.push(recovered)
    expect(recovered.snapshot('workspace-a', 1, 1_800_001)).toMatchObject({ reservedUsd: 0, unresolvedUsd: 1, remainingUsd: 0 })
    expect(recovered.reserve('workspace-a', 'run-b', 1, 0.01, 1_800_001)).toBeNull()
  })

  it('isolates workspaces and resets the allowance at local midnight', () => {
    const { ledger } = openLedger()
    const start = new Date(2026, 8, 30, 12).getTime()
    ledger.reserve('workspace-a', 'run-a', 1, 1, start)
    ledger.complete('workspace-a', 'run-a', start)
    expect(ledger.snapshot('workspace-b', 2, start).remainingUsd).toBe(2)
    expect(ledger.snapshot('workspace-a', 1, new Date(2026, 9, 1, 0, 1).getTime()).remainingUsd).toBe(1)
  })
})
