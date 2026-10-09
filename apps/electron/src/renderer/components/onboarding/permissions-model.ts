/**
 * Onboarding — permissions & modes model.
 *
 * Pure data + gating rules for the right-hand "Разрешения и режимы" column.
 * Everything here is display-agnostic: the component renders i18n keys, and
 * native/Eelectron access stays behind props. Keeping the rules pure means the
 * column can be tested without a preload bridge.
 *
 * Platform model:
 * - macOS entries use TCC-backed permissions (`grantKind: 'tcc'`);
 * - Windows entries are the equivalents of the same capabilities;
 * - cross-platform "modes" are app-managed toggles (`grantKind: 'app-toggle'`).
 */

/** Stable ids referenced by i18n (`onboarding.permissions.items.<id>.*`). */
export type PermissionId =
  // macOS (TCC)
  | 'fullDiskAccess'
  | 'automation'
  | 'accessibility'
  | 'screenRecording'
  | 'audioRecording'
  | 'inputMonitoring'
  // Windows equivalents
  | 'winFileSystemAccess'
  | 'winMicrophone'
  | 'winScreenCapture'
  | 'winAutomation'
  // Cross-platform modes
  | 'keepAwake'
  | 'chatHistory'
  | 'installedApps'
  | 'launchAgent'
  | 'browserAutomation'

/** Where the entry is shown. */
export type PermissionEntryPlatform = 'all' | 'mac' | 'win'

/** The runtime we are rendering for. */
export type PermissionPlatform = 'mac' | 'win' | 'other'

/**
 * `tcc` — an OS-managed permission that a user can grant from the column.
 * `app-toggle` — a Rox-managed mode; nothing to grant at the OS level.
 */
export type GrantKind = 'tcc' | 'app-toggle'

/** Status of a system permission as reported by the host. */
export type GrantStatus = 'granted' | 'denied' | 'not-determined'

export interface PermissionEntry {
  id: PermissionId
  platform: PermissionEntryPlatform
  grantKind: GrantKind
  /** Preselected state per the customer requirement: everything starts on. */
  defaultOn: boolean
  /** Logical dependency (checked against OS grant status, not the toggle). */
  dependsOn?: PermissionId
}

/**
 * The full catalogue. Order is the render order, grouped macOS → Windows →
 * cross-platform so a filtered list still reads naturally.
 */
export const PERMISSION_ENTRIES: readonly PermissionEntry[] = [
  // macOS TCC permissions.
  { id: 'fullDiskAccess', platform: 'mac', grantKind: 'tcc', defaultOn: true },
  { id: 'automation', platform: 'mac', grantKind: 'tcc', defaultOn: true },
  { id: 'accessibility', platform: 'mac', grantKind: 'tcc', defaultOn: true },
  { id: 'screenRecording', platform: 'mac', grantKind: 'tcc', defaultOn: true },
  { id: 'audioRecording', platform: 'mac', grantKind: 'tcc', defaultOn: true },
  { id: 'inputMonitoring', platform: 'mac', grantKind: 'tcc', defaultOn: true },
  // Windows equivalents.
  { id: 'winFileSystemAccess', platform: 'win', grantKind: 'tcc', defaultOn: true },
  { id: 'winMicrophone', platform: 'win', grantKind: 'tcc', defaultOn: true },
  { id: 'winScreenCapture', platform: 'win', grantKind: 'tcc', defaultOn: true },
  { id: 'winAutomation', platform: 'win', grantKind: 'tcc', defaultOn: true },
  // Cross-platform modes.
  { id: 'keepAwake', platform: 'all', grantKind: 'app-toggle', defaultOn: true },
  { id: 'chatHistory', platform: 'all', grantKind: 'app-toggle', defaultOn: true },
  {
    id: 'installedApps',
    platform: 'all',
    grantKind: 'app-toggle',
    defaultOn: true,
    dependsOn: 'fullDiskAccess',
  },
  { id: 'launchAgent', platform: 'all', grantKind: 'app-toggle', defaultOn: true },
  { id: 'browserAutomation', platform: 'all', grantKind: 'app-toggle', defaultOn: true },
] as const

