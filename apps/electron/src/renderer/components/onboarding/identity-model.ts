/**
 * Onboarding identity step — model.
 *
 * The step's logic is pure and React-free so the validation table, the
 * "never green without an explicit available" rule, the org default and the
 * reward-badge gating are unit-testable without mounting the React step.
 *
 * Validation, reserved-address derivation and the coin-badge table are re-used
 * from `onboarding-username.ts` (single source of truth). This module adds the
 * step-facing pieces: the availability state machine with an *injectable*
 * fetcher, the default Rox-broker fetcher, and the first-run draft persistence
 * the wizard writes and `finishFirstRun` reads.
 */

import {
  HANDLE_CHECK_DEBOUNCE_MS,
  createHandleAvailabilityTracker,
  defaultOnboardingOrganization,
  identityCoinState,
  normalizeHandleInput,
  parseHandleAvailabilityResponse,
  parseOnboardingOrganization,
  parseOnboardingUsername,
  reservedIdentityAddresses,
  resolveOnboardingOrganization,
  shouldShowReservedBlock,
  ROX_COIN_REWARDS,
  type HandleAvailability,
  type HandleCheckStatus,
  type IdentityCoinState,
  type ReservedIdentityAddresses,
} from './onboarding-username'

// Re-export the shared contract so the step imports one module.
export {
  HANDLE_CHECK_DEBOUNCE_MS,
  ONBOARDING_ORGANIZATION_MAX,
  ONBOARDING_USERNAME_MAX,
  defaultOnboardingOrganization,
  identityCoinState,
  normalizeHandleInput,
  parseOnboardingOrganization,
  parseOnboardingUsername,
  reservedIdentityAddresses,
  resolveOnboardingOrganization,
  shouldShowReservedBlock,
  ROX_COIN_REWARDS,
} from './onboarding-username'
export type { HandleAvailability, HandleCheckStatus, IdentityCoinState, ReservedIdentityAddresses }

/**
 * Rox broker availability endpoint. The server side lands in a later wave; a
 * missing endpoint (404) or any transport failure resolves to `unknown` and
 * must never block Continue.
 */
export const HANDLE_AVAILABILITY_URL = 'https://rox.one/api/handle/availability'

/** Injectable availability transport: returns the raw server payload. */
export type HandleAvailabilityFetcher = (handle: string) => Promise<unknown>

/**
 * Default fetcher: `GET https://rox.one/api/handle/availability?handle=…`.
 * A non-2xx response (including the not-yet-deployed 404) resolves to `null`,
 * which `parseHandleAvailabilityResponse` folds into `unknown`.
 */
export function createRoxHandleAvailabilityFetcher(
  fetchImpl: typeof fetch = fetch,
): HandleAvailabilityFetcher {
  return async (handle: string) => {
    const url = `${HANDLE_AVAILABILITY_URL}?handle=${encodeURIComponent(handle)}`
    const response = await fetchImpl(url, {
      method: 'GET',
      headers: { accept: 'application/json' },
    })
    if (!response.ok) return null
    return await response.json()
  }
}

/**
 * Run one availability probe. Any transport error is `unknown` — the UI must
 * never turn green (or block) on a failed request.
 */
export async function checkHandleAvailability(
  handle: string,
  fetchAvailability: HandleAvailabilityFetcher,
): Promise<HandleAvailability> {
  try {
    return parseHandleAvailabilityResponse(await fetchAvailability(handle))
  } catch {
    return 'unknown'
  }
}

/** A server-confirmed `taken`/`reserved` blocks Continue; `unknown` does not. */
export function isHandleSubmittable(status: HandleCheckStatus): boolean {
  return status === 'available' || status === 'unknown' || status === 'checking' || status === 'idle'
}

// =============================================================================
// AVAILABILITY STATE MACHINE
// =============================================================================

export interface HandleAvailabilityControllerOptions {
  fetchAvailability: HandleAvailabilityFetcher
  /** Field-level status sink; fires for `checking` and every settled verdict. */
  onChange: (handle: string, status: HandleCheckStatus) => void
  debounceMs?: number
  /** Injectable timer (tests pass a synchronous/immediate scheduler). */
  schedule?: (run: () => void, ms: number) => unknown
  cancel?: (token: unknown) => void
}

