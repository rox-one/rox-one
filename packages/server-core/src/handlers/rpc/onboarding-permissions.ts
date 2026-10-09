/**
 * Onboarding permissions & data-access RPC surface.
 *
 * The actual OS probes are host-composed: Electron main injects
 * `deps.onboardingPermissions` (see apps/electron/src/main/onboarding-permissions.ts),
 * because server-core must not import `electron` (see runtime/platform.ts).
 * Without a host — headless, thin client, older host — the handlers answer an
 * honest `unsupported` state for every OS-mediated permission instead of
 * faking a grant.
 */
import { RPC_CHANNELS } from '@rox/shared/protocol'
import type { RpcServer } from '@rox/server-core/transport'
import type { HandlerDeps } from '../handler-deps'

/** Honest OS-reported state of one permission. */
export type OnboardingPermissionStatus = 'granted' | 'denied' | 'unknown' | 'unsupported'

/**
 * Permissions that the OS mediates and that the main process can observe.
 * Pure app toggles (keep-awake, history import, LaunchAgent, browser automation)
 * have no OS status and are therefore not part of the snapshot.
 */
export type OnboardingOsPermissionKey =
  | 'fullDiskAccess'
  | 'automation'
  | 'accessibility'
  | 'screenRecording'
  | 'audioRecording'
  | 'inputMonitoring'

export const ONBOARDING_OS_PERMISSION_KEYS: readonly OnboardingOsPermissionKey[] = [
  'fullDiskAccess',
  'automation',
  'accessibility',
  'screenRecording',
  'audioRecording',
  'inputMonitoring',
]

export interface OnboardingPermissionsSnapshot {
  /** `process.platform` of the host that answered. */
  platform: string
  /** Only keys the host could classify are present; missing keys are unknowable. */
  statuses: Partial<Record<OnboardingOsPermissionKey, OnboardingPermissionStatus>>
}

export interface OpenPermissionSettingsResult {
  /** True when the host actually launched a system settings deep link. */
  opened: boolean
  /** Deep link that was opened, when any. */
  url?: string
  /** Stable machine-readable reason/hint code when no deep link exists. */
  hint?: 'unsupported' | 'no-deep-link' | 'unknown-permission' | 'open-failed'
}

/**
 * Host-composed capability boundary. Electron implements it with
 * `systemPreferences`/`shell`; other hosts leave `deps.onboardingPermissions`
 * undefined.
 */
export interface OnboardingPermissionsHost {
  probePermissions(): Promise<OnboardingPermissionsSnapshot>
  openPermissionSettings(key: string): Promise<OpenPermissionSettingsResult>
}

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.onboarding.PERMISSIONS_STATUS,
  RPC_CHANNELS.onboarding.OPEN_PERMISSION_SETTINGS,
] as const

/** Honest fallback when no host is composed (headless / thin client). */
export function unsupportedPermissionStatuses(): Partial<Record<OnboardingOsPermissionKey, OnboardingPermissionStatus>> {
  const statuses: Partial<Record<OnboardingOsPermissionKey, OnboardingPermissionStatus>> = {}
  for (const key of ONBOARDING_OS_PERMISSION_KEYS) statuses[key] = 'unsupported'
  return statuses
}

export function registerOnboardingPermissionsHandlers(server: RpcServer, deps: HandlerDeps): void {
  const log = deps.platform.logger

  server.handle(RPC_CHANNELS.onboarding.PERMISSIONS_STATUS, async (): Promise<OnboardingPermissionsSnapshot> => {
    const host = deps.onboardingPermissions
    if (!host) {
      return { platform: process.platform, statuses: unsupportedPermissionStatuses() }
    }
    try {
      return await host.probePermissions()
    } catch (error) {
      log.warn('[OnboardingPermissions] probe failed:', error instanceof Error ? error.message : error)
      return { platform: process.platform, statuses: unsupportedPermissionStatuses() }
    }
  })

  server.handle(
    RPC_CHANNELS.onboarding.OPEN_PERMISSION_SETTINGS,
    async (_ctx, key: unknown): Promise<OpenPermissionSettingsResult> => {
      if (typeof key !== 'string' || key.length === 0) {
        return { opened: false, hint: 'unknown-permission' }
      }
      const host = deps.onboardingPermissions
      if (!host) return { opened: false, hint: 'unsupported' }
      try {
        return await host.openPermissionSettings(key)
      } catch (error) {
        log.warn('[OnboardingPermissions] openPermissionSettings failed:', error instanceof Error ? error.message : error)
        return { opened: false, hint: 'open-failed' }
      }
    },
  )
}