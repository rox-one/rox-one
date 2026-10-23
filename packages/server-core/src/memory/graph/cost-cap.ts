/**
 * Daily USD cost cap for LLM-heavy cognee work (cognify / insights).
 * Stored under `~/rox/memory/cognee/cost/<yyyy-mm-dd>.json` (process-wide, not
 * per-workspace) so a single user cannot exceed the cap across workspaces.
 *
 * Reservations are check-and-write in one step so concurrent rebuilds cannot
 * TOCTOU past the cap (single-process; file IO is sync).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

export const DEFAULT_GRAPH_DAILY_COST_CAP_USD = 2

export interface GraphCostLedger {
  day: string
  spentUsd: number
  cognifyCount: number
}

function dayKey(now = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10)
}

export function graphCostDir(roxHome = process.env.ROX_HOME || join(homedir(), 'rox')): string {
  return join(roxHome, 'memory', 'cognee', 'cost')
}

export function readGraphCostLedger(roxHome?: string, now = Date.now()): GraphCostLedger {
  const day = dayKey(now)
  const path = join(graphCostDir(roxHome), `${day}.json`)
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<GraphCostLedger>
    if (raw && raw.day === day && typeof raw.spentUsd === 'number') {
      return {
        day,
        spentUsd: Math.max(0, raw.spentUsd),
        cognifyCount: typeof raw.cognifyCount === 'number' ? Math.max(0, raw.cognifyCount) : 0,
      }
    }
  } catch {
    /* absent / corrupt → fresh day */
  }
  return { day, spentUsd: 0, cognifyCount: 0 }
}

export function writeGraphCostLedger(ledger: GraphCostLedger, roxHome?: string): void {
  const dir = graphCostDir(roxHome)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${ledger.day}.json`), JSON.stringify(ledger))
}

/** True when recording `addUsd` would stay at or under the cap. */
export function canSpendGraphUsd(
  addUsd: number,
  capUsd = DEFAULT_GRAPH_DAILY_COST_CAP_USD,
  roxHome?: string,
  now = Date.now(),
): boolean {
  if (!(addUsd >= 0) || !(capUsd >= 0)) return false
  const ledger = readGraphCostLedger(roxHome, now)
  return ledger.spentUsd + addUsd <= capUsd + 1e-9
}

/**
 * Atomically reserve `addUsd` against the daily cap.
 * Returns the updated ledger on success, or `null` if the cap would be exceeded
 * or inputs are invalid. Prefer this over canSpend+record to avoid TOCTOU.
 */
export function tryReserveGraphSpend(
  addUsd: number,
  capUsd = DEFAULT_GRAPH_DAILY_COST_CAP_USD,
  roxHome?: string,
  now = Date.now(),
): GraphCostLedger | null {
  if (!(addUsd >= 0) || !(capUsd >= 0)) return null
  const ledger = readGraphCostLedger(roxHome, now)
  if (ledger.spentUsd + addUsd > capUsd + 1e-9) return null
  ledger.spentUsd = Math.max(0, ledger.spentUsd + addUsd)
  ledger.cognifyCount += 1
  try {
    writeGraphCostLedger(ledger, roxHome)
  } catch {
    /* best-effort: still return reserved ledger so caller proceeds once */
  }
  return ledger
}

/** Record a spend; returns the updated ledger. No-op clamp if file IO fails. */
export function recordGraphSpend(
  addUsd: number,
  roxHome?: string,
  now = Date.now(),
): GraphCostLedger {
  const ledger = readGraphCostLedger(roxHome, now)
  ledger.spentUsd = Math.max(0, ledger.spentUsd + Math.max(0, addUsd))
  ledger.cognifyCount += 1
  try {
    writeGraphCostLedger(ledger, roxHome)
  } catch {
    /* best-effort */
  }
  return ledger
}

/** Conservative default estimate for one cognify call (USD). */
export const DEFAULT_COGNIFY_ESTIMATE_USD = 0.02
