import { describe, expect, it } from 'bun:test'
import {
  DEFAULT_PROFILE_FORM,
  PROFILE_DEFAULT_TIMEZONE,
  isProfileComplete,
  loadProfileDraft,
  profileRequiredMissing,
  saveProfileDraft,
  type ProfileDraftStorage,
} from '../profile-form'

function memoryStorage(initial: Record<string, string> = {}): ProfileDraftStorage & { data: Record<string, string> } {
  const data = { ...initial }
  return {
    data,
    getItem: (key) => (key in data ? data[key] : null),
    setItem: (key, value) => {
      data[key] = value
    },
  }
}

describe('profile defaults and gating', () => {
  it('defaults to Russian with Europe/Moscow', () => {
    expect(DEFAULT_PROFILE_FORM.interfaceLanguage).toBe('ru')
    expect(DEFAULT_PROFILE_FORM.communicationLanguage).toBe('ru')
    expect(DEFAULT_PROFILE_FORM.timezone).toBe(PROFILE_DEFAULT_TIMEZONE)
    expect(PROFILE_DEFAULT_TIMEZONE).toBe('Europe/Moscow')
  })

  it('blocks Continue until the name is filled', () => {
    expect(isProfileComplete(DEFAULT_PROFILE_FORM)).toBe(false)
    expect(profileRequiredMissing(DEFAULT_PROFILE_FORM)).toEqual(['name'])
    expect(isProfileComplete({ ...DEFAULT_PROFILE_FORM, name: 'Алиса' })).toBe(true)
    expect(isProfileComplete({ ...DEFAULT_PROFILE_FORM, name: '   ' })).toBe(false)
  })

  it('reports every empty required field', () => {
    const missing = profileRequiredMissing({
      ...DEFAULT_PROFILE_FORM,
      name: 'Al',
      interfaceLanguage: '',
      timezone: '',
    })
    expect(missing).toEqual(['interfaceLanguage', 'timezone'])
  })
})

describe('profile draft persistence', () => {
  it('round-trips a saved draft', () => {
    const storage = memoryStorage()
    const value = { ...DEFAULT_PROFILE_FORM, name: 'Алиса', city: 'Москва', bubbles: ['design', 'ai'] }
    saveProfileDraft(storage, value)
    expect(loadProfileDraft(storage)).toEqual(value)
  })

  it('returns null for a missing or malformed draft', () => {
    const storage = memoryStorage({ 'rox.onboarding.profile-draft.v1': '{not json' })
    expect(loadProfileDraft(storage)).toBeNull()
    expect(loadProfileDraft(memoryStorage())).toBeNull()
  })

  it('fills missing fields from defaults and drops bad bubbles', () => {
    const storage = memoryStorage({
      'rox.onboarding.profile-draft.v1': JSON.stringify({ name: 'Алиса', bubbles: ['design', 7] }),
    })
    const draft = loadProfileDraft(storage)
    expect(draft).toMatchObject({ name: 'Алиса', timezone: PROFILE_DEFAULT_TIMEZONE, bubbles: [] })
  })

  it('is a no-op without storage', () => {
    expect(() => saveProfileDraft(undefined, DEFAULT_PROFILE_FORM)).not.toThrow()
    expect(loadProfileDraft(undefined)).toBeNull()
  })
})