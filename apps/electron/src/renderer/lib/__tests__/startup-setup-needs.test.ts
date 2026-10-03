import { describe, expect, it } from 'bun:test'
import { decideStartupAppState, probeSetupNeeds, probeWithRetry, recoverStartupWorkspace } from '../startup-setup-needs'
import type { SetupNeeds } from '../../../shared/types'

const configured = { isFullyConfigured: true, needsBillingConfig: false, needsCredentials: false } as SetupNeeds
const notConfigured = { isFullyConfigured: false, needsBillingConfig: true, needsCredentials: true } as SetupNeeds
const noSleep = async () => {}
const identityProbe = { ok: true, value: { authority: 'native', name: 'Verified name' }, attempts: 1 } as const
const workspaceProbe = { ok: true, value: 'ws', attempts: 1 } as const

describe('bounded startup readback', () => {
  it('retries transient RPC failures within one probe budget', async () => {
    let calls = 0
    const probe = await probeSetupNeeds(async () => {
      if (++calls < 3) throw new Error('Not connected')
      return configured
    }, { sleep: noSleep })
    expect(probe).toMatchObject({ ok: true, value: configured, attempts: 3 })
  })

  it('a hung request cannot extend a probe past its deadline', async () => {
    const started = Date.now()
    const probe = await probeWithRetry(() => new Promise<never>(() => {}), { deadlineMs: 50, delaysMs: [10, 10] })
    expect(probe).toMatchObject({ ok: false, attempts: 1 })
    expect(Date.now() - started).toBeLessThan(1000)
  })

  it('stops retrying when its overall budget is spent', async () => {
    let now = 0
    let calls = 0
    const probe = await probeWithRetry(async () => { calls++; now += 400; throw new Error('offline') }, {
      deadlineMs: 1000, delaysMs: [300, 300, 300], sleep: async ms => { now += ms }, now: () => now,
    })
    expect(probe.ok).toBe(false)
    expect(calls).toBeLessThanOrEqual(2)
  })

  it.each(['AUTH_FAILED', 'FORBIDDEN', 'UNAUTHENTICATED', 'UNAUTHORIZED'])('terminal %s denial is never retried', async code => {
    let calls = 0
    const probe = await probeWithRetry(async () => { calls++; throw Object.assign(new Error('denied'), { code }) }, { sleep: noSleep })
    expect(probe.ok).toBe(false)
    expect(calls).toBe(1)
    expect(decideStartupAppState({ identityProbe: probe, workspaceProbe })).toBe('transport-unavailable')
  })

  it('requires a fresh identity and authoritative workspace rather than cached completion', () => {
    const failed = { ok: false, error: new Error('AUTH_FAILED'), attempts: 1 } as const
    expect(decideStartupAppState({ identityProbe: failed, workspaceProbe })).toBe('transport-unavailable')
    expect(decideStartupAppState({ identityProbe: { ok: true, value: null, attempts: 1 }, workspaceProbe })).toBe('transport-unavailable')
    expect(decideStartupAppState({ identityProbe, workspaceProbe: failed })).toBe('transport-unavailable')
    expect(decideStartupAppState({ identityProbe, workspaceProbe })).toBe('ready')
  })

  it('requires the actual persisted display name and keeps provider readiness separate', async () => {
    expect((await probeSetupNeeds(async () => notConfigured, { sleep: noSleep })).ok).toBe(true)
    expect(decideStartupAppState({ identityProbe, workspaceProbe })).toBe('ready')
    expect(decideStartupAppState({ identityProbe: { ...identityProbe, value: { authority: 'local', name: ' ' } }, workspaceProbe })).toBe('onboarding')
  })

  it('a successful missing workspace is a real picker result', () => {
    expect(decideStartupAppState({ identityProbe, workspaceProbe: { ...workspaceProbe, value: null } })).toBe('workspace-picker')
  })
})

describe('workspace readback after transport recovery', () => {
  it('re-reads a failed workspace and requires the resulting current readback', async () => {
    let calls = 0
    const read = async () => { if (++calls === 1) throw new Error('offline'); return 'saved-workspace' }
    const first = await probeWithRetry(read, { delaysMs: [] })
    const setup = await probeSetupNeeds(async () => notConfigured, { delaysMs: [] })
    const recovered = await recoverStartupWorkspace(first, setup, read, { delaysMs: [] })
    expect(calls).toBe(2)
    expect(recovered).toMatchObject({ ok: true, value: 'saved-workspace' })
    expect(decideStartupAppState({ identityProbe, workspaceProbe: recovered })).toBe('ready')
  })

  it('does not turn authoritative null into a synthetic recovered workspace', async () => {
    let calls = 0
    const existing = { ok: true, value: null, attempts: 1 } as const
    const setup = await probeSetupNeeds(async () => configured, { delaysMs: [] })
    expect(await recoverStartupWorkspace(existing, setup, async () => { calls++; return 'unexpected' })).toBe(existing)
    expect(calls).toBe(0)
  })

  it('does not claim recovery when both probes remain failed', async () => {
    let calls = 0
    const failed = { ok: false, error: new Error('offline'), attempts: 1 } as const
    expect(await recoverStartupWorkspace(failed, failed, async () => { calls++; return 'unexpected' })).toBe(failed)
    expect(calls).toBe(0)
  })
})


describe('mandatory Pocket startup gate', () => {
  it('gates an upgraded installation with a persisted local name but no central account', () => {
    expect(decideStartupAppState({ identityProbe, workspaceProbe, cloudProbe: { ok: true, value: { required: true, connected: false }, attempts: 1 } })).toBe('onboarding')
  })
  it('accepts a ready central account without a local display name', () => {
    expect(decideStartupAppState({ identityProbe: { ok: true, value: { authority: 'local', name: '' }, attempts: 1 }, workspaceProbe, cloudProbe: { ok: true, value: { required: true, connected: true }, attempts: 1 } })).toBe('ready')
  })
  it('cannot substitute local state for a failed account read', () => {
    expect(decideStartupAppState({ identityProbe, workspaceProbe, cloudProbe: { ok: false, error: Error('offline'), attempts: 1 } })).toBe('transport-unavailable')
  })
})
