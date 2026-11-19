/**
 * Per-account ceilings for Rox Cloud sandboxes (BYOK mode).
 *
 * Pure pre-check: no store, no clock, no side effects. Every axis treats `0`
 * as «не ограничено», so an account with zeros is limited only by its wallet.
 */

export interface AccountLimits {
  /** Sandboxes the account may run at once; 0 = unlimited. */
  maxConcurrentSandboxes: number;
  /** vCPU one sandbox may ask for; 0 = unlimited. */
  maxCpuPerSandbox: number;
  /** Settled spend plus the new hold for the month; 0 = unlimited. */
  maxMonthlyCents: number;
}

export type AccountLimitRefusal =
  | 'concurrency_exceeded'
  | 'sandbox_too_large'
  | 'monthly_cap_exceeded';

export interface AccountLimitCheck {
  limits: AccountLimits;
  /** Sandboxes the account already runs; the new one is not counted yet. */
  activeCount: number;
  requestedCpu: number;
  monthSpentCents: number;
  requestedReserveCents: number;
}

/** Returns the first refusal in a stable order, or `null` when allowed. */
export function checkAccountLimits(input: AccountLimitCheck): AccountLimitRefusal | null {
  const { limits, activeCount, requestedCpu, monthSpentCents, requestedReserveCents } = input;
  if (limits.maxConcurrentSandboxes > 0 && activeCount >= limits.maxConcurrentSandboxes) {
    return 'concurrency_exceeded';
  }
  if (limits.maxCpuPerSandbox > 0 && requestedCpu > limits.maxCpuPerSandbox) {
    return 'sandbox_too_large';
  }
  if (
    limits.maxMonthlyCents > 0 &&
    monthSpentCents + requestedReserveCents > limits.maxMonthlyCents
  ) {
    return 'monthly_cap_exceeded';
  }
  return null;
}
