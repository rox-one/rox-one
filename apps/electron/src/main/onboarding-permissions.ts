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
import { shell, systemPreferences } from 'electron'
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

function electronPermissionSurface(): OnboardingPermissionSurface {
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