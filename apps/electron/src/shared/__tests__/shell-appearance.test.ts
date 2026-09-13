import { describe, expect, it } from 'bun:test'
import {
  WINDOWS_MICA_BUILD,
  ZEN_SHELL_FLAG,
  parseShellMaterialPreference,
  parseZenShellEnabled,
  parseZenShellPatch,
  resolveShellMaterial,
  snapshotZenShell,
  type ResolveShellMaterialInput,
} from '../shell-appearance'

function base(overrides: Partial<ResolveShellMaterialInput> = {}): ResolveShellMaterialInput {
  return {
    zenEnabled: true,
    preference: 'system',
    platform: 'darwin',
    reduceTransparency: false,
    highContrast: false,
    paintHealthy: true,
    windowDestroyed: false,
    gpuFailed: false,
    ...overrides,
  }
}

describe('parseZenShellEnabled / parseShellMaterialPreference', () => {
  it('treats only boolean true as enabled (flag default OFF)', () => {
    expect(parseZenShellEnabled(undefined)).toBe(false)
    expect(parseZenShellEnabled(false)).toBe(false)
    expect(parseZenShellEnabled('true')).toBe(false)
    expect(parseZenShellEnabled(1)).toBe(false)
    expect(parseZenShellEnabled(true)).toBe(true)
  })

  it('defaults unknown preference to system', () => {
    expect(parseShellMaterialPreference(undefined)).toBe('system')
    expect(parseShellMaterialPreference('acrylic')).toBe('system')
    expect(parseShellMaterialPreference('glass')).toBe('glass')
    expect(parseShellMaterialPreference('opaque')).toBe('opaque')
  })
})

describe('parseZenShellPatch', () => {
  it('accepts enabled and materialPreference only', () => {
    expect(parseZenShellPatch({ enabled: true, materialPreference: 'glass' })).toEqual({
      enabled: true,
      materialPreference: 'glass',
    })
    expect(parseZenShellPatch({})).toEqual({})
  })

  it('rejects BrowserWindow options and extra keys', () => {
    expect(() => parseZenShellPatch({ transparent: true })).toThrow(/Unexpected zen shell field/)
    expect(() => parseZenShellPatch({ backgroundColor: '#000' })).toThrow(/Unexpected zen shell field/)
    expect(() => parseZenShellPatch({ vibrancy: 'under-window' })).toThrow(/Unexpected zen shell field/)
    expect(() => parseZenShellPatch({ enabled: true, titleBarStyle: 'hiddenInset' })).toThrow(/Unexpected zen shell field/)
    expect(() => parseZenShellPatch(null)).toThrow(/Invalid zen shell patch/)
    expect(() => parseZenShellPatch('glass')).toThrow(/Invalid zen shell patch/)
  })
})

describe('resolveShellMaterial', () => {
  it('does not emit glass when zen is disabled (resolver not used for OFF path)', () => {
    expect(resolveShellMaterial(base({ zenEnabled: false, preference: 'glass' }))).toEqual({
      material: 'solid',
      fallbackReason: 'zen-disabled',
    })
  })

  it('macOS system/glass → vibrancy when paint is healthy', () => {
    expect(resolveShellMaterial(base({ preference: 'system' })).material).toBe('vibrancy')
    expect(resolveShellMaterial(base({ preference: 'glass' })).material).toBe('vibrancy')
  })

  it('Windows mica only at build >= 22000; older Zen branch is solid not acrylic', () => {
    expect(WINDOWS_MICA_BUILD).toBe(22000)
    expect(resolveShellMaterial(base({
      platform: 'win32',
      windowsBuild: 22621,
      preference: 'glass',
    })).material).toBe('mica')
    expect(resolveShellMaterial(base({
      platform: 'win32',
      windowsBuild: 19045,
      preference: 'glass',
    }))).toEqual({
      material: 'solid',
      fallbackReason: 'unknown-capability',
    })
  })

  it('Linux and web are honest solid', () => {
    expect(resolveShellMaterial(base({ platform: 'linux', preference: 'glass' }))).toEqual({
      material: 'solid',
      fallbackReason: 'unsupported-platform',
    })
    expect(resolveShellMaterial(base({ platform: 'web', preference: 'system' }))).toEqual({
      material: 'solid',
      fallbackReason: 'unsupported-platform',
    })
  })

  it('user opaque, reduce transparency, high contrast, missing paint, gpu, destroyed beat glass', () => {
    expect(resolveShellMaterial(base({ preference: 'opaque' })).fallbackReason).toBe('user-opaque')
    expect(resolveShellMaterial(base({ preference: 'glass', reduceTransparency: true })).fallbackReason).toBe('reduce-transparency')
    expect(resolveShellMaterial(base({ preference: 'glass', highContrast: true })).fallbackReason).toBe('high-contrast')
    expect(resolveShellMaterial(base({ preference: 'glass', paintHealthy: false })).fallbackReason).toBe('no-healthy-paint')
    expect(resolveShellMaterial(base({ preference: 'glass', gpuFailed: true })).fallbackReason).toBe('gpu-failure')
    expect(resolveShellMaterial(base({ preference: 'glass', windowDestroyed: true })).fallbackReason).toBe('window-destroyed')
  })

  it('accessibility beats user glass even on capable macOS', () => {
    const resolved = resolveShellMaterial(base({
      preference: 'glass',
      reduceTransparency: true,
      platform: 'darwin',
    }))
    expect(resolved.material).toBe('solid')
    expect(resolved.fallbackReason).toBe('reduce-transparency')
  })
})

describe('snapshotZenShell', () => {
  it('exposes the typed flag name and resolved material', () => {
    const snap = snapshotZenShell(base({ preference: 'glass' }))
    expect(snap.flag).toBe(ZEN_SHELL_FLAG)
    expect(snap.flag).toBe('shell.zen.v1')
    expect(snap.enabled).toBe(true)
    expect(snap.material).toBe('vibrancy')
    expect(snap.preference).toBe('glass')
    expect(snap.platform).toBe('darwin')
  })
})
