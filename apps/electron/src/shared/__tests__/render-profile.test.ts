import { describe, expect, it } from 'bun:test'
import {
  isSoftwareCompositing,
  parseRenderProfilePreference,
  resolveRenderProfile,
} from '../render-profile'
import { parseZenShellPatch, snapshotZenShell, type ResolveShellMaterialInput } from '../shell-appearance'

const base: ResolveShellMaterialInput = {
  zenEnabled: true,
  preference: 'system',
  platform: 'darwin',
  reduceTransparency: false,
  highContrast: false,
  paintHealthy: true,
  windowDestroyed: false,
  gpuFailed: false,
}

describe('PERF-07 resolveRenderProfile', () => {
  it('defaults the low-power profile on for Windows only', () => {
    expect(resolveRenderProfile({ preference: 'auto', platform: 'win32', softwareCompositing: false }))
      .toEqual({ profile: 'performance', reason: 'windows' })
    expect(resolveRenderProfile({ preference: 'auto', platform: 'darwin', softwareCompositing: false }))
      .toEqual({ profile: 'standard', reason: 'default' })
    expect(resolveRenderProfile({ preference: 'auto', platform: 'linux', softwareCompositing: false }))
      .toEqual({ profile: 'standard', reason: 'default' })
  })

  it('defaults it on for software or blocklisted GPU compositing on any platform', () => {
    for (const platform of ['darwin', 'linux', 'win32'] as const) {
      expect(resolveRenderProfile({ preference: 'auto', platform, softwareCompositing: true }).profile).toBe('performance')
    }
    expect(resolveRenderProfile({ preference: 'auto', platform: 'darwin', softwareCompositing: true }).reason)
      .toBe('software-compositing')
  })

  it('lets an explicit choice override the platform and GPU default', () => {
    expect(resolveRenderProfile({ preference: 'standard', platform: 'win32', softwareCompositing: true }))
      .toEqual({ profile: 'standard', reason: 'user-standard' })
    expect(resolveRenderProfile({ preference: 'performance', platform: 'darwin', softwareCompositing: false }))
      .toEqual({ profile: 'performance', reason: 'user-performance' })
  })
})

describe('PERF-07 isSoftwareCompositing', () => {
  it('reads gpu_compositing from app.getGPUFeatureStatus()', () => {
    for (const enabled of ['enabled', 'enabled_on', 'enabled_force', 'enabled_force_on', 'enabled_readback']) {
      expect(isSoftwareCompositing({ gpu_compositing: enabled })).toBe(false)
    }
    for (const weak of ['disabled_software', 'unavailable_software', 'disabled_off', 'unavailable_off', 'disabled_off_ok']) {
      expect(isSoftwareCompositing({ gpu_compositing: weak })).toBe(true)
    }
  })

  it('treats a missing or malformed status as unknown, not weak', () => {
    expect(isSoftwareCompositing(undefined)).toBe(false)
    expect(isSoftwareCompositing(null)).toBe(false)
    expect(isSoftwareCompositing({})).toBe(false)
    expect(isSoftwareCompositing({ gpu_compositing: '' })).toBe(false)
    expect(isSoftwareCompositing('disabled_software')).toBe(false)
  })
})

describe('PERF-07 preference parsing and snapshot transport', () => {
  it('parses persisted preferences with auto as the fallback', () => {
    expect(parseRenderProfilePreference(undefined)).toBe('auto')
    expect(parseRenderProfilePreference('turbo')).toBe('auto')
    expect(parseRenderProfilePreference('performance')).toBe('performance')
    expect(parseRenderProfilePreference('standard')).toBe('standard')
  })

  it('SET_ZEN_SHELL accepts renderProfile and still rejects other extra keys', () => {
    expect(parseZenShellPatch({ renderProfile: 'performance' })).toEqual({ renderProfile: 'performance' })
    expect(parseZenShellPatch({ enabled: true, renderProfile: 'auto' })).toEqual({ enabled: true, renderProfile: 'auto' })
    expect(() => parseZenShellPatch({ renderProfile: 'turbo' })).toThrow(/renderProfile/)
    expect(() => parseZenShellPatch({ renderProfile: true })).toThrow(/renderProfile/)
    expect(() => parseZenShellPatch({ lowPower: true })).toThrow(/Unexpected zen shell field/)
  })

  it('ships the profile inside the shell snapshot without changing the material', () => {
    const withProfile = snapshotZenShell(base, { profile: 'performance', preference: 'auto', reason: 'software-compositing' })
    expect(withProfile.material).toBe('vibrancy')
    expect(withProfile.renderProfile).toBe('performance')
    expect(withProfile.renderProfilePreference).toBe('auto')
    expect(withProfile.renderProfileReason).toBe('software-compositing')
    const legacy = snapshotZenShell(base)
    expect(legacy.renderProfile).toBeUndefined()
    expect(snapshotZenShell({ ...base, zenEnabled: false }, { profile: 'performance', preference: 'auto', reason: 'windows' }).renderProfile)
      .toBe('performance')
  })
})
