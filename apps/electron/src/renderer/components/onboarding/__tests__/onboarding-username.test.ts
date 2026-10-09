import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  HANDLE_CHECK_DEBOUNCE_MS,
  ONBOARDING_ORGANIZATION_MAX,
  ONBOARDING_USERNAME_MAX,
  ROX_COIN_REWARDS,
  createHandleAvailabilityTracker,
  defaultOnboardingOrganization,
  identityCoinState,
  nextStepAfterUsername,
  normalizeHandleInput,
  parseHandleAvailabilityResponse,
  parseOnboardingOrganization,
  parseOnboardingUsername,
  persistOnboardingUsername,
  reservedIdentityAddresses,
  resolveOnboardingOrganization,
  shouldShowReservedBlock,
  type OnboardingIdentityApi,
  type OnboardingCallerIdentity,
} from '../onboarding-username'

describe('parseOnboardingUsername validation table', () => {
  it('accepts the allowed latin/digit/_/- charset at both length bounds', () => {
    expect(parseOnboardingUsername('ABCD')).toBe('ABCD')
    expect(parseOnboardingUsername('ada_99')).toBe('ada_99')
    expect(parseOnboardingUsername('a-b_1')).toBe('a-b_1')
    expect(parseOnboardingUsername('a'.repeat(ONBOARDING_USERNAME_MAX))).toBe('a'.repeat(ONBOARDING_USERNAME_MAX))
  })

  it('is case-insensitive: upper and lower case are both valid', () => {
    expect(parseOnboardingUsername('Ada_99')).toBe('Ada_99')
    expect(parseOnboardingUsername('ada_99')).toBe('ada_99')
    expect(parseOnboardingUsername('ADA_99')).toBe('ADA_99')
  })

  it('trims surrounding whitespace but rejects internal spaces', () => {
    expect(parseOnboardingUsername('  ada_99  ')).toBe('ada_99')
    expect(parseOnboardingUsername('ada 99')).toBeNull()
    expect(parseOnboardingUsername('ada\t99')).toBeNull()
  })

  it('rejects values outside 4–16 characters', () => {
    expect(parseOnboardingUsername('abc')).toBeNull()
    expect(parseOnboardingUsername('a'.repeat(ONBOARDING_USERNAME_MAX + 1))).toBeNull()
  })

  it('rejects disallowed characters and empty input', () => {
    expect(parseOnboardingUsername('')).toBeNull()
    expect(parseOnboardingUsername('   ')).toBeNull()
    expect(parseOnboardingUsername('ada.99')).toBeNull()
    expect(parseOnboardingUsername('ada@99')).toBeNull()
    expect(parseOnboardingUsername('ада_99')).toBeNull()
  })

  it('rejects control characters before normalization', () => {
    expect(parseOnboardingUsername('ada\u0000_99')).toBeNull()
    expect(parseOnboardingUsername('ada\n_99')).toBeNull()
    expect(parseOnboardingUsername('ada\u0085_99')).toBeNull()
  })

  it('applies NFC and then enforces the ASCII charset', () => {
    expect(normalizeHandleInput('  A\u0301da  ')).toBe('\u00c1da')
    // Decomposed latin letters normalize to non-ASCII and are rejected.
    expect(parseOnboardingUsername('\u0041\u0301da_99')).toBeNull()
  })
})

describe('organization validation and default naming', () => {
  it('accepts the same charset at 4–32 characters', () => {
    expect(parseOnboardingOrganization('ada_org')).toBe('ada_org')
    expect(parseOnboardingOrganization('a'.repeat(ONBOARDING_ORGANIZATION_MAX))).toBe('a'.repeat(ONBOARDING_ORGANIZATION_MAX))
  })

  it('rejects too short, too long, spaced, and empty values', () => {
    expect(parseOnboardingOrganization('abc')).toBeNull()
    expect(parseOnboardingOrganization('a'.repeat(ONBOARDING_ORGANIZATION_MAX + 1))).toBeNull()
    expect(parseOnboardingOrganization('org name')).toBeNull()
    expect(parseOnboardingOrganization('')).toBeNull()
    expect(parseOnboardingOrganization('   ')).toBeNull()
  })

  it('suggests `${username}_org`', () => {
    expect(defaultOnboardingOrganization('ada_99')).toBe('ada_99_org')
  })

  it('resolves an explicit value, the suggested default, or null', () => {
    expect(resolveOnboardingOrganization('ada_99', 'my-org')).toBe('my-org')
    expect(resolveOnboardingOrganization('ada_99', '   ')).toBe('ada_99_org')
    expect(resolveOnboardingOrganization('ada_99', 'bad!')).toBeNull()
    // The default only exists once the username itself is valid.
    expect(resolveOnboardingOrganization('abc', '')).toBeNull()
  })
})

