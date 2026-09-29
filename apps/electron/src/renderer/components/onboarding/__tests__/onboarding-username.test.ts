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

  it('goes straight into the app (no provider picker) after the name', () => {
    expect(nextStepAfterUsername({
      applyRoxConnectGate: false,
      gitBashMissing: false,
    })).toBe('finish')
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
  it('finishes the first run with the Rox runtime instead of a provider picker', () => {
    const source = readFileSync(join(import.meta.dir, '../../../hooks/useOnboarding.ts'), 'utf8')
    expect(source).toContain('nextStepAfterUsername')
    expect(source).not.toMatch(/nextStepAfterUsername\(\{[\s\S]*isFullyConfigured/)
    expect(source).toMatch(/if \(next === 'finish'\)/)
    expect(source).toContain('ensureRoxRuntimeDefault')
    expect(source).toContain("initialStep === 'welcome' ? false")
    expect(source).not.toContain('skipSetupLandingStep')
    expect(source).not.toContain("step: 'environment'")
    expect(source).toContain('completionStatus: \'complete\'')
  })

  it('App opens onboarding only for an unconfirmed name', () => {
    const app = readFileSync(join(import.meta.dir, '../../../App.tsx'), 'utf8')
    expect(app).toContain("initialStep: 'welcome'")
    expect(app).not.toContain("usernameConfirmed ? 'provider-select'")
    expect(app).not.toMatch(/needs\.isFullyConfigured && usernameConfirmed/)
  })
})
