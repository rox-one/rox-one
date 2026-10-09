/**
 * Onboarding reward ledger client (Rox coins).
 *
 * Awards are idempotent per step id: a step is written once, optimistically
 * `pending`, and can later be moved to `confirmed` with the amount the server
 * actually granted. The ledger is a local Map persisted through an injected
 * storage adapter, so the caller decides where it lives (localStorage, an
 * in-memory stub in tests, or a future server-backed cache).
 *
 * The currency is always named "Rox coins" in the UI. Amounts live in
 * REWARD_TABLE; deferring a step ("Отложить") caps its reward at
 * DEFERRED_REWARD_CAP instead of the full amount.
 */

export const ONBOARDING_REWARDS_STORAGE_KEY = 'rox.onboarding.rewards.v1'

/** Step id for the one-time bonus granted after the first full onboarding. */
export const FULL_ONBOARDING_BONUS_STEP = 'full-onboarding'

/** Rox coins granted per completed onboarding step. */
export const REWARD_TABLE: Readonly<Record<string, number>> = {
  username: 5,
  org: 5,
  telegram: 15,
  github: 5,
  [FULL_ONBOARDING_BONUS_STEP]: 50,
}

/** Deferring a step grants at most this many Rox coins. */
export const DEFERRED_REWARD_CAP = 1

/** How the step was completed: fully, or deferred by the user. */
export type AwardSource = 'completed' | 'deferred'

/** `pending` = optimistic local award; `confirmed` = server acknowledged. */
export type RewardStatus = 'pending' | 'confirmed'

export type RewardEntry = {
  stepId: string
  amount: number
  source: AwardSource
  status: RewardStatus
  awardedAt: number
  confirmedAt?: number
}

/** Injected persistence port — the ledger never touches storage directly. */
export type RewardStorage = {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export type RewardLedger = {
  /** Award a step once. Repeat calls for the same step are a no-op. */
  awardStep(stepId: string, source?: AwardSource): RewardEntry
  /** Move a pending award to `confirmed`, optionally with the server amount. */
  confirmStep(stepId: string, confirmedAmount?: number): RewardEntry | null
  getEntry(stepId: string): RewardEntry | undefined
  entries(): RewardEntry[]
  isAwarded(stepId: string): boolean
  /** Sum of not-yet-confirmed amounts (optimistic). */
  readonly pendingTotal: number
  readonly confirmedTotal: number
  readonly total: number
}

export function rewardAmountFor(stepId: string, source: AwardSource = 'completed'): number {
  const base = REWARD_TABLE[stepId] ?? 0
  return source === 'deferred' ? Math.min(base, DEFERRED_REWARD_CAP) : base
}

function isAwardSource(value: unknown): value is AwardSource {
  return value === 'completed' || value === 'deferred'
}

function isRewardEntry(value: unknown): value is RewardEntry {
  if (!value || typeof value !== 'object') return false
  const entry = value as Record<string, unknown>
  return (
    typeof entry.stepId === 'string' &&
    entry.stepId.length > 0 &&
    typeof entry.amount === 'number' &&
    Number.isFinite(entry.amount) &&
    isAwardSource(entry.source) &&
    (entry.status === 'pending' || entry.status === 'confirmed') &&
    typeof entry.awardedAt === 'number'
  )
}

function parseEntries(raw: string | null): RewardEntry[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter(isRewardEntry) : []
  } catch {
    return []
  }
}

export function createRewardLedger(options: {
  storage: RewardStorage
  now?: () => number
}): RewardLedger {
  const now = options.now ?? (() => Date.now())
  const entries = new Map<string, RewardEntry>()
  for (const entry of parseEntries(options.storage.getItem(ONBOARDING_REWARDS_STORAGE_KEY))) {
    entries.set(entry.stepId, entry)
  }

  const persist = () => {
    options.storage.setItem(ONBOARDING_REWARDS_STORAGE_KEY, JSON.stringify([...entries.values()]))
  }
  const sumOf = (status: RewardStatus) =>
    [...entries.values()].reduce((total, entry) => (entry.status === status ? total + entry.amount : total), 0)

  return {
    awardStep(stepId, source = 'completed') {
      const existing = entries.get(stepId)
      if (existing) return existing
      const entry: RewardEntry = {
        stepId,
        amount: rewardAmountFor(stepId, source),
        source,
        status: 'pending',
        awardedAt: now(),
      }
      entries.set(stepId, entry)
      persist()
      return entry
    },
    confirmStep(stepId, confirmedAmount) {
      const existing = entries.get(stepId)
      if (!existing) return null
      const confirmed: RewardEntry = {
        ...existing,
        amount: confirmedAmount ?? existing.amount,
        status: 'confirmed',
        confirmedAt: now(),
      }
      entries.set(stepId, confirmed)
      persist()
      return confirmed
    },
    getEntry: (stepId) => entries.get(stepId),
    entries: () => [...entries.values()],
    isAwarded: (stepId) => entries.has(stepId),
    get pendingTotal() {
      return sumOf('pending')
    },
    get confirmedTotal() {
      return sumOf('confirmed')
    },
    get total() {
      return sumOf('pending') + sumOf('confirmed')
    },
  }
}