describe('handle availability state machine', () => {
  it('maps explicit responses and never assumes availability', () => {
    expect(parseHandleAvailabilityResponse({ available: true })).toBe('available')
    expect(parseHandleAvailabilityResponse({ available: false })).toBe('taken')
    expect(parseHandleAvailabilityResponse({ available: false, reason: 'reserved' })).toBe('reserved')
    expect(parseHandleAvailabilityResponse({ status: 'available' })).toBe('available')
    expect(parseHandleAvailabilityResponse({ status: 'taken' })).toBe('taken')
    expect(parseHandleAvailabilityResponse({ status: 'reserved' })).toBe('reserved')
  })

  it('reports unknown for anything unrecognized', () => {
    expect(parseHandleAvailabilityResponse(null)).toBe('unknown')
    expect(parseHandleAvailabilityResponse(undefined)).toBe('unknown')
    expect(parseHandleAvailabilityResponse('available')).toBe('unknown')
    expect(parseHandleAvailabilityResponse({})).toBe('unknown')
    expect(parseHandleAvailabilityResponse({ available: 'yes' })).toBe('unknown')
    expect(parseHandleAvailabilityResponse({ status: 'wat' })).toBe('unknown')
  })

  it('drops stale (out-of-order) responses', () => {
    const tracker = createHandleAvailabilityTracker()
    const first = tracker.begin('ada_99')
    const second = tracker.begin('bob_77')
    expect(tracker.settle(first, 'available')).toBeNull()
    expect(tracker.settle(second, 'taken')).toBe('taken')
  })

  it('invalidates outstanding requests', () => {
    const tracker = createHandleAvailabilityTracker()
    const token = tracker.begin('ada_99')
    tracker.invalidate()
    expect(tracker.settle(token, 'available')).toBeNull()
  })

  it('only shows the green reserved block for an explicit available', () => {
    expect(shouldShowReservedBlock('available')).toBe(true)
    for (const status of ['idle', 'checking', 'invalid', 'taken', 'reserved', 'unknown'] as const) {
      expect(shouldShowReservedBlock(status)).toBe(false)
    }
  })
})

