/**
 * Pure model for the onboarding permissions & data-access column.
 *
 * Kept free of React and IPC so the gating rules, defaults and OS-status
 * mapping can be unit-tested directly.
 */

export type PermissionKey =
  | 'fullDiskAccess'
  | 'automation'
  | 'accessibility'
  | 'screenRecording'
  | 'audioRecording'
  | 'inputMonitoring'
  | 'keepAwake'
  | 'importAiHistory'
  | 'installedAppsInfo'
  | 'launchAgent'
  | 'browserAutomation'

export type PermissionValues = Record<PermissionKey, boolean>

/** Honest OS-reported state; mirrors the server snapshot. */
export type PermissionStatus = 'granted' | 'denied' | 'unknown' | 'unsupported'

export type PermissionStatuses = Partial<Record<PermissionKey, PermissionStatus>>

export interface PermissionStatusSnapshot {
  platform: string
  statuses: PermissionStatuses
}

export interface PermissionSettingsResult {
  opened: boolean
  url?: string
  hint?: 'unsupported' | 'no-deep-link' | 'unknown-permission' | 'open-failed'
}

/** Permissions mediated by the OS; their value is derived, never user-authored. */
export const OS_PERMISSION_KEYS = [
  'fullDiskAccess',
  'automation',
  'accessibility',
  'screenRecording',
  'audioRecording',
  'inputMonitoring',
] as const

/** Pure in-app toggles; default ON and freely user-controlled. */
export const APP_TOGGLE_KEYS = [
  'keepAwake',
  'importAiHistory',
  'installedAppsInfo',
  'launchAgent',
  'browserAutomation',
] as const

export const PERMISSION_KEYS = [...OS_PERMISSION_KEYS, ...APP_TOGGLE_KEYS] as const

/** Render order of the right column. */
export const PERMISSION_ROWS: readonly PermissionKey[] = [
  'fullDiskAccess',
  'automation',
  'accessibility',
  'screenRecording',
  'audioRecording',
  'inputMonitoring',
  'keepAwake',
  'browserAutomation',
  'importAiHistory',
  'installedAppsInfo',
  'launchAgent',
]

const OS_KEY_LOOKUP: Record<string, true> = {
  fullDiskAccess: true,
  automation: true,
  accessibility: true,
  screenRecording: true,
  audioRecording: true,
  inputMonitoring: true,
}

export function isOsPermission(key: PermissionKey): boolean {
  return OS_KEY_LOOKUP[key] === true
}

/** Only an explicit grant maps to `true`; denied/unknown/unsupported stay `false`. */
export function permissionStatusToValue(status: PermissionStatus | undefined): boolean {
  return status === 'granted'
}

/**
 * Defaults: in-app toggles ON; OS-permission rows start from the real status
 * when it is known and fall back to `false` when it is not.
 */
export function defaultPermissionValues(statuses: PermissionStatuses = {}): PermissionValues {
  const values: PermissionValues = {
    keepAwake: true,
    importAiHistory: true,
    installedAppsInfo: true,
    launchAgent: true,
    browserAutomation: true,
    fullDiskAccess: false,
    automation: false,
    accessibility: false,
    screenRecording: false,
    audioRecording: false,
    inputMonitoring: false,
  }
  for (const key of OS_PERMISSION_KEYS) values[key] = permissionStatusToValue(statuses[key])
  return values
}

/**
 * Re-applies freshly probed OS statuses onto a value bag while preserving
 * user-authored in-app toggles. Idempotent, so an effect can call it safely.
 */
export function mergePermissionStatuses(
  current: PermissionValues,
  statuses: PermissionStatuses,
): PermissionValues {
  const next = { ...current }
  for (const key of OS_PERMISSION_KEYS) {
    if (key in statuses) next[key] = permissionStatusToValue(statuses[key])
  }
  return next
}

export function permissionValuesEqual(a: PermissionValues, b: PermissionValues): boolean {
  return PERMISSION_KEYS.every((key) => a[key] === b[key])
}

/**
 * An OS-permission row is interactive (opens System Settings) only when the OS
 * reported it as anything but already-granted; `unsupported` has nothing to open.
 */
export function canOpenPermissionSettings(status: PermissionStatus | undefined): boolean {
  return status === 'denied' || status === 'unknown'
}