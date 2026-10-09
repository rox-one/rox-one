/**
 * f.9 — node presence with a TTL sweep.
 *
 * Clean-room re-expression of the OpenClaw NodeRegistry presence tracking
 * (port-analysis row f.9; upstream `src/gateway/node-registry.ts:175`). A node
 * is "online" only while its last heartbeat is within the TTL; `sweep()` evicts
 * stale entries so a dropped connection cannot leave a phantom live node that
 * later invokes would target.
 *
 * The clock is injected so a caller (and tests) can advance time deterministically
 * instead of sleeping.
 */

/** Default liveness window; matches the gateway heartbeat tick (30s). */
export const DEFAULT_PRESENCE_TTL_MS = 30_000

export interface PresenceStatus {
  readonly nodeId: string
  readonly lastSeenAt: number
  readonly online: boolean
}

export interface PresenceTrackerOptions {
  /** Heartbeats older than this are considered offline. Default 30s. */
  readonly ttlMs?: number
  /** Injected clock. Default `Date.now`. */
  readonly now?: () => number
}

export class PresenceTracker {
  private readonly ttlMs: number
  private readonly clock: () => number
  private readonly lastSeen = new Map<string, number>()

  constructor(options: PresenceTrackerOptions = {}) {
    const ttlMs = options.ttlMs ?? DEFAULT_PRESENCE_TTL_MS
    if (!Number.isSafeInteger(ttlMs) || ttlMs < 1) {
      throw new Error('PresenceTracker: ttlMs must be a positive integer')
    }
    this.ttlMs = ttlMs
    this.clock = options.now ?? Date.now
  }

  get size(): number {
    return this.lastSeen.size
  }

  /** Record a heartbeat (connection, register, or explicit heartbeat). */
  touch(nodeId: string, at: number = this.clock()): PresenceStatus {
    this.lastSeen.set(nodeId, at)
    return { nodeId, lastSeenAt: at, online: true }
  }

  /** Whether the node has a live heartbeat within the TTL. */
  isOnline(nodeId: string, at: number = this.clock()): boolean {
    const seen = this.lastSeen.get(nodeId)
    return seen !== undefined && at - seen <= this.ttlMs
  }

  /** Current status, or null when the node has never been seen. */
  status(nodeId: string, at: number = this.clock()): PresenceStatus | null {
    const seen = this.lastSeen.get(nodeId)
    if (seen === undefined) return null
    return { nodeId, lastSeenAt: seen, online: at - seen <= this.ttlMs }
  }

  /** Snapshot of every tracked node, online first then by recency. */
  list(at: number = this.clock()): PresenceStatus[] {
    return [...this.lastSeen.entries()]
      .map(([nodeId, lastSeenAt]) => ({ nodeId, lastSeenAt, online: at - lastSeenAt <= this.ttlMs }))
      .sort((a, b) => b.lastSeenAt - a.lastSeenAt)
  }

  /**
   * Evict entries whose heartbeat aged out. Returns the evicted node ids so the
   * caller can settle their pending invokes. An entry touched exactly at the TTL
   * boundary is still online; eviction happens strictly after it.
   */
  sweep(at: number = this.clock()): string[] {
    const evicted: string[] = []
    for (const [nodeId, lastSeenAt] of this.lastSeen) {
      if (at - lastSeenAt > this.ttlMs) {
        this.lastSeen.delete(nodeId)
        evicted.push(nodeId)
      }
    }
    return evicted
  }

  /** Drop a node's presence immediately (disconnect / unregister). */
  forget(nodeId: string): boolean {
    return this.lastSeen.delete(nodeId)
  }
}