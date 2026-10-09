/**
 * Profile questionnaire form value, defaults, gating, and local draft.
 *
 * Pure helpers (no React) so the Continue gating and draft round-trip are
 * unit-testable. The draft is persisted through an injected storage port,
 * mirroring the existing onboarding local-persistence adapters
 * (`onboarding-rewards`, `first-result-ui`) — localStorage in the app, an
 * in-memory stub in tests.
 */

export const PROFILE_DRAFT_STORAGE_KEY = 'rox.onboarding.profile-draft.v1'

/** Default time zone for the questionnaire (Moscow, GMT+3). */
export const PROFILE_DEFAULT_TIMEZONE = 'Europe/Moscow'

/** System-locale option; when selected the interface/communication language follows the OS. */
export const PROFILE_AUTO_LANGUAGE = 'auto'

export interface ProfileFormValue {
  name: string
  /** ISO `yyyy-mm-dd` from the native date input, or ''. */
  birthDate: string
  interfaceLanguage: string
  communicationLanguage: string
  city: string
  timezone: string
  preferences: string
  /** Selected bubble ids across every group (including the adaptive one). */
  bubbles: string[]
}

/** Fields the left column must satisfy before «Продолжить» unlocks. */
export const PROFILE_REQUIRED_FIELDS = ['name', 'interfaceLanguage', 'communicationLanguage', 'timezone'] as const

export type ProfileRequiredField = (typeof PROFILE_REQUIRED_FIELDS)[number]

export const DEFAULT_PROFILE_FORM: ProfileFormValue = {
  name: '',
  birthDate: '',
  interfaceLanguage: 'ru',
  communicationLanguage: 'ru',
  city: '',
  timezone: PROFILE_DEFAULT_TIMEZONE,
  preferences: '',
  bubbles: [],
}

/** Required left-column fields that are still empty (in declared order). */
export function profileRequiredMissing(value: ProfileFormValue): ProfileRequiredField[] {
  return PROFILE_REQUIRED_FIELDS.filter((field) => {
    if (field === 'name') return value.name.trim().length === 0
    return value[field].trim().length === 0
  })
}

/** True when every required left-column field is filled. */
export function isProfileComplete(value: ProfileFormValue): boolean {
  return profileRequiredMissing(value).length === 0
}

export interface ProfileDraftStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function readField(source: object, key: keyof ProfileFormValue): unknown {
  return Object.getOwnPropertyDescriptor(source, key)?.value
}

function readString(source: object, key: keyof ProfileFormValue, fallback: string): string {
  const value = readField(source, key)
  return typeof value === 'string' ? value : fallback
}

/** Save the questionnaire draft locally (best-effort; storage may be unavailable). */
export function saveProfileDraft(storage: ProfileDraftStorage | undefined, value: ProfileFormValue): void {
  if (!storage) return
  try {
    storage.setItem(PROFILE_DRAFT_STORAGE_KEY, JSON.stringify(value))
  } catch {
    // Draft persistence is optional — a full/unavailable storage must not block onboarding.
  }
}

/** Load a previously saved draft, ignoring malformed payloads. */
export function loadProfileDraft(storage: ProfileDraftStorage | undefined): ProfileFormValue | null {
  if (!storage) return null
  let raw: string | null = null
  try {
    raw = storage.getItem(PROFILE_DRAFT_STORAGE_KEY)
  } catch {
    return null
  }
  if (!raw) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    const bubbles = readField(parsed, 'bubbles')
    return {
      ...DEFAULT_PROFILE_FORM,
      name: readString(parsed, 'name', DEFAULT_PROFILE_FORM.name),
      birthDate: readString(parsed, 'birthDate', DEFAULT_PROFILE_FORM.birthDate),
      interfaceLanguage: readString(parsed, 'interfaceLanguage', DEFAULT_PROFILE_FORM.interfaceLanguage),
      communicationLanguage: readString(parsed, 'communicationLanguage', DEFAULT_PROFILE_FORM.communicationLanguage),
      city: readString(parsed, 'city', DEFAULT_PROFILE_FORM.city),
      timezone: readString(parsed, 'timezone', DEFAULT_PROFILE_FORM.timezone),
      preferences: readString(parsed, 'preferences', DEFAULT_PROFILE_FORM.preferences),
      bubbles: isStringArray(bubbles) ? [...bubbles] : [],
    }
  } catch {
    return null
  }
}