/**
 * Zen Shell material policy (ZS-01).
 *
 * Pure resolver: no Electron imports. Main applies the snapshot; the renderer
 * only consumes the typed result. `shell.zen.v1` defaults ON and OFF does not
 * run this resolver — the existing window/material path stays in charge.
 */

import {
  isRenderProfilePreference,
  type RenderProfile,
  type RenderProfilePreference,
  type RenderProfileReason,
} from './render-profile'

export const ZEN_SHELL_FLAG = 'shell.zen.v1' as const

/** Electron's backgroundMaterial API requires Windows 11 22H2 or newer. */
export const WINDOWS_MICA_BUILD = 22621

export type ShellMaterialPreference = 'system' | 'glass' | 'opaque'
export type ResolvedShellMaterial = 'vibrancy' | 'mica' | 'solid'
export type ShellPlatform = 'darwin' | 'win32' | 'linux' | 'web'

/**
 * A3 — macOS vibrancy depth. `light` → `sidebar`, `standard` (default) →
 * `under-window`, `deep` → `hud`. Windows (mica) ignores it.
 */
export type ShellMaterialDepth = 'light' | 'standard' | 'deep'
export const DEFAULT_SHELL_MATERIAL_DEPTH: ShellMaterialDepth = 'standard'

const MATERIAL_DEPTHS = new Set<ShellMaterialDepth>(['light', 'standard', 'deep'])

/** Map a chosen depth onto Electron's `setVibrancy` argument. */
export function vibrancyForDepth(depth: ShellMaterialDepth): 'sidebar' | 'under-window' | 'hud' {
  switch (depth) {
    case 'light':
      return 'sidebar'
    case 'deep':
      return 'hud'
    default:
      return 'under-window'
  }
}

export function parseShellMaterialDepth(value: unknown): ShellMaterialDepth {
  if (typeof value === 'string' && MATERIAL_DEPTHS.has(value as ShellMaterialDepth)) {
    return value as ShellMaterialDepth
  }
  return DEFAULT_SHELL_MATERIAL_DEPTH
}

export type ShellMaterialFallbackReason =
  | 'user-opaque'
  | 'reduce-transparency'
  | 'high-contrast'
  | 'unknown-capability'
  | 'unsupported-platform'
  | 'no-healthy-paint'
  | 'window-destroyed'
  | 'gpu-failure'
  | 'material-unavailable'
  | 'low-power'
  | 'zen-disabled'

export interface ResolveShellMaterialInput {
  zenEnabled: boolean
  preference: ShellMaterialPreference
  platform: ShellPlatform
  windowsBuild?: number
  reduceTransparency: boolean
  highContrast: boolean
  paintHealthy: boolean
  windowDestroyed: boolean
  gpuFailed?: boolean
  /** PERF-07: the low-power profile clears native vibrancy/Mica. */
  renderProfile?: RenderProfile
  /** A3 — macOS vibrancy depth; absent means `standard`. */
  materialDepth?: ShellMaterialDepth
}

export interface ResolvedShellAppearance {
  material: ResolvedShellMaterial
  fallbackReason?: ShellMaterialFallbackReason
}

export interface ZenShellSnapshot {
  flag: typeof ZEN_SHELL_FLAG
  enabled: boolean
  preference: ShellMaterialPreference
  material: ResolvedShellMaterial
  /** A3 — effective macOS vibrancy depth (Windows ignores it). */
  materialDepth: ShellMaterialDepth
  platform: ShellPlatform
  fallbackReason?: ShellMaterialFallbackReason
  /** PERF-07: effective rendering profile; absent means `standard`. */
  renderProfile?: RenderProfile
  renderProfilePreference?: RenderProfilePreference
  renderProfileReason?: RenderProfileReason
}

export interface ZenShellRenderProfileState {
  profile: RenderProfile
  preference: RenderProfilePreference
  reason: RenderProfileReason
}

export interface ZenShellPatch {
  enabled?: boolean
  materialPreference?: ShellMaterialPreference
  renderProfile?: RenderProfilePreference
  /** A3 — macOS vibrancy depth. */
  materialDepth?: ShellMaterialDepth
}

const MATERIAL_PREFERENCES = new Set<ShellMaterialPreference>(['system', 'glass', 'opaque'])

export function parseZenShellEnabled(value: unknown): boolean {
  return value === undefined || value === true
}

