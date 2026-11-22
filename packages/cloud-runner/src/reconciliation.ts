/**
 * Usage reconciliation: our ledger against the provider invoice.
 *
 * Both sides are integer cents and are matched by `ref` (the sandbox id the
 * reservation was written under). Rows are summed per ref first, so a refund
 * or a credit line on either side folds into the same comparison.
 *
 * `thresholdPct` is the tolerated per-row difference; rows inside it count as
 * matched, rows beyond it land in `drifted` for the owner to look at.
 */

import { CloudRunnerError } from './types.ts';

export interface UsageRow {
  ref: string;
  provider: string;
  amountCents: number;
}

export interface DriftedRow {
  ref: string;
  oursCents: number;
  theirsCents: number;
  /** Per-row difference in percent, already rounded to two decimals. */
  driftPct: number;
}

export interface UsageReconciliation {
  oursCents: number;
  theirsCents: number;
  /** Overall difference in percent, rounded to two decimals. */
  driftPct: number;
  /** Refs present on both sides within `thresholdPct`. */
  matched: string[];
  /** Refs we billed but the provider invoice does not list. */
  missingInProvider: string[];
  /** Refs the provider invoice lists but we did not bill. */
  missingInOurs: string[];
  /** Refs present on both sides beyond `thresholdPct`. */
  drifted: DriftedRow[];
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function percentDrift(oursCents: number, theirsCents: number): number {
  return round2((Math.abs(oursCents - theirsCents) / Math.max(theirsCents, 1)) * 100);
}

function totalsByRef(rows: readonly UsageRow[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const row of rows) {
    if (!Number.isInteger(row.amountCents)) {
      throw new CloudRunnerError(
        `usage row ${row.ref} must be integer cents, got ${row.amountCents}`,
        'provider_error',
      );
    }
    totals.set(row.ref, (totals.get(row.ref) ?? 0) + row.amountCents);
  }
  return totals;
}

export function reconcileUsage(
  ours: readonly UsageRow[],
  theirs: readonly UsageRow[],
  thresholdPct = 5,
): UsageReconciliation {
  if (!Number.isFinite(thresholdPct) || thresholdPct < 0) {
    throw new CloudRunnerError(
      `reconciliation threshold must be a non-negative percent, got ${thresholdPct}`,
      'provider_error',
    );
  }

  const ourTotals = totalsByRef(ours);
  const theirTotals = totalsByRef(theirs);

  let oursCents = 0;
  for (const cents of ourTotals.values()) oursCents += cents;
  let theirsCents = 0;
  for (const cents of theirTotals.values()) theirsCents += cents;

  const matched: string[] = [];
  const missingInProvider: string[] = [];
  const drifted: DriftedRow[] = [];
  for (const [ref, ourCents] of ourTotals) {
    const theirCents = theirTotals.get(ref);
    if (theirCents === undefined) {
      missingInProvider.push(ref);
      continue;
    }
    const rowPct = percentDrift(ourCents, theirCents);
    if (rowPct <= thresholdPct) {
      matched.push(ref);
    } else {
      drifted.push({ ref, oursCents: ourCents, theirsCents: theirCents, driftPct: rowPct });
    }
  }

  const missingInOurs: string[] = [];
  for (const ref of theirTotals.keys()) {
    if (!ourTotals.has(ref)) missingInOurs.push(ref);
  }

  return {
    oursCents,
    theirsCents,
    driftPct: percentDrift(oursCents, theirsCents),
    matched,
    missingInProvider,
    missingInOurs,
    drifted,
  };
}
