import { describe, expect, it } from 'bun:test'
import {
  nextStepAfterUsername,
  parseOnboardingUsername,
} from '../onboarding-username'

describe('parseOnboardingUsername', () => {
  it('trims and accepts a name', () => {
    expect(parseOnboardingUsername('  Ada  ')).toBe('Ada')
  })

  it('rejects empty or whitespace', () => {
    expect(parseOnboardingUsername('')).toBeNull()
    expect(parseOnboardingUsername('   ')).toBeNull()
  })

  it('rejects names longer than 80 characters', () => {
    expect(parseOnboardingUsername('a'.repeat(81))).toBeNull()
    expect(parseOnboardingUsername('a'.repeat(80))).toBe('a'.repeat(80))
  })
})

describe('nextStepAfterUsername', () => {
  it('closes the wizard when setup is already complete', () => {
    expect(nextStepAfterUsername({
      isFullyConfigured: true,
      applyRoxConnectGate: true,
      gitBashMissing: true,
    })).toBe('complete')
  })

  it('keeps Rox Connect and Git Bash gates after the name step', () => {
    expect(nextStepAfterUsername({
      isFullyConfigured: false,
      applyRoxConnectGate: true,
      gitBashMissing: true,
    })).toBe('rox-connect')
    expect(nextStepAfterUsername({
      isFullyConfigured: false,
      applyRoxConnectGate: false,
      gitBashMissing: true,
    })).toBe('git-bash')
  })

  it('continues to provider select on a normal first run', () => {
    expect(nextStepAfterUsername({
      isFullyConfigured: false,
      applyRoxConnectGate: false,
      gitBashMissing: false,
    })).toBe('provider-select')
  })
})
