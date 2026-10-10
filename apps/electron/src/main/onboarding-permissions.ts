/**
 * Electron-main implementation of the onboarding permission probes.
 *
 * Best-effort and non-blocking: every probe is wrapped so a missing API, a
 * sandbox denial or an unexpected OS answer becomes an honest
 * `unknown`/`unsupported` state instead of an exception. The RPC handler in
 * server-core calls this through `deps.onboardingPermissions`; server-core
 * itself stays free of `electron` imports.
 */
import { constants } from 'node:fs'
import { access } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { desktopCapturer, shell, systemPreferences } from 'electron'
import {
  ONBOARDING_OS_PERMISSION_KEYS,
  unsupportedPermissionStatuses,
  type OnboardingOsPermissionKey,
  type OnboardingPermissionStatus,
  type OnboardingPermissionsHost,
  type OnboardingPermissionsSnapshot,
  type OpenPermissionSettingsResult,
} from '@rox/server-core/handlers/rpc/onboarding-permissions'

// Re-exported for the main-process tests, which import these types from this module.
export type {
  OnboardingPermissionStatus,
  OnboardingPermissionsSnapshot,
  OpenPermissionSettingsResult,
} from '@rox/server-core/handlers/rpc/onboarding-permissions'

/**
 * System Settings deep links (macOS) for each OS-mediated permission.
 * Values are the documented `x-apple.systempreferences:` privacy pane anchors.
 */
export const MAC_PERMISSION_DEEP_LINKS: Record<OnboardingOsPermissionKey, string> = {
  fullDiskAccess: 'x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles',
  automation: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Automation',
  accessibility: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
  screenRecording: 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
  audioRecording: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone',
  inputMonitoring: 'x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent',
}

/** Windows `ms-settings:` links, only where a dedicated privacy page exists. */
export const WINDOWS_PERMISSION_DEEP_LINKS: Partial<Record<OnboardingOsPermissionKey, string>> = {
  audioRecording: 'ms-settings:privacy-microphone',
}

/** Injectable seam so probes are testable without a real Electron runtime. */
export interface OnboardingPermissionSurface {
  platform: string
  getMediaAccessStatus(kind: 'microphone' | 'screen'): string | undefined
  isTrustedAccessibilityClient(prompt: boolean): boolean | undefined
  probeFullDiskAccess(): Promise<OnboardingPermissionStatus>
  openExternal(url: string): Promise<void>
  /**
   * Interactive prompt seams. Optional so probe-only surfaces stay cheap; a
   * missing method means the platform cannot ask for that permission.
   */
  askForMediaAccess?(kind: 'microphone' | 'camera'): Promise<boolean>
  /** Attempt a screen capture to make the OS raise the screen-recording prompt. */
  requestScreenCaptureAccess?(): Promise<void>
}

function isOsPermissionKey(key: string): key is OnboardingOsPermissionKey {
  return (ONBOARDING_OS_PERMISSION_KEYS as readonly string[]).includes(key)
}

/** macOS/Linux answer of `systemPreferences.getMediaAccessStatus` → honest status. */
export function mapMediaAccessStatus(raw: string | undefined): OnboardingPermissionStatus {
  switch (raw) {
    case 'granted':
      return 'granted'
    case 'denied':
    case 'restricted':
      return 'denied'
    default:
      return 'unknown'
  }
}

/**
 * Full Disk Access cannot be asked through an API; a read probe against a
 * TCC-protected path is the documented best effort. `EPERM`/`EACCES` means the
 * TCC gate is closed; `ENOENT` is inconclusive (the file can also be absent).
 */
export async function probeFullDiskAccess(): Promise<OnboardingPermissionStatus> {
  const tccDatabase = join(homedir(), 'Library', 'Application Support', 'com.apple.TCC', 'TCC.db')
  try {
    await access(tccDatabase, constants.R_OK)
    return 'granted'
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code
    if (code === 'EACCES' || code === 'EPERM') return 'denied'
    return 'unknown'
  }
}

/** Reads one boolean probe, degrading to `undefined` when the API is missing/throws. */
function readBooleanProbe(probe: () => boolean | undefined): boolean | undefined {
  try {
    return probe()
  } catch {
    return undefined
  }
}

export async function probeOnboardingPermissions(
  surface: OnboardingPermissionSurface,
): Promise<OnboardingPermissionsSnapshot> {
  const { platform } = surface

  if (platform !== 'darwin') {
    // Windows exposes a real microphone privacy-page but no programmatic read;
    // every other key is a macOS-only concept. Linux mediates neither.
    const statuses = unsupportedPermissionStatuses()
    if (platform === 'win32') statuses.audioRecording = 'unknown'
    return { platform, statuses }
  }

  const statuses: Partial<Record<OnboardingOsPermissionKey, OnboardingPermissionStatus>> = {}
  try {
    statuses.fullDiskAccess = await surface.probeFullDiskAccess()
  } catch {
    statuses.fullDiskAccess = 'unknown'
  }
  statuses.audioRecording = mapMediaAccessStatus(surface.getMediaAccessStatus('microphone'))
  statuses.screenRecording = mapMediaAccessStatus(surface.getMediaAccessStatus('screen'))

  const trusted = readBooleanProbe(() => surface.isTrustedAccessibilityClient(false))
  statuses.accessibility = trusted === undefined ? 'unknown' : trusted ? 'granted' : 'denied'

  // No reliable public API exists for these two; claim nothing.
  statuses.automation = 'unknown'
  statuses.inputMonitoring = 'unknown'

  return { platform, statuses }
}

