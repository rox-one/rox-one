/**
 * Zen Shell material policy (ZS-01).
 *
 * Pure resolver: no Electron imports. Main applies the snapshot; the renderer
 * only consumes the typed result. `shell.zen.v1` defaults OFF and OFF does not
 * run this resolver — the existing window/material path stays in charge.
 */

export const ZEN_SHELL_FLAG = 'shell.zen.v1' as const

/** Windows 11 22H2+ (build 22000). Older Zen-ON Windows is solid, not acrylic. */
export const WINDOWS_MICA_BUILD = 22000

export type ShellMaterialPreference = 'system' | 'glass' | 'opaque'
export type ResolvedShellMaterial = 'vibrancy' | 'mica' | 'solid'
export type ShellPlatform = 'darwin' | 'win32' | 'linux' | 'web'

export type ShellMaterialFallbackReason =
  | 'user-opaque'
  | 'reduce-transparency'
  | 'high-contrast'
  | 'unknown-capability'
  | 'unsupported-platform'
  | 'no-healthy-paint'
  | 'window-destroyed'
  | 'gpu-failure'
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
  platform: ShellPlatform
  fallbackReason?: ShellMaterialFallbackReason
}

const MATERIAL_PREFERENCES = new Set<ShellMaterialPreference>(['system', 'glass', 'opaque'])

export function parseZenShellEnabled(value: unknown): boolean {
  return value === true
}

export function parseShellMaterialPreference(value: unknown): ShellMaterialPreference {
  if (typeof value === 'string' && MATERIAL_PREFERENCES.has(value as ShellMaterialPreference)) {
    return value as ShellMaterialPreference
  }
  return 'system'
}

/**
 * SET_ZEN_SHELL accepts only `{ enabled?, materialPreference? }`.
 * BrowserWindow constructor keys and any extra field are rejected.
 */
export function parseZenShellPatch(raw: unknown): {
  enabled?: boolean
  materialPreference?: ShellMaterialPreference
} {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Invalid zen shell patch')
  }
  const obj = raw as Record<string, unknown>
  const allowed = new Set(['enabled', 'materialPreference'])
  for (const key of Object.keys(obj)) {
    if (!allowed.has(key)) {
      throw new Error(`Unexpected zen shell field: ${key}`)
    }
  }
  const patch: { enabled?: boolean; materialPreference?: ShellMaterialPreference } = {}
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

export function snapshotZenShell(input: ResolveShellMaterialInput): ZenShellSnapshot {
  const resolved = resolveShellMaterial(input)
  return {
    flag: ZEN_SHELL_FLAG,
    enabled: input.zenEnabled,
    preference: input.preference,
    material: resolved.material,
    platform: input.platform,
    fallbackReason: resolved.fallbackReason,
  }
}
