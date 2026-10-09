/**
 * «А предложи сам?» suggestion client.
 *
 * The renderer never invents preference text: it forwards the collected form +
 * bubbles to the `onboarding:suggestPreferences` RPC and renders the result.
 * The RPC is the only place that talks to a model, and it answers
 * `{ ok: false, reason: 'no-provider' }` when no usable provider path exists —
 * this module preserves that honestly (no fabricated draft).
 */
import type { SuggestPreferencesInput, SuggestPreferencesResult, SuggestPreferencesReason } from '../../../shared/types'
import type { ProfileFormValue } from './profile-form'
import { PROFILE_BUBBLE_LABEL_BY_ID } from './profile-catalog'

export type { SuggestPreferencesInput, SuggestPreferencesResult, SuggestPreferencesReason }

/** Map the collected questionnaire into the RPC request payload (empty strings dropped). */
export function buildSuggestInput(value: ProfileFormValue): SuggestPreferencesInput {
  const trimmed = (text: string): string | undefined => {
    const next = text.trim()
    return next.length > 0 ? next : undefined
  }
  return {
    name: trimmed(value.name),
    birthDate: trimmed(value.birthDate),
    interfaceLanguage: value.interfaceLanguage,
    communicationLanguage: value.communicationLanguage,
    city: trimmed(value.city),
    timezone: value.timezone,
    preferences: trimmed(value.preferences),
    bubbles: [...value.bubbles],
    bubbleLabels: value.bubbles.map((id) => PROFILE_BUBBLE_LABEL_BY_ID[id]?.ru ?? id),
  }
}

/** UI state of the suggestion control. */
export type ProfileSuggestState =
  | { phase: 'idle' }
  | { phase: 'loading' }
  | { phase: 'error'; reason: SuggestPreferencesReason }

/** Shape guard for the untrusted RPC reply — a non-conforming reply is an error. */
export function normalizeSuggestResult(raw: unknown): SuggestPreferencesResult {
  if (raw && typeof raw === 'object' && 'ok' in raw) {
    if (raw.ok === true && 'text' in raw && typeof raw.text === 'string' && raw.text.trim().length > 0) {
      return { ok: true, text: raw.text }
    }
    if (raw.ok === false) {
      const reason = 'reason' in raw ? raw.reason : undefined
      if (reason === 'no-provider' || reason === 'timeout' || reason === 'error') {
        return { ok: false, reason }
      }
      return { ok: false, reason: 'error' }
    }
  }
  return { ok: false, reason: 'error' }
}

/** i18n key describing a failed suggestion, keyed by its reason. */
export function suggestErrorMessageKey(reason: SuggestPreferencesReason): string {
  switch (reason) {
    case 'no-provider':
      return 'onboarding.profile.suggestNoProvider'
    case 'timeout':
      return 'onboarding.profile.suggestTimeout'
    case 'error':
      return 'onboarding.profile.suggestError'
  }
}