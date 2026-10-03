import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  nextStepAfterUsername,
  parseOnboardingUsername,
  persistOnboardingUsername,
  type OnboardingIdentityApi,
  type OnboardingCallerIdentity,
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
  it('reuses the parser and persists the name through privileged identity APIs', () => {
    const source = readFileSync(join(import.meta.dir, '../WelcomeStep.tsx'), 'utf8')
    expect(source).toContain('parseOnboardingUsername')
    expect(source).toContain('persistOnboardingUsername(api, parsed)')
    expect(source).not.toContain('onboardingUsernameConfirmed')
    expect(source).toContain("orgIdentity.authority === 'local'")
    expect(source).toContain('ONBOARDING_USERNAME_MAX')
    expect(source).toContain('usernameSaveFailed')
    expect(source).toContain('usernameTooLong')
    expect(source).toContain('rememberLocalProfile')
    expect(source).not.toContain('caught.message')
  })
})

describe('authenticated onboarding profile persistence', () => {
  function fixture(authority: 'native' | 'local') {
    let identity: OnboardingCallerIdentity = { authority, userId: 'current-user', ...(authority === 'native' ? { issuer: 'server-a' } : {}) }
    const updates: Array<{ username?: string; name?: string }> = []
    const hostUpdates: string[] = []
    const api: OnboardingIdentityApi = {
      getOrgIdentity: async () => ({ ...identity }),
      updateOrgIdentity: async update => {
        updates.push(update)
        identity = { ...identity, name: update.name }
      },
      identityUpdateProfile: async update => { hostUpdates.push(update.displayName) },
    }
    return { api, updates, hostUpdates, setIdentity: (value: OnboardingCallerIdentity) => { identity = value } }
  }

  it('saves native self metadata without reading or changing the host profile', async () => {
    const f = fixture('native')
    delete f.api.identityUpdateProfile
    await persistOnboardingUsername(f.api, '  Native Ada  ')
    expect(f.updates).toEqual([{ name: 'Native Ada' }])
    expect(f.hostUpdates).toEqual([])
    expect((await f.api.getOrgIdentity()).name).toBe('Native Ada')
  })

  it('retains legacy local profile updates and confirms persistent name readback', async () => {
    const f = fixture('local')
    await persistOnboardingUsername(f.api, 'Local Ada')
    expect(f.hostUpdates).toEqual(['Local Ada'])
    expect(f.updates).toEqual([{ username: 'Local Ada', name: 'Local Ada' }])
  })

  it('rejects failed saves without advancing through a host-profile fallback', async () => {
    const f = fixture('native')
    f.api.updateOrgIdentity = async () => { throw new Error('revoked') }
    await expect(persistOnboardingUsername(f.api, 'Ada')).rejects.toThrow('revoked')
    expect(f.hostUpdates).toEqual([])
  })

  it('rejects a successful response whose durable name did not change', async () => {
    const f = fixture('native')
    f.api.updateOrgIdentity = async () => ({ name: 'Ada' })
    await expect(persistOnboardingUsername(f.api, 'Ada')).rejects.toThrow('identity-readback-mismatch')
  })

  it('rejects a workspace or account switch during save even if the name matches', async () => {
    const f = fixture('native')
    f.api.updateOrgIdentity = async () => f.setIdentity({ authority: 'native', userId: 'other-user', name: 'Ada' })
    await expect(persistOnboardingUsername(f.api, 'Ada')).rejects.toThrow('identity-readback-mismatch')
  })

  it('rejects a native issuer change with the same subject and display name', async () => {
    const f = fixture('native')
    f.api.updateOrgIdentity = async () => f.setIdentity({ authority: 'native', issuer: 'server-b', userId: 'current-user', name: 'Ada' })
    await expect(persistOnboardingUsername(f.api, 'Ada')).rejects.toThrow('identity-readback-mismatch')
  })

  it('uses the same Unicode and whitespace normalization as native profile storage', async () => {
    const f = fixture('native')
    await persistOnboardingUsername(f.api, '  A\u0301da  Native  ')
    expect(f.updates).toEqual([{ name: '\u00c1da Native' }])
    await expect(persistOnboardingUsername(f.api, 'Ada\nOther')).rejects.toThrow('invalid-username')
    expect(f.updates).toHaveLength(1)
  })

  it('rejects invalid input before any identity mutation', async () => {
    const f = fixture('local')
    await expect(persistOnboardingUsername(f.api, '   ')).rejects.toThrow('invalid-username')
    expect(f.updates).toEqual([])
    expect(f.hostUpdates).toEqual([])
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