export function parseShellMaterialPreference(value: unknown): ShellMaterialPreference {
  if (typeof value === 'string' && MATERIAL_PREFERENCES.has(value as ShellMaterialPreference)) {
    return value as ShellMaterialPreference
  }
  return 'system'
}

/**
 * SET_ZEN_SHELL accepts only `{ enabled?, materialPreference?, renderProfile? }`.
 * BrowserWindow constructor keys and any extra field are rejected.
 */
export function parseZenShellPatch(raw: unknown): ZenShellPatch {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Invalid zen shell patch')
  }
  const obj = raw as Record<string, unknown>
  const allowed = new Set(['enabled', 'materialPreference', 'renderProfile', 'materialDepth'])
  for (const key of Object.keys(obj)) {
    if (!allowed.has(key)) {
      throw new Error(`Unexpected zen shell field: ${key}`)
    }
  }
  const patch: ZenShellPatch = {}
  if ('enabled' in obj) {
    if (typeof obj.enabled !== 'boolean') {
      throw new Error('zen shell enabled must be boolean')
    }
    patch.enabled = obj.enabled
  }
  if ('materialPreference' in obj) {
    if (typeof obj.materialPreference !== 'string' || !MATERIAL_PREFERENCES.has(obj.materialPreference as ShellMaterialPreference)) {
      throw new Error('zen shell materialPreference must be system, glass, or opaque')
    }
    patch.materialPreference = obj.materialPreference as ShellMaterialPreference
  }
  if ('renderProfile' in obj) {
    if (!isRenderProfilePreference(obj.renderProfile)) {
      throw new Error('zen shell renderProfile must be auto, performance, or standard')
    }
    patch.renderProfile = obj.renderProfile
  }
  if ('materialDepth' in obj) {
    if (typeof obj.materialDepth !== 'string' || !MATERIAL_DEPTHS.has(obj.materialDepth as ShellMaterialDepth)) {
      throw new Error('zen shell materialDepth must be light, standard, or deep')
    }
    patch.materialDepth = obj.materialDepth as ShellMaterialDepth
  }
  return patch
}

export function resolveShellMaterial(input: ResolveShellMaterialInput): ResolvedShellAppearance {
  if (!input.zenEnabled) {
    return { material: 'solid', fallbackReason: 'zen-disabled' }
  }
  if (input.windowDestroyed) {
    return { material: 'solid', fallbackReason: 'window-destroyed' }
  }
  if (input.gpuFailed) {
    return { material: 'solid', fallbackReason: 'gpu-failure' }
  }
  if (!input.paintHealthy) {
    return { material: 'solid', fallbackReason: 'no-healthy-paint' }
  }
  if (input.highContrast) {
    return { material: 'solid', fallbackReason: 'high-contrast' }
  }
  if (input.reduceTransparency) {
    return { material: 'solid', fallbackReason: 'reduce-transparency' }
  }
  if (input.preference === 'opaque') {
    return { material: 'solid', fallbackReason: 'user-opaque' }
  }
  if (input.renderProfile === 'performance') {
    return { material: 'solid', fallbackReason: 'low-power' }
  }

  const wantsGlass = input.preference === 'glass' || input.preference === 'system'
  if (!wantsGlass) {
    return { material: 'solid' }
  }

  if (input.platform === 'darwin') {
    return { material: 'vibrancy' }
  }
  if (input.platform === 'win32') {
    const build = input.windowsBuild ?? 0
    if (build >= WINDOWS_MICA_BUILD) {
      return { material: 'mica' }
    }
    return { material: 'solid', fallbackReason: 'unknown-capability' }
  }
  return { material: 'solid', fallbackReason: 'unsupported-platform' }
}

export function snapshotZenShell(
  input: ResolveShellMaterialInput,
  renderProfile?: ZenShellRenderProfileState,
): ZenShellSnapshot {
  // The low-power profile feeds material resolution (no native glass).
  const resolved = resolveShellMaterial({ ...input, renderProfile: input.renderProfile ?? renderProfile?.profile })
  const snapshot: ZenShellSnapshot = {
    flag: ZEN_SHELL_FLAG,
    enabled: input.zenEnabled,
    preference: input.preference,
    material: resolved.material,
    materialDepth: parseShellMaterialDepth(input.materialDepth),
    platform: input.platform,
    fallbackReason: resolved.fallbackReason,
  }
  if (renderProfile) {
    snapshot.renderProfile = renderProfile.profile
    snapshot.renderProfilePreference = renderProfile.preference
    snapshot.renderProfileReason = renderProfile.reason
  }
  return snapshot
}