describe('reserved addresses and coin badges', () => {
  it('builds lowercase rox.one addresses from the resolved identity', () => {
    expect(reservedIdentityAddresses('ada_99', 'ada_99_org')).toEqual({
      handle: 'rox.one/@ada_99',
      organization: 'rox.one/@ada_99_org',
      email: 'ada_99@rox.one',
    })
    // Case-insensitive uniqueness: typed case is preserved for display but the
    // emitted addresses are always lowercase.
    expect(reservedIdentityAddresses('Ada_99', 'My-Org')).toEqual({
      handle: 'rox.one/@ada_99',
      organization: 'rox.one/@my-org',
      email: 'ada_99@rox.one',
    })
  })

  it('golds the username badge only for an explicit available', () => {
    const base = { organizationAccepted: false, telegramLinked: false, githubLinked: false }
    expect(identityCoinState({ ...base, usernameStatus: 'available' }).username).toBe(true)
    for (const usernameStatus of ['idle', 'checking', 'invalid', 'taken', 'reserved', 'unknown'] as const) {
      expect(identityCoinState({ ...base, usernameStatus }).username).toBe(false)
    }
  })

  it('golds organization/Telegram/GitHub badges when their action completes', () => {
    expect(identityCoinState({
      usernameStatus: 'idle',
      organizationAccepted: true,
      telegramLinked: true,
      githubLinked: true,
    })).toEqual({ username: false, organization: true, telegram: true, github: true })
  })

  it('carries the informational reward amounts only', () => {
    expect(ROX_COIN_REWARDS).toEqual({ username: 5, organization: 5, telegram: 15, github: 5 })
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

describe('WelcomeStep identity block', () => {
  it('validates, probes availability, and persists the identity through privileged APIs', () => {
    const source = readFileSync(join(import.meta.dir, '../WelcomeStep.tsx'), 'utf8')
    expect(source).toContain('parseOnboardingUsername')
    expect(source).toContain('persistOnboardingUsername(api, parsedUsername')
    expect(source).not.toContain('onboardingUsernameConfirmed')
    expect(source).toContain("orgIdentity.authority === 'local'")
    expect(source).toContain('ONBOARDING_USERNAME_MAX')
    expect(source).toContain('checkOnboardingHandle')
    expect(source).toContain('parsed.toLowerCase()')
    expect(source).toContain('parseHandleAvailabilityResponse')
    expect(source).toContain('HANDLE_CHECK_DEBOUNCE_MS')
    expect(source).toContain('createHandleAvailabilityTracker')
    expect(source).toContain('shouldShowReservedBlock')
    expect(source).toContain('usernameSaveFailed')
    expect(source).toContain('TelegramLinkDialog')
    expect(source).toContain('GithubDeviceLoginPanel')
    expect(source).toContain('rememberLocalProfile')
    expect(source).toContain('RoxCoinIcon')
    expect(source).not.toContain('caught.message')
  })

  it('never hardcodes availability or a balance', () => {
    const source = readFileSync(join(import.meta.dir, '../WelcomeStep.tsx'), 'utf8')
    expect(source).not.toMatch(/status:\s*'available'/)
    expect(source).not.toMatch(/balance/)
  })
})

describe('authenticated onboarding profile persistence', () => {
  function fixture(authority: 'native' | 'local') {
    let identity: OnboardingCallerIdentity = { authority, userId: 'current-user', ...(authority === 'native' ? { issuer: 'server-a' } : {}) }
    const updates: Array<{ username?: string; name?: string; organization?: string }> = []
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
    await persistOnboardingUsername(f.api, '  native_ada  ')
    expect(f.updates).toEqual([{ username: 'native_ada', name: 'native_ada' }])
    expect(f.hostUpdates).toEqual([])
    expect((await f.api.getOrgIdentity()).name).toBe('native_ada')
  })

  it('retains legacy local profile updates and confirms persistent name readback', async () => {
    const f = fixture('local')
    await persistOnboardingUsername(f.api, 'local_ada')
    expect(f.hostUpdates).toEqual(['local_ada'])
    expect(f.updates).toEqual([{ username: 'local_ada', name: 'local_ada' }])
  })

  it('adds the organization and public handle to the payload when available', async () => {
    const f = fixture('native')
    await persistOnboardingUsername(f.api, 'ada_99', { publicHandle: 'ada_99', organization: 'ada_99_org' })
    expect(f.updates).toEqual([{ username: 'ada_99', name: 'ada_99', organization: 'ada_99_org' }])
  })

  it('drops invalid extras instead of blocking the local save', async () => {
    const f = fixture('local')
    await persistOnboardingUsername(f.api, 'ada_99', { organization: 'bad!' })
    expect(f.updates).toEqual([{ username: 'ada_99', name: 'ada_99' }])
  })

  it('rejects failed saves without advancing through a host-profile fallback', async () => {
    const f = fixture('native')
    f.api.updateOrgIdentity = async () => { throw new Error('revoked') }
    await expect(persistOnboardingUsername(f.api, 'ada_99')).rejects.toThrow('revoked')
    expect(f.hostUpdates).toEqual([])
  })

  it('rejects a successful response whose durable name did not change', async () => {
    const f = fixture('native')
    f.api.updateOrgIdentity = async () => ({ name: 'ada_99' })
    await expect(persistOnboardingUsername(f.api, 'ada_99')).rejects.toThrow('identity-readback-mismatch')
  })

  it('rejects a workspace or account switch during save even if the name matches', async () => {
    const f = fixture('native')
    f.api.updateOrgIdentity = async () => f.setIdentity({ authority: 'native', userId: 'other-user', name: 'ada_99' })
    await expect(persistOnboardingUsername(f.api, 'ada_99')).rejects.toThrow('identity-readback-mismatch')
  })

  it('rejects a native issuer change with the same subject and display name', async () => {
    const f = fixture('native')
    f.api.updateOrgIdentity = async () => f.setIdentity({ authority: 'native', issuer: 'server-b', userId: 'current-user', name: 'ada_99' })
    await expect(persistOnboardingUsername(f.api, 'ada_99')).rejects.toThrow('identity-readback-mismatch')
  })

  it('keeps control-char rejection before any identity mutation', async () => {
    const f = fixture('native')
    await persistOnboardingUsername(f.api, '  ada_99  ')
    expect(f.updates).toEqual([{ username: 'ada_99', name: 'ada_99' }])
    await expect(persistOnboardingUsername(f.api, 'ada\n_99')).rejects.toThrow('invalid-username')
    await expect(persistOnboardingUsername(f.api, 'ada\u0085_99')).rejects.toThrow('invalid-username')
    expect(f.updates).toHaveLength(1)
  })

  it('rejects invalid input before any identity mutation', async () => {
    const f = fixture('local')
    await expect(persistOnboardingUsername(f.api, '   ')).rejects.toThrow('invalid-username')
    await expect(persistOnboardingUsername(f.api, 'abc')).rejects.toThrow('invalid-username')
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
    expect(app).not.toMatch(/needs.isFullyConfigured && usernameConfirmed/)
  })
})

describe('debounce contract', () => {
  it('uses a 400 ms debounce window', () => {
    expect(HANDLE_CHECK_DEBOUNCE_MS).toBe(400)
  })
})