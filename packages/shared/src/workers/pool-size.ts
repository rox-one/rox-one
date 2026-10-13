/**
 * Shared worker pool size (ADR-0024): half the logical cores, 1..8, one thread
 * on the low-power profile. `override` comes from ROX_WORKER_POOL_SIZE.
 */

export const MAX_WORKER_POOL_SIZE = 8;

export interface WorkerPoolSizeInput {
  availableParallelism: number;
  lowPower: boolean;
  /** Positive integer; anything else is ignored. */
  override?: number | null;
}

export function resolveWorkerPoolSize({ availableParallelism, lowPower, override }: WorkerPoolSizeInput): number {
  if (typeof override === 'number' && Number.isInteger(override) && override > 0) return override;
  if (lowPower) return 1;
  const half = Number.isFinite(availableParallelism) ? Math.floor(availableParallelism / 2) : 1;
  return Math.min(MAX_WORKER_POOL_SIZE, Math.max(1, half));
}

/** Parses ROX_WORKER_POOL_SIZE; returns null unless it is a positive integer. */
export function parseWorkerPoolSizeOverride(value: string | undefined): number | null {
  if (!value || !/^\d+$/.test(value.trim())) return null;
  const parsed = Number(value.trim());
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}
