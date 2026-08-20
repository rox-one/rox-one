import { afterEach, describe, expect, it } from 'bun:test'
import type { NativeSidecarClient } from '../client.ts'
import { nativeSidecarHealthCheck, setNativeSidecarSupervisorForTests } from '../supervisor.ts'
import type { NativeSupervisor } from '../supervisor.ts'

const ORIGINAL = {
  CRAFT_FEATURE_NATIVE_SIDECAR: process.env.CRAFT_FEATURE_NATIVE_SIDECAR,
  CRAFT_FEATURE_NATIVE_INDEX_PRIMARY: process.env.CRAFT_FEATURE_NATIVE_INDEX_PRIMARY,
  CRAFT_FEATURE_NATIVE_JOURNAL_PRIMARY: process.env.CRAFT_FEATURE_NATIVE_JOURNAL_PRIMARY,
}

afterEach(() => {
  setNativeSidecarSupervisorForTests(null)
  for (const [key, value] of Object.entries(ORIGINAL)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

describe('nativeSidecarHealthCheck', () => {
  it('passes as disabled when the sidecar flag is off', () => {
    delete process.env.CRAFT_FEATURE_NATIVE_SIDECAR
    const check = nativeSidecarHealthCheck()
    expect(check.name).toBe('native_sidecar')
    expect(check.status).toBe('pass')
    expect(check.message).toContain('disabled')
  })

  it('fails when the sidecar is enabled but not connected', () => {
    process.env.CRAFT_FEATURE_NATIVE_SIDECAR = '1'
    const check = nativeSidecarHealthCheck()
    expect(check.status).toBe('fail')
    expect(check.message).toMatch(/not connected|not live/i)
  })

  it('passes when a sidecar client is live', () => {
    process.env.CRAFT_FEATURE_NATIVE_SIDECAR = '1'
    process.env.CRAFT_FEATURE_NATIVE_INDEX_PRIMARY = '1'
    setNativeSidecarSupervisorForTests({
      getClient: () =>
        ({
          registeredChannels: ['native:health', 'index:status'],
          invoke: async () => ({ ok: true }),
          close: async () => {},
        }) as NativeSidecarClient,
    } as unknown as NativeSupervisor)
    const check = nativeSidecarHealthCheck()
    expect(check.status).toBe('pass')
    expect(check.message).toContain('live')
    expect(check.message).toContain('indexPrimary=true')
  })
})