export interface HandleAvailabilityController {
  /** Feed the raw field value; returns the immediate status. */
  update(raw: string): HandleCheckStatus
  /** Invalidate outstanding requests (unmount). */
  dispose(): void
}

/**
 * Debounced, out-of-order-safe availability machine.
 *
 * `update` is synchronous and returns the field status the UI should show
 * right away; the network verdict arrives through `onChange` only when it is
 * still the newest request. Out-of-order responses are dropped by the tracker.
 */
export function createHandleAvailabilityController(
  options: HandleAvailabilityControllerOptions,
): HandleAvailabilityController {
  const tracker = createHandleAvailabilityTracker()
  const debounceMs = options.debounceMs ?? HANDLE_CHECK_DEBOUNCE_MS
  const schedule = options.schedule ?? ((run, ms) => setTimeout(run, ms))
  const cancel = options.cancel ?? ((token) => clearTimeout(token as Parameters<typeof clearTimeout>[0]))
  let pending: unknown = null

  const settle = (token: number, handle: string, result: HandleAvailability) => {
    const accepted = tracker.settle(token, result)
    if (accepted) options.onChange(handle, accepted)
  }

  return {
    update(raw) {
      const trimmedLength = normalizeHandleInput(typeof raw === 'string' ? raw : '').length
      const parsed = parseOnboardingUsername(raw)
      if (!parsed) {
        tracker.invalidate()
        if (pending !== null) {
          cancel(pending)
          pending = null
        }
        const status: HandleCheckStatus = trimmedLength === 0 ? 'idle' : 'invalid'
        options.onChange('', status)
        return status
      }
      const token = tracker.begin(parsed)
      options.onChange(parsed, 'checking')
      if (pending !== null) cancel(pending)
      pending = schedule(() => {
        pending = null
        void checkHandleAvailability(parsed, options.fetchAvailability).then((result) => {
          settle(token, parsed, result)
        })
      }, debounceMs)
      return 'checking'
    },
    dispose() {
      tracker.invalidate()
      if (pending !== null) {
        cancel(pending)
        pending = null
      }
    },
  }
}

// =============================================================================
// FIRST-RUN DRAFT
// =============================================================================

export const FIRST_RUN_DRAFT_STORAGE_KEY = 'rox.onboarding.first-run.v1'

/** Minimal storage port — localStorage in the app, a stub in tests. */
export interface OnboardingDraftStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

/** Everything the first run collects; persisted best-effort across reloads. */
export interface FirstRunDraft {
  username: string
  organization: string
  questionnaire?: unknown
  bubbles?: Record<string, string[]>
  permissions?: unknown
  /** Set once the user passes the two new screens (Continue or Skip). */
  completed?: boolean
}

function readRaw(storage: OnboardingDraftStorage | undefined): Record<string, unknown> {
  if (!storage) return {}
  try {
    const parsed = JSON.parse(storage.getItem(FIRST_RUN_DRAFT_STORAGE_KEY) ?? 'null')
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

/** Merge a partial draft onto any persisted draft and store it. */
export function saveFirstRunDraft(
  storage: OnboardingDraftStorage | undefined,
  patch: Partial<FirstRunDraft>,
): void {
  if (!storage) return
  try {
    storage.setItem(FIRST_RUN_DRAFT_STORAGE_KEY, JSON.stringify({ ...readRaw(storage), ...patch }))
  } catch {
    // A full/unavailable storage never breaks onboarding.
  }
}

export function loadFirstRunDraft(storage: OnboardingDraftStorage | undefined): FirstRunDraft | null {
  const raw = readRaw(storage)
  if (Object.keys(raw).length === 0) return null
  return {
    username: typeof raw.username === 'string' ? raw.username : '',
    organization: typeof raw.organization === 'string' ? raw.organization : '',
    questionnaire: raw.questionnaire,
    bubbles: (raw.bubbles && typeof raw.bubbles === 'object') ? raw.bubbles as Record<string, string[]> : undefined,
    permissions: raw.permissions,
    completed: raw.completed === true,
  }
}