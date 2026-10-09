import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  cloudVmStateMessageKey,
  isWebSession,
  probeCloudVmState,
  resolveCloudVmState,
} from '../web-modes.ts'

describe('resolveCloudVmState — availability', () => {
  test('reports a Daytona provider as available when enabled and keyed', () => {
    expect(resolveCloudVmState({ enabled: true, provider: 'daytona', tokenConfigured: true }))
      .toEqual({ status: 'available', provider: 'daytona' })
  })

  test('reports the native provider as available when enabled and keyed', () => {
    expect(resolveCloudVmState({ enabled: true, provider: 'native', tokenConfigured: true }))
      .toEqual({ status: 'available', provider: 'native' })
  })
})

describe('resolveCloudVmState — unavailable paths carry the concrete reason', () => {
  test('host reporting runs disabled', () => {
    // The not-live short-circuit carries no provider.
    expect(resolveCloudVmState({ enabled: false, tokenConfigured: false }))
      .toEqual({ status: 'unavailable', reason: 'runs-disabled' })
  })

  test('host reporting a local provider is not a cloud VM', () => {
    expect(resolveCloudVmState({ enabled: true, provider: 'local', tokenConfigured: true }))
      .toEqual({ status: 'unavailable', reason: 'local-provider', provider: 'local' })
  })

  test('missing provider credential names the provider', () => {
    expect(resolveCloudVmState({ enabled: true, provider: 'daytona', tokenConfigured: false }))
      .toEqual({ status: 'unavailable', reason: 'provider-key-missing', provider: 'daytona' })
  })

  test('absent host status is unavailable, never a success', () => {
    expect(resolveCloudVmState(undefined)).toEqual({ status: 'unavailable', reason: 'host-unavailable' })
    expect(resolveCloudVmState(null)).toEqual({ status: 'unavailable', reason: 'host-unavailable' })
  })
})

describe('resolveCloudVmState — error paths', () => {
  test('non-object payload is a probe failure', () => {
    expect(resolveCloudVmState('nope')).toEqual({ status: 'error', reason: 'probe-failed' })
  })

  test('enabled without a provider name is an undocumented shape', () => {
    expect(resolveCloudVmState({ enabled: true })).toEqual({ status: 'error', reason: 'probe-failed' })
  })
})

describe('probeCloudVmState', () => {
  test('rejects a missing host', async () => {
    expect(await probeCloudVmState(undefined)).toEqual({ status: 'error', reason: 'probe-failed' })
  })

  test('maps a rejected RPC to a probe failure', async () => {
    const host = { getCloudRunsConfig: async () => { throw new Error('bridge down') } }
    expect(await probeCloudVmState(host)).toEqual({ status: 'error', reason: 'probe-failed' })
  })

  test('passes a usable provider through', async () => {
    const host = { getCloudRunsConfig: async () => ({ enabled: true, provider: 'daytona', tokenConfigured: true }) }
    expect(await probeCloudVmState(host)).toEqual({ status: 'available', provider: 'daytona' })
  })

  test('surfaces the disabled reason without inventing availability', async () => {
    const host = { getCloudRunsConfig: async () => ({ enabled: false, tokenConfigured: false }) }
    expect(await probeCloudVmState(host)).toEqual({ status: 'unavailable', reason: 'runs-disabled' })
  })
})

describe('cloudVmStateMessageKey', () => {
  test('maps every resolved state to a distinct i18n key', () => {
    const keys = new Set([
      cloudVmStateMessageKey({ status: 'available', provider: 'daytona' }),
      cloudVmStateMessageKey({ status: 'error', reason: 'probe-failed' }),
      cloudVmStateMessageKey({ status: 'unavailable', reason: 'runs-disabled' }),
      cloudVmStateMessageKey({ status: 'unavailable', reason: 'local-provider' }),
      cloudVmStateMessageKey({ status: 'unavailable', reason: 'provider-key-missing' }),
      cloudVmStateMessageKey({ status: 'unavailable', reason: 'host-unavailable' }),
    ])
    expect(keys.size).toBe(6)
    expect(cloudVmStateMessageKey({ status: 'available', provider: 'daytona' })).toBe('webui.modes.cloudAvailable')
    expect(cloudVmStateMessageKey({ status: 'unavailable', reason: 'provider-key-missing' }))
      .toBe('webui.modes.cloudReasonKeyMissing')
  })
})

describe('isWebSession', () => {
  test('accepts both web auth modes', () => {
    expect(isWebSession({ authMode: 'oidc' })).toBe(true)
    expect(isWebSession({ authMode: 'password' })).toBe(true)
  })

  test('rejects anything else so the desktop-like flow is preserved', () => {
    expect(isWebSession(null)).toBe(false)
    expect(isWebSession({})).toBe(false)
    expect(isWebSession({ authMode: 'bearer' })).toBe(false)
    expect(isWebSession('oidc')).toBe(false)
  })
})

describe('web entry wiring', () => {
  const app = readFileSync(join(import.meta.dir, '../App.tsx'), 'utf8')
  const landing = readFileSync(join(import.meta.dir, '../web-modes-landing.tsx'), 'utf8')

  test('the landing is gated to confirmed web sessions and skips deep links', () => {
    expect(app).toContain('isWebSession')
    expect(app).toContain('webSession && !entered && !directSessionId')
    expect(app).toContain("new URLSearchParams(window.location.search).get('sessionId')")
  })

  test('the landing reads cloud-runs availability from the host adapter', () => {
    expect(app).toContain('<WebModesLanding host={window.electronAPI}')
    expect(landing).toContain('probeCloudVmState')
    expect(landing).toContain('cloudVmStateMessageKey')
  })
})