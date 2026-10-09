/**
 * W1-11 (#1508) — Local-mode token buckets (TECH-SPEC §13.8, DATA-MODEL §5.14).
 *
 * The server keeps its buckets in Valkey; local mode keeps them in memory with
 * exactly the same semantics: a subject spends from `(subject, scope)` and from
 * `(subject, '*')`, the strictest configured window decides, and a refusal
 * reports `retryAfter` in seconds (§13.8 "A limit hit returns RATE_LIMITED.
 * The session tool loop backs off retryAfter automatically").
 *
 * The windows are fixed (not sliding) because that is what a dated counter can
 * express in memory and in Valkey alike: each bucket keeps the count of the
 * current minute / hour / day and the moment that window started.
 */

import {
  AGGREGATE_SCOPE,
  DEFAULT_RATE_LIMIT_POLICY,
  RATE_LIMIT_WINDOW_MS,
  RATE_LIMIT_WINDOWS,
  type RateLimitBucket,
  type RateLimitDecision,
  type RateLimitSpend,
  type RateLimitWindow,
} from '@rox/core/agents'

interface WindowState {
  count: number
  /** Start of the window, in ms. */
  startedAt: number
}

interface BucketState {
  minute: WindowState
  hour: WindowState
  day: WindowState
}

/** The bucket key: one counter set per workspace, subject and scope. */
export function rateLimitBucketKey(spend: Pick<RateLimitSpend, 'workspaceId' | 'subject' | 'scope'>): string {
  return `${spend.workspaceId}\u0000${spend.subject}\u0000${spend.scope}`
}

export interface InMemoryRateLimiterOptions {
  /** Policy rows (`rate_limit_policy`); defaults to DATA-MODEL §5.14. */
  policy?: readonly RateLimitBucket[]
  /** Subject whose aggregate bucket every subject also spends from. */
  now?: () => number
}

/** A decision plus the scopes that were charged (tests and diagnostics). */
export type RateLimitConsumption = RateLimitDecision & { charged: string[]; bucketScope?: string }

/**
 * Fixed-window counters for one process. `consume` charges **both** the
 * command's own scope bucket and the aggregate (`*`), in that order, and a
 * refusal of either is final.
 */
export class InMemoryRateLimiter {
  private readonly now: () => number
  private policy: readonly RateLimitBucket[]
  private readonly buckets = new Map<string, BucketState>()

  constructor(options: InMemoryRateLimiterOptions = {}) {
    this.now = options.now ?? (() => Date.now())
    this.policy = options.policy ?? DEFAULT_RATE_LIMIT_POLICY
  }

  /** Replace the policy (settings change / tests). Counters are kept. */
  setPolicy(policy: readonly RateLimitBucket[]): void {
    this.policy = policy
  }

  limitsFor(subject: string, scope: string): RateLimitBucket | null {
    // The most specific row wins: `agent:<id>` beats `agent:*`.
    const candidates = this.policy.filter(bucket => bucket.scope === scope && (bucket.subject === subject || bucket.subject === 'agent:*' || bucket.subject === 'rule:*'))
    if (candidates.length === 0) return null
    const exact = candidates.find(bucket => bucket.subject === subject)
    return exact ?? candidates[0] ?? null
  }

  /** Charge one command: the scope bucket, then the aggregate bucket. */
  consume(spend: RateLimitSpend): RateLimitConsumption {
    const cost = spend.cost ?? 1
    const scopes = spend.scope === AGGREGATE_SCOPE ? [AGGREGATE_SCOPE] : [spend.scope, AGGREGATE_SCOPE]
    const charged: string[] = []
    for (const scope of scopes) {
      const refusal = this.charge({ ...spend, scope, cost })
      if (refusal) return { ...refusal, charged }
      charged.push(scope)
    }
    return { allowed: true, charged }
  }

  /** `null` = admitted; a refusal reports the window and the seconds to wait. */
  private charge(spend: RateLimitSpend): { allowed: false; window: RateLimitWindow; retryAfter: number; bucketScope: string } | null {
    const limits = this.limitsFor(spend.subject, spend.scope)
    if (!limits) return null
    const key = rateLimitBucketKey(spend)
    const state = this.buckets.get(key) ?? {
      minute: { count: 0, startedAt: this.now() },
      hour: { count: 0, startedAt: this.now() },
      day: { count: 0, startedAt: this.now() },
    }
    const now = this.now()
    const limitsByWindow: Record<RateLimitWindow, number | null> = {
      minute: limits.perMinute,
      hour: limits.perHour,
      day: limits.perDay,
    }
    // Evaluate the widest window first: it is the one with the longest wait.
    for (const window of [...RATE_LIMIT_WINDOWS].reverse()) {
      const limit = limitsByWindow[window]
      if (limit === null) continue
      const current = rollWindow(state[window], window, now)
      if (current.count + (spend.cost ?? 1) > limit) {
        return { allowed: false, window, retryAfter: retryAfterSeconds(state[window], window, now), bucketScope: spend.scope }
      }
    }
    for (const window of RATE_LIMIT_WINDOWS) {
      if (limitsByWindow[window] === null) continue
      const current = rollWindow(state[window], window, now)
      current.count += spend.cost ?? 1
    }
    this.buckets.set(key, state)
    return null
  }

  /** Reset every counter (tests, and a workspace pause). */
  clear(): void {
    this.buckets.clear()
  }

  /** Current counters of one (workspace, subject, scope) bucket. */
  snapshot(spend: Pick<RateLimitSpend, 'workspaceId' | 'subject' | 'scope'>): Record<RateLimitWindow, number> | null {
    const state = this.buckets.get(rateLimitBucketKey(spend))
    if (!state) return null
    return { minute: state.minute.count, hour: state.hour.count, day: state.day.count }
  }
}

/** Roll a fixed window forward when the clock has left it. */
function rollWindow(state: WindowState, window: RateLimitWindow, now: number): WindowState {
  const size = RATE_LIMIT_WINDOW_MS[window]
  if (now - state.startedAt >= size) {
    state.count = 0
    state.startedAt = now
  }
  return state
}

/** Seconds until the current window admits the next token (at least 1). */
function retryAfterSeconds(state: WindowState, window: RateLimitWindow, now: number): number {
  const remaining = state.startedAt + RATE_LIMIT_WINDOW_MS[window] - now
  return Math.max(1, Math.ceil(remaining / 1000))
}