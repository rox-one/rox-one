/**
 * Live platform-fee meter for Rox Cloud.
 *
 * The customer pays their provider directly; the wallet carries only Rox's
 * fee. The meter turns elapsed wall-clock time into integer cents so the
 * console shows a rising cost instead of a blank column, and so a stop
 * settles against the same arithmetic the customer watched.
 *
 * Only non-terminal states accrue: once a sandbox is stopped, failed or
 * expired, its fee stays at the last value.
 */

import type { MemoryStore, SandboxRecord } from './store.ts'

/** States that still cost the platform fee. */
const BILLABLE_STATES: Record<string, true> = {
  queued: true,
  starting: true,
  running: true,
  paused: true,
}

/**
 * Fee for a sandbox that has existed from `createdAt` to `at`.
 * Rounded up to a whole cent, with a minimum of one cent for any started
 * machine, so a 60-second sandbox never settles at zero.
 */
export function accruedCents(createdAt: number, at: number, rateCentsPerHour: number): number {
  if (!Number.isFinite(rateCentsPerHour) || rateCentsPerHour <= 0) return 0
  const elapsedMs = Math.max(0, at - createdAt)
  return Math.max(1, Math.ceil((elapsedMs / 3_600_000) * rateCentsPerHour))
}

export interface Meter {
  /** Recompute every billable sandbox; returns how many rows changed. */
  tick(): number
}

export function createMeter(deps: {
  store: MemoryStore
  rateCentsPerHour: number
  now?: () => number
}): Meter {
  const now = deps.now ?? Date.now
  return {
    tick(): number {
      const at = now()
      let changed = 0
      for (const record of deps.store.sandboxes.values()) {
        if (!BILLABLE_STATES[record.state]) continue
        const cents = accruedCents(record.createdAt, at, deps.rateCentsPerHour)
        if (cents === record.costCents) continue
        record.costCents = cents
        const index = deps.store.usage.findIndex(
          (row) => row.tenantId === record.tenantId && row.ref === record.id,
        )
        if (index >= 0) deps.store.usage[index]!.cents = cents
        changed += 1
      }
      return changed
    },
  }
}
