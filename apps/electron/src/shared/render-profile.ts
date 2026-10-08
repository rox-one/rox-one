/**
 * Low-power rendering profile (PERF-07, rox-one#1566).
 *
 * Pure resolver with no Electron imports. Main reads the GPU status and the
 * persisted preference, then ships the result inside the shell snapshot;
 * the renderer only mirrors it on `<html data-render-profile>`.
 *
 * `performance` means no CSS backdrop blur, solid surface tints and reduced
 * motion. It is the default on Windows and wherever Chromium reports
 * software or blocklisted GPU compositing (owner decision D11).
 */

import type { ShellPlatform } from './shell-appearance'

export type RenderProfile = 'standard' | 'performance'
/** Persisted user choice. `auto` follows the platform/GPU default. */
export type RenderProfilePreference = 'auto' | 'performance' | 'standard'
export type RenderProfileReason =
  | 'user-performance'
  | 'user-standard'
  | 'windows'
  | 'software-compositing'
  | 'default'

const PREFERENCES = new Set<RenderProfilePreference>(['auto', 'performance', 'standard'])

export function isRenderProfilePreference(value: unknown): value is RenderProfilePreference {
  return typeof value === 'string' && PREFERENCES.has(value as RenderProfilePreference)
}

export function parseRenderProfilePreference(value: unknown): RenderProfilePreference {
  return isRenderProfilePreference(value) ? value : 'auto'
}

/**
 * `app.getGPUFeatureStatus().gpu_compositing` is `enabled`, `enabled_on`,
 * `enabled_force`, … when the GPU composites. Anything else (for example
 * `disabled_software`, `unavailable_software`, `disabled_off`) means Chromium
 * fell back to software or blocklisted the GPU. A missing status is unknown,
 * not weak.
 */
export function isSoftwareCompositing(status: unknown): boolean {
  if (status === null || typeof status !== 'object') return false
  const value = (status as Record<string, unknown>).gpu_compositing
  if (typeof value !== 'string' || value.length === 0) return false
  return !value.startsWith('enabled')
}

export interface ResolveRenderProfileInput {
  preference: RenderProfilePreference
  platform: ShellPlatform
  softwareCompositing: boolean
}

export interface ResolvedRenderProfile {
  profile: RenderProfile
  reason: RenderProfileReason
}

export function resolveRenderProfile(input: ResolveRenderProfileInput): ResolvedRenderProfile {
  if (input.preference === 'performance') return { profile: 'performance', reason: 'user-performance' }
  if (input.preference === 'standard') return { profile: 'standard', reason: 'user-standard' }
  if (input.softwareCompositing) return { profile: 'performance', reason: 'software-compositing' }
  if (input.platform === 'win32') return { profile: 'performance', reason: 'windows' }
  return { profile: 'standard', reason: 'default' }
}