/**
 * Enablement + grant snapshot for the column. `enabled` may be partial while
 * the user has not decided yet; `grants` only carries OS-reported statuses.
 */
export interface PermissionState {
  platform: PermissionPlatform
  enabled: Partial<Record<PermissionId, boolean>>
  grants: Partial<Record<PermissionId, GrantStatus>>
}

export interface ToggleDecision {
  blocked: boolean
  /** i18n key explaining why the row cannot be toggled. */
  reasonKey?: string
  /** i18n key for the resolving action (e.g. grant the dependency). */
  actionKey?: string
}

/** Matches `PermissionPlatform` to the entry's declared platform. */
export function isEntryAvailable(entry: PermissionEntry, platform: PermissionPlatform): boolean {
  if (entry.platform === 'all') return true
  if (entry.platform === 'mac') return platform === 'mac'
  if (entry.platform === 'win') return platform === 'win'
  return false
}

/** Entries rendered for a platform, in catalogue order. */
export function entriesForPlatform(platform: PermissionPlatform): PermissionEntry[] {
  return PERMISSION_ENTRIES.filter((entry) => isEntryAvailable(entry, platform))
}

/** Default decision for one entry (`defaultOn` unless explicitly set). */
export function isEnabled(entry: PermissionEntry, state: PermissionState): boolean {
  const value = state.enabled[entry.id]
  return value ?? entry.defaultOn
}

/**
 * Status shown for a row. OS permission entries report the host grant; app
 * toggles are "есть" when on and "не выдано" when off.
 */
export function permissionStatus(entry: PermissionEntry, state: PermissionState): GrantStatus {
  if (entry.grantKind === 'app-toggle') {
    return isEnabled(entry, state) ? 'granted' : 'not-determined'
  }
  return state.grants[entry.id] ?? 'not-determined'
}

/**
 * Whether the row can be toggled. The only runtime gate today is the full-disk
 * dependency: `installedApps` stays blocked (greyed, disabled) until the OS
 * reports full disk access as granted.
 */
export function canToggle(entry: PermissionEntry, state: PermissionState): ToggleDecision {
  if (!isEntryAvailable(entry, state.platform)) {
    return { blocked: true, reasonKey: 'onboarding.permissions.blocked.unavailable' }
  }
  if (entry.dependsOn) {
    const dependency = state.grants[entry.dependsOn] ?? 'not-determined'
    if (dependency !== 'granted') {
      return {
        blocked: true,
        reasonKey: 'onboarding.permissions.blocked.fullDiskAccess',
        actionKey: 'onboarding.permissions.blocked.fullDiskAccessAction',
      }
    }
  }
  return { blocked: false }
}

/** Initial state: every visible entry preselected per its `defaultOn`. */
export function initialPermissionsState(
  platform: PermissionPlatform,
  grants: Partial<Record<PermissionId, GrantStatus>> = {},
): PermissionState {
  const enabled: Partial<Record<PermissionId, boolean>> = {}
  for (const entry of entriesForPlatform(platform)) {
    enabled[entry.id] = entry.defaultOn
  }
  return { platform, enabled, grants }
}

/**
 * Continue-state helper: the column is complete once every visible entry has
 * an explicit decision. Blocked rows still carry their preselected value, so
 * the default column is complete out of the box.
 */
export function isPermissionsColumnComplete(state: PermissionState): boolean {
  return entriesForPlatform(state.platform).every((entry) => state.enabled[entry.id] !== undefined)
}

/** Immutable toggle update. */
export function setPermissionEnabled(
  state: PermissionState,
  id: PermissionId,
  enabled: boolean,
): PermissionState {
  return { ...state, enabled: { ...state.enabled, [id]: enabled } }
}

/** Immutable grant-status update (host reports a permission change). */
export function setGrantStatus(
  state: PermissionState,
  id: PermissionId,
  status: GrantStatus,
): PermissionState {
  return { ...state, grants: { ...state.grants, [id]: status } }
}