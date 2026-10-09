/**
 * Onboarding identity — first-run draft model.
 *
 * Validation, reserved-address derivation and the coin-badge table live in
 * `onboarding-username.ts` (single source of truth). This module keeps the
 * first-run draft the wizard writes and `finishFirstRun` reads, and re-exports
 * the field-level `HandleCheckStatus` the wizard and `useOnboarding` consume.
 */

export type { HandleCheckStatus } from './onboarding-username'

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