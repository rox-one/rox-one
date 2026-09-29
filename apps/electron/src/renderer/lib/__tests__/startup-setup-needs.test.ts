import { describe, expect, it } from 'bun:test'
import { decideStartupAppState, probeSetupNeeds } from '../startup-setup-needs'
import type { SetupNeeds } from '../../../shared/types'

const configured = { isFullyConfigured: true, needsBillingConfig: false, needsCredentials: false } as SetupNeeds
const notConfigured = { isFullyConfigured: false, needsBillingConfig: true, needsCredentials: true } as SetupNeeds
const noSleep = async () => {}

describe('startup setup-needs gate', () => {
  it('retries transient RPC failures instead of falling into onboarding', async () => {
    let calls = 0
    const probe = await probeSetupNeeds(async () => {
      calls++
      if (calls < 3) throw new Error('Not connected (channel: onboarding:getAuthState)')
      return configured
    }, { sleep: noSleep })
    expect(probe.ok).toBe(true)
    expect(probe.attempts).toBe(3)
    expect(decideStartupAppState({ probe, usernameConfirmed: true, workspaceId: 'ws' })).toBe('ready')
  })

  it('a set-up user whose RPC keeps failing goes to the app, not onboarding', async () => {
    const probe = await probeSetupNeeds(async () => { throw new Error('Request timeout') }, { sleep: noSleep, delaysMs: [1, 1] })
    expect(probe.ok).toBe(false)
    expect(probe.attempts).toBe(3)
    expect(decideStartupAppState({ probe, usernameConfirmed: true, workspaceId: 'ws' })).toBe('ready')
    expect(decideStartupAppState({ probe, usernameConfirmed: true, workspaceId: null })).toBe('workspace-picker')
  })

  it('a new user still gets onboarding on failure', async () => {
    const probe = await probeSetupNeeds(async () => { throw new Error('x') }, { sleep: noSleep, delaysMs: [] })
    expect(decideStartupAppState({ probe, usernameConfirmed: false, workspaceId: 'ws' })).toBe('onboarding')
  })

  it('a definitive "not configured" answer shows onboarding', async () => {
    const probe = await probeSetupNeeds(async () => notConfigured, { sleep: noSleep })
    expect(decideStartupAppState({ probe, usernameConfirmed: true, workspaceId: 'ws' })).toBe('onboarding')
  })
})
