import { describe, expect, it } from 'bun:test'
import { decideStartupAppState, probeSetupNeeds, probeWithRetry, recoverStartupWorkspace } from '../startup-setup-needs'
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
    if (probe.ok) expect(probe.value).toBe(configured)
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

  it('a missing provider/account keeps a name-confirmed user in the app', async () => {
    const probe = await probeSetupNeeds(async () => notConfigured, { sleep: noSleep })
    expect(decideStartupAppState({ probe, usernameConfirmed: true, workspaceId: 'ws' })).toBe('ready')
  })
  it('a hung request cannot stretch startup past the overall deadline', async () => {
    const started = Date.now()
    const probe = await probeWithRetry(() => new Promise<never>(() => {}), { deadlineMs: 50, delaysMs: [10, 10, 10] })
    expect(probe.ok).toBe(false)
    expect(probe.attempts).toBe(1)
    expect(Date.now() - started).toBeLessThan(1000)
  })

  it('stops retrying once the deadline is spent', async () => {
    let t = 0
    let calls = 0
    const probe = await probeWithRetry(async () => { calls++; t += 400; throw new Error('boom') }, {
      deadlineMs: 1000, delaysMs: [300, 300, 300, 300], sleep: async (ms) => { t += ms }, now: () => t,
    })
    expect(probe.ok).toBe(false)
    expect(calls).toBeLessThanOrEqual(2)
  })
  it('denied startup transport retains name-only routing without claiming provider readiness', async () => {
    const probe = await probeSetupNeeds(async () => { throw new Error('AUTH_FAILED') }, { delaysMs: [] })
    expect(probe.ok).toBe(false)
    expect(decideStartupAppState({ probe, usernameConfirmed: true, workspaceId: 'ws' })).toBe('ready')
    expect(decideStartupAppState({ probe, usernameConfirmed: false, workspaceId: 'ws' })).toBe('onboarding')
  })
  it('name-confirmed missing workspace uses picker even with a successful unconfigured readback', async () => {
    const probe = await probeSetupNeeds(async () => notConfigured, { delaysMs: [] })
    expect(probe.ok).toBe(true)
    expect(decideStartupAppState({ probe, usernameConfirmed: true, workspaceId: null })).toBe('workspace-picker')
  })

})

describe('workspace readback after startup transport recovery', () => {
  it('re-reads a failed workspace probe after successful setup and routes existing user to ready', async () => {
    let calls = 0
    const readWorkspace = async () => { calls++; if (calls === 1) throw new Error('offline'); return 'saved-workspace' }
    const first = await probeWithRetry(readWorkspace, { delaysMs: [] })
    expect(first.ok).toBe(false)
    const setup = await probeSetupNeeds(async () => notConfigured, { delaysMs: [] })
    const recovered = await recoverStartupWorkspace(first, setup, readWorkspace, { delaysMs: [] })
    expect(calls).toBe(2)
    expect(recovered).toMatchObject({ ok: true, value: 'saved-workspace' })
    expect(decideStartupAppState({ probe: setup, usernameConfirmed: true, workspaceId: recovered.ok ? recovered.value : null })).toBe('ready')
  })
  it('keeps authoritative missing workspace and does not invent or overwrite its picker decision', async () => {
    let calls = 0
    const existing = { ok: true, value: null, attempts: 1 } as const
    const setup = await probeSetupNeeds(async () => configured, { delaysMs: [] })
    const result = await recoverStartupWorkspace(existing, setup, async () => { calls++; return 'unexpected' })
    expect(result).toBe(existing)
    expect(calls).toBe(0)
    expect(decideStartupAppState({ probe: setup, usernameConfirmed: true, workspaceId: result.ok ? result.value : null })).toBe('workspace-picker')
  })
  it('does not claim recovery when both transport probes remain failed', async () => {
    const failed = { ok: false, error: new Error('offline'), attempts: 1 } as const
    let calls = 0
    expect(await recoverStartupWorkspace(failed, failed, async () => { calls++; return 'workspace' })).toBe(failed)
    expect(calls).toBe(0)
  })
})