/** Deep-link target for one permission, or a stable hint code when none exists. */
export function permissionSettingsTarget(
  key: string,
  platform: string,
): { url?: string; hint?: OpenPermissionSettingsResult['hint'] } {
  if (!isOsPermissionKey(key)) return { hint: 'unknown-permission' }
  if (platform === 'linux' || platform === 'freebsd' || platform === 'openbsd' || platform === 'sunos') {
    return { hint: 'unsupported' }
  }
  const url = platform === 'win32' ? WINDOWS_PERMISSION_DEEP_LINKS[key] : platform === 'darwin' ? MAC_PERMISSION_DEEP_LINKS[key] : undefined
  if (url) return { url }
  return { hint: platform === 'darwin' || platform === 'win32' ? 'no-deep-link' : 'unsupported' }
}

export async function openPermissionSettings(
  surface: OnboardingPermissionSurface,
  key: string,
): Promise<OpenPermissionSettingsResult> {
  const target = permissionSettingsTarget(key, surface.platform)
  if (!target.url) return { opened: false, hint: target.hint }
  try {
    await surface.openExternal(target.url)
    return { opened: true, url: target.url }
  } catch {
    return { opened: false, url: target.url, hint: 'open-failed' }
  }
}

/** Permissions that have an interactive OS prompt (as opposed to a read probe). */
export type PermissionPromptAction = 'accessibility' | 'screenRecording' | 'microphone' | 'camera'

/**
 * Honest outcome of an interactive prompt. Prompting is best-effort: a missing
 * API, a sandbox denial or a thrown OS call degrades to `supported: false` or
 * `status: 'unknown'` instead of throwing.
 */
export interface PermissionPromptOutcome {
  readonly action: PermissionPromptAction
  /** The platform exposes an API to ask for this permission. */
  readonly supported: boolean
  /** An OS prompt/request was actually issued (the API was invoked). */
  readonly prompted: boolean
  /** Honest post-prompt status; `unknown` when the OS gave no answer. */
  readonly status: OnboardingPermissionStatus
  /** Stable reason when `prompted` is false. */
  readonly reason?: 'unsupported' | 'unavailable'
}

/**
 * Ask the OS for one permission and return the honest outcome. Opt-in: callers
 * invoke this explicitly — importing this module never prompts.
 *
 * - `accessibility` sets the System Settings prompt via
 *   `isTrustedAccessibilityClient(true)`;
 * - `screenRecording` attempts a capture to make the OS prompt, then aborts;
 * - `microphone`/`camera` go through `askForMediaAccess`.
 *
 * A `denied` outcome is not retried here; callers should fall back to
 * `openPermissionSettings` to send the user to the right pane.
 */
export async function promptPermission(
  surface: OnboardingPermissionSurface,
  action: PermissionPromptAction,
): Promise<PermissionPromptOutcome> {
  if (surface.platform !== 'darwin') {
    return { action, supported: false, prompted: false, status: 'unsupported', reason: 'unsupported' }
  }

  if (action === 'accessibility') {
    const trusted = readBooleanProbe(() => surface.isTrustedAccessibilityClient(true))
    if (trusted === undefined) return { action, supported: true, prompted: false, status: 'unknown', reason: 'unavailable' }
    return { action, supported: true, prompted: true, status: trusted ? 'granted' : 'denied' }
  }

  if (action === 'screenRecording') {
    if (!surface.requestScreenCaptureAccess) {
      return { action, supported: false, prompted: false, status: 'unsupported', reason: 'unavailable' }
    }
    let prompted = false
    try {
      await surface.requestScreenCaptureAccess()
      prompted = true
    } catch {
      prompted = false
    }
    return { action, supported: true, prompted, status: mapMediaAccessStatus(surface.getMediaAccessStatus('screen')) }
  }

  if (!surface.askForMediaAccess) {
    return { action, supported: false, prompted: false, status: 'unsupported', reason: 'unavailable' }
  }
  try {
    const granted = await surface.askForMediaAccess(action)
    return { action, supported: true, prompted: true, status: granted ? 'granted' : 'denied' }
  } catch {
    return { action, supported: true, prompted: true, status: 'unknown' }
  }
}

export function electronPermissionSurface(): OnboardingPermissionSurface {
  return {
    platform: process.platform,
    getMediaAccessStatus: (kind) => {
      try {
        return systemPreferences.getMediaAccessStatus(kind)
      } catch {
        return undefined
      }
    },
    isTrustedAccessibilityClient: (prompt) => {
      if (process.platform !== 'darwin') return undefined
      try {
        return systemPreferences.isTrustedAccessibilityClient(prompt)
      } catch {
        return undefined
      }
    },
    probeFullDiskAccess: () => (process.platform === 'darwin' ? probeFullDiskAccess() : Promise.resolve('unsupported')),
    openExternal: (url) => shell.openExternal(url),
    askForMediaAccess: (kind) => systemPreferences.askForMediaAccess(kind),
    requestScreenCaptureAccess: async () => {
      // `getSources` is the documented trigger for the macOS screen-recording
      // prompt; the request itself is aborted (thumbnails / frames discarded).
      await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } })
    },
  }
}

export function createOnboardingPermissionsHost(
  surface: OnboardingPermissionSurface = electronPermissionSurface(),
): OnboardingPermissionsHost {
  return {
    probePermissions: () => probeOnboardingPermissions(surface),
    openPermissionSettings: (key) => openPermissionSettings(surface, key),
  }
}