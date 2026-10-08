/**
 * Low-power rendering profile (PERF-07, rox-one#1566).
 *
 * Pure resolver with no Electron imports. Main reads the GPU status and the
 * persisted preference, then ships the result inside the shell snapshot;
 * the renderer only mirrors it on `<html data-render-profile>`.
 *
 * `performance` means no CSS backdrop blur, solid surface tints, reduced
 * motion and no native vibrancy/Mica (the window material resolves to solid).
 * It is the default on Windows, wherever Chromium reports software or
 * blocklisted GPU compositing, and on weak hardware (< 7.5 GiB RAM or <= 4
 * logical cores) (owner decision D11).
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
  | 'weak-hardware'
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

/**
 * Below this much memory the machine counts as weak. `os.totalmem()` reports
 * usable rather than installed RAM on Windows/Linux (a nominal 8 GB machine
 * reads ~7.6–7.9 GiB), so the cut-off leaves a tolerance below 8 GiB.
 */
export const WEAK_TOTAL_MEMORY_BYTES = 7.5 * 1024 ** 3
/** At or below this many logical cores the machine counts as weak. */
export const WEAK_LOGICAL_CPU_COUNT = 4

export interface HardwareInfo {
  /** `os.totalmem()` in bytes; undefined/0/NaN means unknown. */
  totalMemoryBytes?: number
  /** `os.cpus().length`; undefined/0/NaN means unknown. */
  logicalCpuCount?: number
}

function known(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

/** Unknown values never make a machine weak. */
export function isWeakHardware(info: HardwareInfo | undefined): boolean {
  if (!info) return false
  if (known(info.totalMemoryBytes) && info.totalMemoryBytes < WEAK_TOTAL_MEMORY_BYTES) return true
  if (known(info.logicalCpuCount) && info.logicalCpuCount <= WEAK_LOGICAL_CPU_COUNT) return true
  return false
}

export interface ResolveRenderProfileInput {
  preference: RenderProfilePreference
  platform: ShellPlatform
  softwareCompositing: boolean
  hardware?: HardwareInfo
}

export interface ResolvedRenderProfile {
  profile: RenderProfile
  reason: RenderProfileReason
}

export function resolveRenderProfile(input: ResolveRenderProfileInput): ResolvedRenderProfile {
  if (input.preference === 'performance') return { profile: 'performance', reason: 'user-performance' }
  if (input.preference === 'standard') return { profile: 'standard', reason: 'user-standard' }
  if (input.softwareCompositing) return { profile: 'performance', reason: 'software-compositing' }
  if (isWeakHardware(input.hardware)) return { profile: 'performance', reason: 'weak-hardware' }
  if (input.platform === 'win32') return { profile: 'performance', reason: 'windows' }
  return { profile: 'standard', reason: 'default' }
}
