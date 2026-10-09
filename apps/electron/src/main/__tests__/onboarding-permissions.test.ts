import { beforeAll, describe, expect, it, mock } from 'bun:test'

// Static import cannot work: `electron` must be mocked before the module graph
// loads, so the component is loaded dynamically in `beforeAll`. Type-only
// imports are erased and safe to keep top-level.
import type {
  OnboardingPermissionStatus,
  OnboardingPermissionSurface,
  OnboardingPermissionsSnapshot,
  OpenPermissionSettingsResult,
} from '../onboarding-permissions'

// The module under test imports `electron` for its default surface; the pure
// helpers are exercised through an injected surface, so a minimal mock is enough.
mock.module('electron', () => ({
  systemPreferences: {
    getMediaAccessStatus: () => 'unknown',
    isTrustedAccessibilityClient: () => false,
    askForMediaAccess: async () => false,
  },
  desktopCapturer: { getSources: async () => [] },
  shell: { openExternal: async () => {} },
}))

interface PermissionsModule {
  mapMediaAccessStatus(raw: string | undefined): OnboardingPermissionStatus
  openPermissionSettings(surface: OnboardingPermissionSurface, key: string): Promise<OpenPermissionSettingsResult>
  permissionSettingsTarget(key: string, platform: string): { url?: string; hint?: OpenPermissionSettingsResult['hint'] }
  probeOnboardingPermissions(surface: OnboardingPermissionSurface): Promise<OnboardingPermissionsSnapshot>
}

let mapMediaAccessStatus: PermissionsModule['mapMediaAccessStatus']
let openPermissionSettings: PermissionsModule['openPermissionSettings']
let permissionSettingsTarget: PermissionsModule['permissionSettingsTarget']
let probeOnboardingPermissions: PermissionsModule['probeOnboardingPermissions']

beforeAll(async () => {
  const loaded = (await import('../onboarding-permissions')) as PermissionsModule
  ;({ mapMediaAccessStatus, openPermissionSettings, permissionSettingsTarget, probeOnboardingPermissions } = loaded)
})

type Surface = OnboardingPermissionSurface

function darwinSurface(overrides: Partial<Surface> = {}): Surface {
  return {
    platform: 'darwin',
    getMediaAccessStatus: () => 'unknown',
    isTrustedAccessibilityClient: () => false,
    probeFullDiskAccess: async () => 'unknown',
    openExternal: async () => {},
    ...overrides,
  }
}

describe('permissionSettingsTarget deep links', () => {
  it('maps every macOS permission to its privacy pane anchor', () => {
    const expected: Record<string, string> = {
      fullDiskAccess: 'Privacy_AllFiles',
      automation: 'Privacy_Automation',
      accessibility: 'Privacy_Accessibility',
      screenRecording: 'Privacy_ScreenCapture',
      audioRecording: 'Privacy_Microphone',
      inputMonitoring: 'Privacy_ListenEvent',
    }
    for (const [key, anchor] of Object.entries(expected)) {
      const target = permissionSettingsTarget(key, 'darwin')
      expect(target.hint).toBeUndefined()
      expect(target.url).toBe(`x-apple.systempreferences:com.apple.preference.security?${anchor}`)
    }
  })

  it('maps Windows microphone to ms-settings and hints for keys without a page', () => {
    expect(permissionSettingsTarget('audioRecording', 'win32')).toEqual({ url: 'ms-settings:privacy-microphone' })
    expect(permissionSettingsTarget('accessibility', 'win32').hint).toBe('no-deep-link')
    expect(permissionSettingsTarget('fullDiskAccess', 'win32').url).toBeUndefined()
  })

  it('reports unsupported on Linux and unknown keys', () => {
    expect(permissionSettingsTarget('audioRecording', 'linux').hint).toBe('unsupported')
    expect(permissionSettingsTarget('nope', 'darwin').hint).toBe('unknown-permission')
  })
})

describe('mapMediaAccessStatus', () => {
  it('keeps only explicit grants as granted and folds restricted into denied', () => {
    expect(mapMediaAccessStatus('granted')).toBe('granted')
    expect(mapMediaAccessStatus('denied')).toBe('denied')
    expect(mapMediaAccessStatus('restricted')).toBe('denied')
    expect(mapMediaAccessStatus('not-determined')).toBe('unknown')
    expect(mapMediaAccessStatus(undefined)).toBe('unknown')
  })
})

describe('probeOnboardingPermissions', () => {
  it('reads macOS statuses per permission and leaves unprobeable ones unknown', async () => {
    const snapshot = await probeOnboardingPermissions(
      darwinSurface({
        getMediaAccessStatus: (kind) => (kind === 'microphone' ? 'granted' : 'denied'),
        isTrustedAccessibilityClient: () => true,
        probeFullDiskAccess: async () => 'denied',
      }),
    )
    expect(snapshot.platform).toBe('darwin')
    expect(snapshot.statuses.fullDiskAccess).toBe('denied')
    expect(snapshot.statuses.audioRecording).toBe('granted')
    expect(snapshot.statuses.screenRecording).toBe('denied')
    expect(snapshot.statuses.accessibility).toBe('granted')
    expect(snapshot.statuses.automation).toBe('unknown')
    expect(snapshot.statuses.inputMonitoring).toBe('unknown')
  })

  it('degrades to unknown when the accessibility or full-disk probes throw', async () => {
    const snapshot = await probeOnboardingPermissions(
      darwinSurface({
        isTrustedAccessibilityClient: () => {
          throw new Error('nope')
        },
        probeFullDiskAccess: async () => {
          throw new Error('nope')
        },
      }),
    )
    expect(snapshot.statuses.accessibility).toBe('unknown')
    expect(snapshot.statuses.fullDiskAccess).toBe('unknown')
  })

  it('answers unsupported off macOS, except the Windows microphone privacy page', async () => {
    const win = await probeOnboardingPermissions(darwinSurface({ platform: 'win32' }))
    expect(win.statuses.audioRecording).toBe('unknown')
    expect(win.statuses.fullDiskAccess).toBe('unsupported')
    expect(win.statuses.accessibility).toBe('unsupported')

    const linux = await probeOnboardingPermissions(darwinSurface({ platform: 'linux' }))
    expect(linux.statuses.audioRecording).toBe('unsupported')
    expect(linux.statuses.automation).toBe('unsupported')
  })
})

describe('openPermissionSettings', () => {
  it('opens the deep link and reports success', async () => {
    const opened: string[] = []
    const result = await openPermissionSettings(
      darwinSurface({ openExternal: async (url) => void opened.push(url) }),
      'screenRecording',
    )
    expect(result.opened).toBe(true)
    expect(opened).toEqual(['x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'])
  })

  it('never throws and reports failure when the OS rejects the open', async () => {
    const result = await openPermissionSettings(
      darwinSurface({
        openExternal: async () => {
          throw new Error('denied')
        },
      }),
      'accessibility',
    )
    expect(result.opened).toBe(false)
    expect(result.hint).toBe('open-failed')
  })

  it('reports unsupported where no system settings exist', async () => {
    const result = await openPermissionSettings(darwinSurface({ platform: 'linux' }), 'audioRecording')
    expect(result).toEqual({ opened: false, hint: 'unsupported' })
  })
})