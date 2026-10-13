/**
 * Default workspace layout preferences for the «Студия» layout engine (G4).
 *
 * Renderer-only, localStorage-backed scalars: the preset applied to a newly
 * created workspace and whether the arrangement is remembered per workspace.
 * The geometry engine owns the per-workspace record itself; this module only
 * carries the two cross-workspace preferences written by the Settings →
 * Appearance layout row and the onboarding «starting layout» step.
 *
 * Keys carry the app's `craft-` prefix and hold JSON strings.
 */
import {
  PANEL_LAYOUT_PRESETS,
  type PanelLayoutPreset,
} from '@/lib/panel-workspace-layout'

/** Full localStorage key for the default new-workspace preset. */
export const LAYOUT_DEFAULT_PRESET_KEY = 'craft-layout-default-preset'
/** Full localStorage key for the remember-per-workspace toggle. */
export const LAYOUT_REMEMBER_KEY = 'craft-layout-remember'

function readJson(key: string): unknown {
  if (typeof localStorage === 'undefined') return undefined
  try {
    const raw = localStorage.getItem(key)
    return raw === null ? undefined : JSON.parse(raw)
  } catch {
    return undefined
  }
}

function writeJson(key: string, value: unknown): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch (error) {
    console.warn(`[layout-defaults] Failed to persist ${key}:`, error)
  }
}

function removeKey(key: string): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.removeItem(key)
  } catch (error) {
    console.warn(`[layout-defaults] Failed to clear ${key}:`, error)
  }
}

/**
 * Preset applied to a toolbar/new workspace, or `null` when the user has no
 * preference (the engine then keeps `auto`). Unknown stored values are ignored.
 */
export function getDefaultLayoutPreset(): PanelLayoutPreset | null {
  const value = readJson(LAYOUT_DEFAULT_PRESET_KEY)
  return PANEL_LAYOUT_PRESETS.includes(value as PanelLayoutPreset)
    ? value as PanelLayoutPreset
    : null
}

/** Persist the default preset; `null` clears the preference (back to `auto`). */
export function setDefaultLayoutPreset(preset: PanelLayoutPreset | null): void {
  if (preset === null || !PANEL_LAYOUT_PRESETS.includes(preset)) {
    removeKey(LAYOUT_DEFAULT_PRESET_KEY)
    return
  }
  writeJson(LAYOUT_DEFAULT_PRESET_KEY, preset)
}

/** Whether each workspace remembers its own arrangement. Defaults to `true`. */
export function isLayoutRememberedPerWorkspace(): boolean {
  const value = readJson(LAYOUT_REMEMBER_KEY)
  return typeof value === 'boolean' ? value : true
}

/** Persist the remember-per-workspace preference. */
export function setLayoutRememberedPerWorkspace(value: boolean): void {
  writeJson(LAYOUT_REMEMBER_KEY, value)
}