/**
 * Low-power rendering profile, main side (PERF-07, rox-one#1566).
 *
 * Reads Chromium's GPU feature status and the persisted preference, then
 * resolves the profile with the pure resolver in `shared/render-profile`.
 * The result reaches the renderer inside the Zen Shell snapshot
 * (`shell-material.ts`), so no new IPC channel or window option is needed.
 */

import { app } from 'electron'
import { getRenderProfilePreference } from '@rox/shared/config'
import {
  isSoftwareCompositing,
  parseRenderProfilePreference,
  resolveRenderProfile,
} from '../shared/render-profile'
import type { ShellPlatform, ZenShellRenderProfileState } from '../shared/shell-appearance'

/** True when Chromium composites in software or has blocklisted the GPU. */
export function queryGpuSoftwareCompositing(): boolean {
  const getStatus = (app as { getGPUFeatureStatus?: () => unknown }).getGPUFeatureStatus
  if (typeof getStatus !== 'function') return false
  // The status is only meaningful once the app is ready.
  if (typeof app.isReady === 'function' && !app.isReady()) return false
  try {
    return isSoftwareCompositing(getStatus.call(app))
  } catch {
    return false
  }
}

function readPreference() {
  try {
    return parseRenderProfilePreference(getRenderProfilePreference())
  } catch {
    return 'auto' as const
  }
}

export function peekRenderProfile(platform: ShellPlatform): ZenShellRenderProfileState {
  const preference = readPreference()
  // Explicit choices win; skip the GPU probe for them.
  const softwareCompositing = preference === 'auto' ? queryGpuSoftwareCompositing() : false
  const resolved = resolveRenderProfile({ preference, platform, softwareCompositing })
  return { profile: resolved.profile, preference, reason: resolved.reason }
}
