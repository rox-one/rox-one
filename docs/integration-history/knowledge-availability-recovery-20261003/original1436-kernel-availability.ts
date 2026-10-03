/**
 * Kernel availability cache (tab-switch fast path).
 *
 * Problem (static audit): every switch to the Knowledge tab re-fires kernel
 * network I/O with multi-second timeouts and no cache, no in-flight dedup,
 * and no fast-fail for a known-absent kernel:
 * - `KnowledgeNotebookTree` mount → `knowledge.listNotebooks` (kernel
 *   `POST /api/notebook/lsNotebooks`, 10s client timeout) plus up to ~20
 *   parallel `knowledge.get` title-resolution calls (10s timeout each).
 * - `KnowledgeHome` mount → `knowledge.listConnections` then
 *   `knowledge.engineStatus` (2.5s bootstrap probe + up to 10s
 *   `getVersion` once a connection record exists).
 * With no kernel running (and a background toolchain install saturating the
 * machine) each switch queues dozens of seconds of worst-case RPC latency
 * that all resolve to "unavailable" anyway.
 *
 * This module wraps the `engineStatus` probe with:
 * - TTL cache (default 30s): repeat tab switches reuse the last verdict.
 * - In-flight dedup: concurrent mounts share one backend probe.
 * - Renderer-side race timeout (default 3s, well under the 10s kernel-client
 *   timeout): a hung probe resolves fast as `{ running: false }`.
 *
 * Callers skip kernel-touching reads (`listNotebooks`, per-envelope `get`)
 * while the cached verdict is `running: false`; local stores (`viewsList`,
 * `envelopeList`) are still read so Recent/Favorites/saved views render.
 */

export interface KernelAvailabilityProbe {
  engineStatus(args: {
    workspaceId?: string
    connectionId?: string
  }): Promise<{ running: boolean; version?: string }>
}

export interface KernelAvailability {
  running: boolean
  version?: string
  /** Epoch ms when the verdict was produced. */
  checkedAt: number
}

export interface KernelAvailabilityOptions {
  workspaceId?: string
  connectionId?: string
  /** Cache TTL ms (default 30_000). */
  ttlMs?: number
  /** Renderer-side probe budget ms (default 3_000). */
  timeoutMs?: number
  /** Clock for tests (default Date.now). */
  now?: () => number
}

export const KERNEL_AVAILABILITY_TTL_MS = 30_000
export const KERNEL_AVAILABILITY_TIMEOUT_MS = 3_000

const UNAVAILABLE: KernelAvailability = { running: false, checkedAt: 0 }

let cached: KernelAvailability | null = null
let inFlight: Promise<KernelAvailability> | null = null

/** Test-only: drop the cache and any in-flight probe. */
export function __resetKernelAvailabilityForTests(): void {
  cached = null
  inFlight = null
}

/** True when a fresh cached verdict says the kernel is absent. */
export function isKernelKnownUnavailable(now: () => number = Date.now): boolean {
  if (!cached || cached.running) return false
  return now() - cached.checkedAt < KERNEL_AVAILABILITY_TTL_MS
}

async function probeOnce(
  api: KernelAvailabilityProbe | null | undefined,
  opts: KernelAvailabilityOptions,
): Promise<KernelAvailability> {
  const now = opts.now ?? Date.now
  const timeoutMs = opts.timeoutMs ?? KERNEL_AVAILABILITY_TIMEOUT_MS
  if (!api || typeof api.engineStatus !== 'function') {
    return { ...UNAVAILABLE, checkedAt: now() }
  }
  const args: { workspaceId?: string; connectionId?: string } = {}
  if (opts.workspaceId) args.workspaceId = opts.workspaceId
  if (opts.connectionId) args.connectionId = opts.connectionId
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), timeoutMs)
    })
    const raced = await Promise.race([api.engineStatus(args), timeout])
    if (raced === null) {
      // Renderer-side budget exceeded — treat as absent, fast. The backend
      // probe may still resolve later; its verdict is discarded.
      return { ...UNAVAILABLE, checkedAt: now() }
    }
    return {
      running: raced.running === true,
      ...(typeof raced.version === 'string' ? { version: raced.version } : {}),
      checkedAt: now(),
    }
  } catch {
    return { ...UNAVAILABLE, checkedAt: now() }
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

/**
 * Cached + deduped kernel availability verdict. Concurrent callers share one
 * backend probe; calls within TTL reuse the last verdict without touching
 * the backend. Never throws — backend failures resolve as unavailable.
 */
export function getKernelAvailability(
  api: KernelAvailabilityProbe | null | undefined,
  opts: KernelAvailabilityOptions = {},
): Promise<KernelAvailability> {
  const now = opts.now ?? Date.now
  const ttlMs = opts.ttlMs ?? KERNEL_AVAILABILITY_TTL_MS
  if (cached && now() - cached.checkedAt < ttlMs) {
    return Promise.resolve(cached)
  }
  if (!inFlight) {
    inFlight = probeOnce(api, opts).then((verdict) => {
      cached = verdict
      inFlight = null
      return verdict
    })
  }
  return inFlight
}
