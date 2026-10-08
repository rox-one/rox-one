import type { ZenShellSnapshot } from '../../shared/shell-appearance'

export type LowPowerStatusKey =
  | 'settings.appearance.lowPowerModeAutoOff'
  | 'settings.appearance.lowPowerModeAutoOnNoGpu'
  | 'settings.appearance.lowPowerModeAutoOnWeakHardware'
  | 'settings.appearance.lowPowerModeAutoOnWindows'

/**
 * PERF-07: with "Automatic" selected, tell the user whether low-power is on
 * right now and why. Returns null for an explicit On/Off choice, while the
 * snapshot has not arrived, or for an older main without the profile fields.
 */
export function lowPowerStatusKey(
  snapshot: Pick<ZenShellSnapshot, 'renderProfile' | 'renderProfilePreference' | 'renderProfileReason'> | null | undefined,
): LowPowerStatusKey | null {
  if (!snapshot?.renderProfile || (snapshot.renderProfilePreference ?? 'auto') !== 'auto') return null
  if (snapshot.renderProfile === 'standard') return 'settings.appearance.lowPowerModeAutoOff'
  switch (snapshot.renderProfileReason) {
    case 'windows': return 'settings.appearance.lowPowerModeAutoOnWindows'
    case 'software-compositing': return 'settings.appearance.lowPowerModeAutoOnNoGpu'
    case 'weak-hardware': return 'settings.appearance.lowPowerModeAutoOnWeakHardware'
    default: return null
  }
}
