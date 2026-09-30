import { chmodSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export type AgentBudgetRunState = 'reserved' | 'unresolved' | 'settled' | 'released'

export interface AgentBudgetSnapshot {
  limitUsd: number | null
  spentUsd: number
  reservedUsd: number
  unresolvedUsd: number
  remainingUsd: number | null
  exhausted: boolean
}

export interface AgentBudgetReservation {
  workspaceId: string
  runId: string
  periodStart: number
  reservedUsd: number
  state: AgentBudgetRunState
}

/** Durable, workspace-isolated daily USD ledger for local agent dispatches. */
export class AgentBudgetLedger {
  private readonly db: DatabaseSync
  private closed = false

  constructor(databasePath: string) {
    mkdirSync(dirname(databasePath), { recursive: true, mode: 0o700 })
    this.db = new DatabaseSync(databasePath)
    chmodSync(databasePath, 0o600)
    this.db.exec(`
      PRAGMA foreign_keys = ON;
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = FULL;
      CREATE TABLE IF NOT EXISTS agent_budget_runs (
        workspace_id TEXT NOT NULL,
        run_id TEXT NOT NULL,
        period_start INTEGER NOT NULL,
        reserved_usd REAL NOT NULL CHECK(reserved_usd >= 0),
        state TEXT NOT NULL CHECK(state IN ('reserved','unresolved','settled','released')),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY(workspace_id, run_id)
      );
      CREATE TABLE IF NOT EXISTS agent_budget_usage (
        workspace_id TEXT NOT NULL,
        run_id TEXT NOT NULL,
        usage_id TEXT NOT NULL,
        cost_usd REAL NOT NULL CHECK(cost_usd >= 0),
        created_at INTEGER NOT NULL,
        PRIMARY KEY(workspace_id, run_id, usage_id),
        FOREIGN KEY(workspace_id, run_id) REFERENCES agent_budget_runs(workspace_id, run_id)
      );
      CREATE INDEX IF NOT EXISTS agent_budget_usage_period
        ON agent_budget_runs(workspace_id, period_start, state);
    `)
    this.db.prepare(`
      UPDATE agent_budget_runs
      SET state='unresolved', updated_at=?
      WHERE state='reserved'
    `).run(Date.now())
  }


  /** Reserve the caller's maximum possible spend before dispatch; null means disabled or denied. */
  reserve(workspaceId: string, runId: string, limitUsd: number | null, reserveUsd: number, now = Date.now()): AgentBudgetReservation | null {
    this.assertOpen()
    this.assertLimit(limitUsd)
    if (!workspaceId || !runId) throw new Error('workspaceId and runId are required')
    if (limitUsd === null) return null
    if (!Number.isFinite(reserveUsd) || reserveUsd <= 0) throw new Error('reservation must be a finite positive USD amount')
    const periodStart = localDayStart(now)
    return this.transaction(() => {
      const existing = this.getRun(workspaceId, runId)
      if (existing) {
        if (existing.periodStart !== periodStart || existing.reservedUsd !== reserveUsd) {
          throw new Error('run id was already reserved with different budget terms')
        }
        if (existing.state === 'reserved') return existing
        return null
      }
      const snapshot = this.readSnapshot(workspaceId, limitUsd, now)
      if (snapshot.remainingUsd === null || reserveUsd > snapshot.remainingUsd) return null
      this.db.prepare(`
        INSERT INTO agent_budget_runs(workspace_id, run_id, period_start, reserved_usd, state, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'reserved', ?, ?)
      `).run(workspaceId, runId, periodStart, reserveUsd, now, now)
      return { workspaceId, runId, periodStart, reservedUsd: reserveUsd, state: 'reserved' }
    })
  }

  /** Record a provider-reported incremental usage event once. */
  settleUsage(workspaceId: string, runId: string, usageId: string, costUsd: number, now = Date.now()): void {
    this.assertUsage(workspaceId, runId, usageId, costUsd)
    this.transaction(() => {
      const run = this.getRun(workspaceId, runId)
      const prior = this.db.prepare(`SELECT cost_usd FROM agent_budget_usage WHERE workspace_id=? AND run_id=? AND usage_id=?`).get(workspaceId, runId, usageId) as { cost_usd: number } | undefined
      if (prior) {
        if (prior.cost_usd !== costUsd) throw new Error('usage id was replayed with different cost')
        return
      }
      if (!run || (run.state !== 'reserved' && run.state !== 'unresolved')) throw new Error('run has no settleable reservation')
      this.db.prepare(`INSERT INTO agent_budget_usage(workspace_id, run_id, usage_id, cost_usd, created_at) VALUES (?, ?, ?, ?, ?)`).run(workspaceId, runId, usageId, costUsd, now)
    })
  }

  complete(workspaceId: string, runId: string, now = Date.now()): void {
    this.transition(workspaceId, runId, 'settled', now, ['reserved', 'unresolved'])
  }

  markUnresolved(workspaceId: string, runId: string, now = Date.now()): void {
    this.transition(workspaceId, runId, 'unresolved', now, ['reserved', 'unresolved'])
  }

  /** Reconciliation reports total actual cost; prior incremental events are replaced by one immutable receipt. */
  reconcile(workspaceId: string, runId: string, usageId: string, totalCostUsd: number, now = Date.now()): void {
    this.assertUsage(workspaceId, runId, usageId, totalCostUsd)
    this.transaction(() => {
      const run = this.getRun(workspaceId, runId)
      if (!run) throw new Error('run is not awaiting reconciliation')
      const prior = this.db.prepare(`SELECT cost_usd FROM agent_budget_usage WHERE workspace_id=? AND run_id=? AND usage_id=?`).get(workspaceId, runId, usageId) as { cost_usd: number } | undefined
      if (prior) {
        if (prior.cost_usd !== totalCostUsd) throw new Error('reconciliation id was replayed with different cost')
        return
      }
      if (run.state !== 'reserved' && run.state !== 'unresolved') throw new Error('run is not awaiting reconciliation')
      this.db.prepare('DELETE FROM agent_budget_usage WHERE workspace_id=? AND run_id=?').run(workspaceId, runId)
      this.db.prepare(`INSERT INTO agent_budget_usage(workspace_id, run_id, usage_id, cost_usd, created_at) VALUES (?, ?, ?, ?, ?)`).run(workspaceId, runId, usageId, totalCostUsd, now)
      this.db.prepare(`UPDATE agent_budget_runs SET state='settled', updated_at=? WHERE workspace_id=? AND run_id=?`).run(now, workspaceId, runId)
    })
  }

  /** Release only when no provider request was dispatched. */
  releaseBeforeDispatch(workspaceId: string, runId: string, now = Date.now()): void {
    this.transition(workspaceId, runId, 'released', now, ['reserved'])
  }

  snapshot(workspaceId: string, limitUsd: number | null, now = Date.now()): AgentBudgetSnapshot {
    this.assertOpen()
    this.assertLimit(limitUsd)
    return this.readSnapshot(workspaceId, limitUsd, now)
  }

  close(): void {
    if (this.closed) return
    this.db.close()
    this.closed = true
  }

  private readSnapshot(workspaceId: string, limitUsd: number | null, now: number): AgentBudgetSnapshot {
    const periodStart = localDayStart(now)
    const spent = this.db.prepare(`
      SELECT COALESCE(SUM(u.cost_usd), 0) AS value
      FROM agent_budget_usage u
      JOIN agent_budget_runs r USING(workspace_id, run_id)
      WHERE r.workspace_id=? AND r.period_start=?
    `).get(workspaceId, periodStart) as { value: number }
    const reserved = this.db.prepare(`
      SELECT COALESCE(SUM(reserved_usd), 0) AS value
      FROM agent_budget_runs
      WHERE workspace_id=? AND period_start=? AND state='reserved'
    `).get(workspaceId, periodStart) as { value: number }
    const unresolved = this.db.prepare(`
      SELECT COALESCE(SUM(reserved_usd), 0) AS value
      FROM agent_budget_runs
      WHERE workspace_id=? AND (state='unresolved' OR (state='reserved' AND period_start<>?))
    `).get(workspaceId, periodStart) as { value: number }
    const spentUsd = spent.value
    const reservedUsd = reserved.value
    const unresolvedUsd = unresolved.value
    const remainingUsd = limitUsd === null ? null : Math.max(0, limitUsd - spentUsd - reservedUsd - unresolvedUsd)
    return {
      limitUsd,
      spentUsd,
      reservedUsd,
      unresolvedUsd,
      remainingUsd,
      exhausted: limitUsd !== null && (unresolvedUsd > 0 || spentUsd + reservedUsd >= limitUsd),
    }
  }

  private getRun(workspaceId: string, runId: string): AgentBudgetReservation | null {
    const row = this.db.prepare('SELECT workspace_id, run_id, period_start, reserved_usd, state FROM agent_budget_runs WHERE workspace_id=? AND run_id=?').get(workspaceId, runId) as { workspace_id: string; run_id: string; period_start: number; reserved_usd: number; state: AgentBudgetRunState } | undefined
    return row ? { workspaceId: row.workspace_id, runId: row.run_id, periodStart: row.period_start, reservedUsd: row.reserved_usd, state: row.state } : null
  }

  private transition(workspaceId: string, runId: string, state: AgentBudgetRunState, now: number, from: AgentBudgetRunState[]): void {
    this.assertOpen()
    this.transaction(() => {
      const run = this.getRun(workspaceId, runId)
      if (!run) throw new Error('budget reservation not found')
      if (run.state === state) return
      if (!from.includes(run.state)) throw new Error(`cannot transition budget run from ${run.state} to ${state}`)
      this.db.prepare('UPDATE agent_budget_runs SET state=?, updated_at=? WHERE workspace_id=? AND run_id=?').run(state, now, workspaceId, runId)
    })
  }

  private assertLimit(limitUsd: number | null): void {
    if (limitUsd !== null && (!Number.isFinite(limitUsd) || limitUsd <= 0)) {
      throw new Error('daily limit must be a finite positive USD amount or null')
    }
  }

  private assertUsage(workspaceId: string, runId: string, usageId: string, costUsd: number): void {
    this.assertOpen()
    if (!workspaceId || !runId || !usageId) throw new Error('workspaceId, runId and usageId are required')
    if (!Number.isFinite(costUsd) || costUsd < 0) throw new Error('usage cost must be a finite nonnegative USD amount')
  }

  private transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const result = fn()
      this.db.exec('COMMIT')
      return result
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  private assertOpen(): void {
    if (this.closed) throw new Error('budget ledger is closed')
  }
}

export function localDayStart(timestamp: number): number {
  const day = new Date(timestamp)
  day.setHours(0, 0, 0, 0)
  return day.getTime()
}
