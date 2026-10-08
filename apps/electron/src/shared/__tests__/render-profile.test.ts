import { describe, expect, it } from 'bun:test'
import {
  isSoftwareCompositing,
  isWeakHardware,
  parseRenderProfilePreference,
  resolveRenderProfile,
} from '../render-profile'
import { parseZenShellPatch, resolveShellMaterial, snapshotZenShell, type ResolveShellMaterialInput } from '../shell-appearance'

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

describe('PERF-07 weak hardware on auto', () => {
  const GiB = 1024 ** 3
  it('counts < 7.5 GiB RAM or <= 4 logical cores as weak', () => {
    expect(isWeakHardware({ totalMemoryBytes: 7.5 * GiB - 1, logicalCpuCount: 16 })).toBe(true)
    expect(isWeakHardware({ totalMemoryBytes: 32 * GiB, logicalCpuCount: 4 })).toBe(true)
    expect(isWeakHardware({ totalMemoryBytes: 8 * GiB, logicalCpuCount: 5 })).toBe(false)
    // usable-vs-installed tolerance: a nominal 8 GB machine reads ~7.6–7.9 GiB
    expect(isWeakHardware({ totalMemoryBytes: 7.6 * GiB, logicalCpuCount: 8 })).toBe(false)
    expect(isWeakHardware({ totalMemoryBytes: 7.5 * GiB, logicalCpuCount: 8 })).toBe(false)
  })

  it('treats unknown values as not weak', () => {
    expect(isWeakHardware(undefined)).toBe(false)
    expect(isWeakHardware({})).toBe(false)
    expect(isWeakHardware({ totalMemoryBytes: 0, logicalCpuCount: 0 })).toBe(false)
    expect(isWeakHardware({ totalMemoryBytes: Number.NaN, logicalCpuCount: Number.NaN })).toBe(false)
    expect(isWeakHardware({ totalMemoryBytes: 2 * GiB })).toBe(true)
  })

  it('feeds the resolver on auto only', () => {
    const weak = { totalMemoryBytes: 4 * GiB, logicalCpuCount: 2 }
    expect(resolveRenderProfile({ preference: 'auto', platform: 'darwin', softwareCompositing: false, hardware: weak }))
      .toEqual({ profile: 'performance', reason: 'weak-hardware' })
    expect(resolveRenderProfile({ preference: 'standard', platform: 'darwin', softwareCompositing: false, hardware: weak }).profile)
      .toBe('standard')
    expect(resolveRenderProfile({ preference: 'auto', platform: 'darwin', softwareCompositing: false, hardware: { totalMemoryBytes: 16 * GiB, logicalCpuCount: 8 } }).profile)
      .toBe('standard')
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

  it('low-power resolves the native material to solid; standard keeps glass', () => {
    expect(resolveShellMaterial({ ...base, renderProfile: 'performance' })).toEqual({ material: 'solid', fallbackReason: 'low-power' })
    expect(resolveShellMaterial({ ...base, platform: 'win32', windowsBuild: 22621, renderProfile: 'performance' }).material).toBe('solid')
    expect(resolveShellMaterial({ ...base, renderProfile: 'standard' })).toEqual({ material: 'vibrancy' })
    expect(resolveShellMaterial({ ...base, platform: 'win32', windowsBuild: 22621, renderProfile: 'standard' })).toEqual({ material: 'mica' })
    // Accessibility and explicit opaque keep their own, earlier reasons.
    expect(resolveShellMaterial({ ...base, highContrast: true, renderProfile: 'performance' }).fallbackReason).toBe('high-contrast')
    expect(resolveShellMaterial({ ...base, preference: 'opaque', renderProfile: 'performance' }).fallbackReason).toBe('user-opaque')
    expect(snapshotZenShell(base, { profile: 'standard', preference: 'auto', reason: 'default' }).material).toBe('vibrancy')
  })

  it('ships the profile inside the shell snapshot and lets it feed the material', () => {
    const withProfile = snapshotZenShell(base, { profile: 'performance', preference: 'auto', reason: 'software-compositing' })
    expect(withProfile.material).toBe('solid')
    expect(withProfile.fallbackReason).toBe('low-power')
    expect(withProfile.renderProfile).toBe('performance')
    expect(withProfile.renderProfilePreference).toBe('auto')
    expect(withProfile.renderProfileReason).toBe('software-compositing')
    const legacy = snapshotZenShell(base)
    expect(legacy.renderProfile).toBeUndefined()
    expect(snapshotZenShell({ ...base, zenEnabled: false }, { profile: 'performance', preference: 'auto', reason: 'windows' }).renderProfile)
      .toBe('performance')
  })
})
