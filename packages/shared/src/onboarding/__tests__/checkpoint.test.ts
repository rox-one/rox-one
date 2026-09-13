import { describe, expect, it } from 'bun:test'
import {
  decideOnboardingStep,
  emptyOnboardingCheckpoint,
  isAccountRegistered,
  memoryOnboardingStore,
  parseOnboardingCheckpoint,
  skipOnboardingStep,
} from '../checkpoint.ts'

describe('onboarding checkpoint (issue 340)', () => {
  it('resumes the saved step after restart', () => {
    const store = memoryOnboardingStore(emptyOnboardingCheckpoint('credentials'))
    expect(decideOnboardingStep({ checkpoint: store.read() })).toBe('credentials')
  })

  it('does not treat a local profile write as account registration', () => {
    const checkpoint = {
      ...emptyOnboardingCheckpoint('provider-select'),
      localProfile: { displayName: 'Mark' },
    }
    expect(isAccountRegistered(checkpoint)).toBe(false)
    expect(isAccountRegistered({
      ...checkpoint,
      accountAuth: { connected: true, provider: 'rox' },
    })).toBe(true)
  })

  it('skip records the step and continues', () => {
    const next = skipOnboardingStep(emptyOnboardingCheckpoint('provider-select'), 'provider-select', 'environment')
    expect(next.skipped).toEqual(['provider-select'])
    expect(next.step).toBe('environment')
  })

  it('unknown versions are ignored instead of crashing resume', () => {
    expect(parseOnboardingCheckpoint({ version: 99, step: 'welcome' })).toBeNull()
  })
})
