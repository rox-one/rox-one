import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  DEFAULT_COGNIFY_ESTIMATE_USD,
  DEFAULT_GRAPH_DAILY_COST_CAP_USD,
  canSpendGraphUsd,
  readGraphCostLedger,
  recordGraphSpend,
  tryReserveGraphSpend,
} from '../cost-cap'

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) {
    try {
      rmSync(d, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  }
})

function home(): string {
  const d = mkdtempSync(join(tmpdir(), 'rox-graph-cost-'))
  dirs.push(d)
  return d
}

describe('graph cost cap', () => {
  test('fresh ledger starts at zero for the UTC day', () => {
    const h = home()
    const now = Date.parse('2026-10-23T12:00:00Z')
    const ledger = readGraphCostLedger(h, now)
    expect(ledger.day).toBe('2026-10-23')
    expect(ledger.spentUsd).toBe(0)
    expect(ledger.cognifyCount).toBe(0)
  })

  test('canSpend respects the daily cap', () => {
    const h = home()
    const now = Date.parse('2026-10-23T12:00:00Z')
    expect(canSpendGraphUsd(DEFAULT_COGNIFY_ESTIMATE_USD, DEFAULT_GRAPH_DAILY_COST_CAP_USD, h, now)).toBe(true)
    recordGraphSpend(DEFAULT_GRAPH_DAILY_COST_CAP_USD, h, now)
    expect(canSpendGraphUsd(DEFAULT_COGNIFY_ESTIMATE_USD, DEFAULT_GRAPH_DAILY_COST_CAP_USD, h, now)).toBe(false)
    expect(canSpendGraphUsd(0, DEFAULT_GRAPH_DAILY_COST_CAP_USD, h, now)).toBe(true)
  })

  test('recordGraphSpend accumulates and increments cognifyCount', () => {
    const h = home()
    const now = Date.parse('2026-10-23T12:00:00Z')
    recordGraphSpend(0.5, h, now)
    const a = recordGraphSpend(0.25, h, now)
    expect(a.spentUsd).toBeCloseTo(0.75, 6)
    expect(a.cognifyCount).toBe(2)
    expect(readGraphCostLedger(h, now).spentUsd).toBeCloseTo(0.75, 6)
  })

  test('new UTC day resets the ledger independently', () => {
    const h = home()
    recordGraphSpend(2, h, Date.parse('2026-10-22T23:00:00Z'))
    const next = readGraphCostLedger(h, Date.parse('2026-10-23T01:00:00Z'))
    expect(next.day).toBe('2026-10-23')
    expect(next.spentUsd).toBe(0)
  })

  test('rejects negative add or cap', () => {
    const h = home()
    expect(canSpendGraphUsd(-1, 2, h)).toBe(false)
    expect(canSpendGraphUsd(0.01, -1, h)).toBe(false)
    expect(tryReserveGraphSpend(-1, 2, h)).toBeNull()
  })

  test('tryReserveGraphSpend is atomic vs canSpend+later record', () => {
    const h = home()
    const now = Date.parse('2026-10-23T12:00:00Z')
    const a = tryReserveGraphSpend(1.9, 2, h, now)
    expect(a?.spentUsd).toBeCloseTo(1.9, 6)
    expect(tryReserveGraphSpend(0.2, 2, h, now)).toBeNull()
    expect(readGraphCostLedger(h, now).spentUsd).toBeCloseTo(1.9, 6)
    expect(tryReserveGraphSpend(0.1, 2, h, now)?.cognifyCount).toBe(2)
  })
})
