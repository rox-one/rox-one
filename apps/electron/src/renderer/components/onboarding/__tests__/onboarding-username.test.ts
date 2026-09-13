import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
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
  it('keeps Rox Connect and Git Bash gates after the name step', () => {
    expect(nextStepAfterUsername({
      applyRoxConnectGate: true,
      gitBashMissing: true,
    })).toBe('rox-connect')
    expect(nextStepAfterUsername({
      applyRoxConnectGate: false,
      gitBashMissing: true,
    })).toBe('git-bash')
  })

  it('continues to provider select even when OMP setup is already complete', () => {
    expect(nextStepAfterUsername({
      applyRoxConnectGate: false,
      gitBashMissing: false,
    })).toBe('provider-select')
  })
})

describe('WelcomeStep username gate', () => {
  it('reuses the parser and records onboardingUsernameConfirmed', () => {
    const source = readFileSync(join(import.meta.dir, '../WelcomeStep.tsx'), 'utf8')
    expect(source).toContain('parseOnboardingUsername')
    expect(source).toContain('onboardingUsernameConfirmed')
    expect(source).toContain('identityUpdateProfile')
    expect(source).toContain('ONBOARDING_USERNAME_MAX')
    expect(source).toContain('usernameSaveFailed')
    expect(source).toContain('usernameTooLong')
    expect(source).toContain('rememberLocalProfile')
    expect(source).not.toContain('caught.message')
  })
})

describe('useOnboarding welcome advance', () => {
  it('does not treat isFullyConfigured as wizard-complete and always shows the name field on Welcome', () => {
    const source = readFileSync(join(import.meta.dir, '../../../hooks/useOnboarding.ts'), 'utf8')
    expect(source).toContain('nextStepAfterUsername')
    expect(source).not.toMatch(/nextStepAfterUsername\(\{[\s\S]*isFullyConfigured/)
    expect(source).not.toMatch(/if \(next === 'complete'\)/)
    expect(source).toContain("initialStep === 'welcome' ? false")
    expect(source).toContain('skipSetupLandingStep')
    expect(source).toContain('completionStatus: \'complete\'')
  })
})
