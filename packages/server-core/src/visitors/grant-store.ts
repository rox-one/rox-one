/**
 * Visitor grant store (port-matrix row a1.6).
 *
 * Holds time-boxed visitor grants keyed by `email:<addr>` / `github:<id>`. The
 * clock is injected so TTL expiry is testable. Two independent reapers keep the
 * map honest:
 *
 *  - a periodic sweep (default hourly) drops every expired grant;
 *  - a one-shot expiry timer armed to the NEAREST expiry reaps exactly when the
 *    first grant lapses, then re-arms to the next — so a long-quiet store does
 *    not hold a stale grant until the next hourly tick.
 *
 * Reads (`get`/`has`/`list`) treat an expired-but-unswept grant as absent and
 * prune it lazily, so a lagging sweep can never admit an expired visitor.
 */
import {
  normalizeSubject,
  visitorKey,
  type VisitorGrant,
  type VisitorSubject,
} from './types.ts'

/** Default grant lifetime: 14 days. */
export const DEFAULT_VISITOR_GRANT_TTL_MS = 14 * 24 * 60 * 60_000
/** Periodic sweep cadence: hourly. */
export const VISITOR_SWEEP_INTERVAL_MS = 60 * 60_000

export interface VisitorGrantStoreOptions {
  /** Injected clock (tests). Defaults to `Date.now`. */
  now?: () => number
  /** Grant lifetime applied when a grant does not pass its own ttl. */
  ttlMs?: number
  /** Periodic sweep cadence. */
  sweepIntervalMs?: number
  /**
   * Own the hourly sweep with an internal interval (default true, matching the
   * session-activity-tracker precedent). Set false when an external driver (the
   * host scheduler) owns the cadence — the expiry timer stays irrespective.
   */
  periodicSweep?: boolean
  /** Disable both timers; tests drive `sweep()` directly. Defaults to enabled. */
  timers?: boolean
}

export interface VisitorGrantOptions {
  ttlMs?: number
  invitedBy?: string | null
  note?: string | null
}

export class VisitorGrantStore {
  private readonly grants = new Map<string, VisitorGrant>()
  private readonly now: () => number
  private readonly ttlMs: number
  private readonly sweepIntervalMs: number
  private sweepTimer: ReturnType<typeof setInterval> | null = null
  private expiryTimer: ReturnType<typeof setTimeout> | null = null

  constructor(options: VisitorGrantStoreOptions = {}) {
    this.now = options.now ?? Date.now
    this.ttlMs = options.ttlMs ?? DEFAULT_VISITOR_GRANT_TTL_MS
    this.sweepIntervalMs = options.sweepIntervalMs ?? VISITOR_SWEEP_INTERVAL_MS
    if (options.timers !== false && options.periodicSweep !== false) {
      this.sweepTimer = setInterval(() => { this.sweep() }, this.sweepIntervalMs)
      this.sweepTimer.unref?.()
    }
  }

  /**
   * Grant (or replace) access for a subject. A replacement resets the lifetime
   * and records who re-invited them.
   */
  grant(subject: VisitorSubject, options: VisitorGrantOptions = {}): VisitorGrant {
    const normalized = normalizeSubject(subject)
    const key = visitorKey(normalized)
    const now = this.now()
    const ttlMs = options.ttlMs ?? this.ttlMs
    const grant: VisitorGrant = Object.freeze({
      key,
      subject: normalized,
      createdAt: now,
      expiresAt: now + ttlMs,
      invitedBy: options.invitedBy ?? null,
      note: options.note ?? null,
    })
    this.grants.set(key, grant)
    this.armExpiryTimer()
    return grant
  }

  /** Revoke one subject. Returns the removed grant, or null if none was live. */
  revoke(subject: VisitorSubject): VisitorGrant | null {
    const key = visitorKey(subject)
    const existing = this.grants.get(key) ?? null
    if (!existing) return null
    this.grants.delete(key)
    this.armExpiryTimer()
    return existing
  }

  /** A live grant for the subject, or null (expired grants are pruned). */
  get(subject: VisitorSubject): VisitorGrant | null {
    const key = visitorKey(subject)
    const grant = this.grants.get(key)
    if (!grant) return null
    if (grant.expiresAt <= this.now()) {
      this.grants.delete(key)
      return null
    }
    return grant
  }

  /** Whether the subject currently holds a live grant. */
  has(subject: VisitorSubject): boolean {
    return this.get(subject) !== null
  }

  /** Every live grant, soonest-expiring first. */
  list(): VisitorGrant[] {
    const now = this.now()
    const live: VisitorGrant[] = []
    for (const [key, grant] of this.grants) {
      if (grant.expiresAt <= now) {
        this.grants.delete(key)
        continue
      }
      live.push(grant)
    }
    return live.sort((a, b) => a.expiresAt - b.expiresAt || a.key.localeCompare(b.key))
  }

  /** Drop every expired grant; returns the removed keys. */
  sweep(): string[] {
    const now = this.now()
    const removed: string[] = []
    for (const [key, grant] of this.grants) {
      if (grant.expiresAt <= now) {
        this.grants.delete(key)
        removed.push(key)
      }
    }
    this.armExpiryTimer()
    return removed
  }

  /** Stop both timers (shutdown). Grants are left as-is. */
  dispose(): void {
    clearInterval(this.sweepTimer ?? undefined)
    clearTimeout(this.expiryTimer ?? undefined)
    this.sweepTimer = null
    this.expiryTimer = null
  }

  /**
   * Re-arm the one-shot expiry timer to the nearest live expiry. Called after
   * every mutation and every sweep so the timer always tracks the true horizon.
   */
  private armExpiryTimer(): void {
    clearTimeout(this.expiryTimer ?? undefined)
    this.expiryTimer = null
    let earliest = Number.POSITIVE_INFINITY
    for (const grant of this.grants.values()) {
      if (grant.expiresAt < earliest) earliest = grant.expiresAt
    }
    if (!Number.isFinite(earliest)) return
    const delay = Math.max(0, earliest - this.now())
    this.expiryTimer = setTimeout(() => {
      this.expiryTimer = null
      this.sweep()
    }, delay)
    this.expiryTimer.unref?.()
  }
}