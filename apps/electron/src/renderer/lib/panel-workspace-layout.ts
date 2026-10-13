/**
 * Workspace panel geometry. Routes, identities and focus still belong to the
 * panel stack / NavigationContext; this preference stores only arrangement and
 * track sizes. A resize preview never writes to storage.
 */
import * as storage from './local-storage'
import * as layoutDefaults from '@/lib/layout-defaults'

export const PANEL_WORKSPACE_LAYOUT_MODES = ['auto', 'columns', 'grid-2', 'grid-3', 'focus'] as const
export type PanelWorkspaceLayoutMode = typeof PANEL_WORKSPACE_LAYOUT_MODES[number]
/**
 * Named arrangements of the «Студия» geometry engine (featureLayoutEngine,
 * default OFF). `auto` leaves placement to the legacy `mode`; a stored `auto`
 * is inert so the flag can be reverted without touching saved records.
 */
export const PANEL_LAYOUT_PRESETS = ['auto', 'focus', 'dialog', 'triptych', 'wall'] as const
export type PanelLayoutPreset = typeof PANEL_LAYOUT_PRESETS[number]
export type PanelResizeAxis = 'x' | 'y'
export type PanelFocusDirection = 'left' | 'right' | 'up' | 'down'

export interface PanelGridShape {
  columns: number
  rows: number
}

export interface PanelGridTracks {
  columns: number[]
  rows: number[]
}

/**
 * A named saved arrangement (G4 «Студия» profiles): the preset plus the track
 * sizes captured at save time, so applying it restores exactly that geometry.
 */
export interface PanelLayoutProfile {
  id: string
  name: string
  preset: PanelLayoutPreset
  grids: Record<string, PanelGridTracks>
}

export interface PanelWorkspaceLayoutPreferences {
  schemaVersion: 2
  workspaceId: string
  mode: PanelWorkspaceLayoutMode
  /**
   * Named arrangement for the geometry engine. `auto` keeps the legacy `mode`
   * behaviour, so a v1 record migrates with no geometry change and the flag
   * being OFF ignores this field entirely.
   */
  preset: PanelLayoutPreset
  /** Track sizes are retained independently for each arrangement. */
  grids: Record<string, PanelGridTracks>
  /**
   * Saved named arrangements. Additive and optional: v1/v2 records without it
   * read as `[]` and the flag being OFF ignores it entirely.
   */
  profiles?: PanelLayoutProfile[]
}

export interface PanelWorkspaceLayoutStore {
  get<T>(key: storage.StorageKey, fallback: T, suffix?: string): T
  set<T>(key: storage.StorageKey, value: T, suffix?: string): void
}

export function panelGridShape(count: number, mode: PanelWorkspaceLayoutMode): PanelGridShape {
  const size = Math.max(1, Math.floor(Number.isFinite(count) ? count : 1))
  const columns = mode === 'focus' ? 1
    : mode === 'columns' ? size
    : mode === 'grid-2' ? Math.min(2, size)
    : mode === 'grid-3' ? Math.min(3, size)
    : size <= 3 ? size : size === 4 ? 2 : 3
  return { columns, rows: mode === 'focus' ? 1 : Math.ceil(size / columns) }
}

export function panelGridKey(shape: PanelGridShape): string {
  return `${shape.columns}x${shape.rows}`
}

/**
 * Follow visible grid topology, never wrap across a row or select an empty
 * cell. A ragged final row uses the nearest surviving column for vertical
 * movement. Layout changes do not create or replace panel identities.
 */
export function panelGridFocusTarget(
  panelIds: readonly string[],
  focusedId: string | null | undefined,
  shape: PanelGridShape,
  direction: PanelFocusDirection,
): string | null {
  const index = panelIds.indexOf(focusedId ?? '')
  if (index < 0 || !Number.isSafeInteger(shape.columns) || shape.columns < 1 || shape.rows < 1) return null
  const row = Math.floor(index / shape.columns)
  if (row >= shape.rows) return null
  const column = index % shape.columns
  if (direction === 'left' || direction === 'right') {
    const nextColumn = column + (direction === 'left' ? -1 : 1)
    if (nextColumn < 0 || nextColumn >= shape.columns) return null
    return panelIds[row * shape.columns + nextColumn] ?? null
  }
  const nextRow = row + (direction === 'up' ? -1 : 1)
  if (nextRow < 0 || nextRow >= shape.rows || nextRow * shape.columns >= panelIds.length) return null
  return panelIds[Math.min(nextRow * shape.columns + column, panelIds.length - 1)] ?? null
}

/** Dedicated services have no list navigator and must remain visible on small windows. */
export function compactPanelShowsContent(panelCount: number, hasNavigator: boolean, isDetailFocused: boolean): boolean {
  return panelCount > 0 && (isDetailFocused || !hasNavigator)
}

/**
 * Full-screen panel mode (D8). One panel can be promoted from the shared grid
 * to the whole workspace and restored to the previous arrangement. This is a
 * per-session view state, not a stored preference: panel identities are minted
 * per launch (`panel-<n>-<timestamp>`), so a persisted id would be dangling.
 *
 * Toggling the already-expanded panel restores the grid; toggling a sibling
 * switches which panel fills the screen; an unknown target is a no-op so a
 * stale menu click cannot blank the workspace.
 */
export function togglePanelFullScreen(
  expandedPanelId: string | null,
  targetPanelId: string | null | undefined,
  panelIds: readonly string[],
): string | null {
  if (!targetPanelId || !panelIds.includes(targetPanelId)) return expandedPanelId
  return expandedPanelId === targetPanelId ? null : targetPanelId
}

/** Drop an expanded id whose panel is no longer in the stack. */
export function reconcilePanelFullScreen(
  expandedPanelId: string | null,
  panelIds: readonly string[],
): string | null {
  return expandedPanelId && panelIds.includes(expandedPanelId) ? expandedPanelId : null
}

export function normalizePanelTracks(value: unknown, count: number): number[] {
  if (!Array.isArray(value) || value.length !== count || value.some((n) => typeof n !== 'number' || !Number.isFinite(n) || n <= 0)) {
    return Array.from({ length: count }, () => 1 / count)
  }
  const total = value.reduce((sum: number, n: number) => sum + n, 0)
  if (!Number.isFinite(total) || total <= 0) return Array.from({ length: count }, () => 1 / count)
  return value.map((n: number) => n / total)
}

/**
 * Default arrangement for a NEW workspace record. Owned by `layout-defaults`
 * (craft-layout-default-preset / craft-layout-remember); read defensively so a
 * missing or throwing module never blocks the factory. `auto` is the inert
 * fallback and keeps the legacy `mode` behaviour.
 */
export function defaultPanelLayoutPreset(): PanelLayoutPreset {
  try {
    const preset = layoutDefaults.getDefaultLayoutPreset()
    if (preset && PANEL_LAYOUT_PRESETS.includes(preset)) return preset
  } catch {
    // layout-defaults unavailable — keep the inert default.
  }
  return 'auto'
}

export function defaultPanelWorkspaceLayout(workspaceId: string): PanelWorkspaceLayoutPreferences {
  return { schemaVersion: 2, workspaceId, mode: 'auto', preset: defaultPanelLayoutPreset(), grids: {}, profiles: [] }
}

/** Clone the stored tracks so a profile never aliases the live grids object. */
function clonePanelGrids(grids: Record<string, PanelGridTracks>): Record<string, PanelGridTracks> {
  const clone: Record<string, PanelGridTracks> = {}
  for (const [key, tracks] of Object.entries(grids)) clone[key] = { columns: [...tracks.columns], rows: [...tracks.rows] }
  return clone
}

function newPanelLayoutProfileId(): string {
  const cryptoApi = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') return cryptoApi.randomUUID()
  return `profile-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/** Validate one stored profile; a malformed entry is dropped, never repaired. */
function parsePanelLayoutProfile(raw: unknown): PanelLayoutProfile | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  const value = raw as Record<string, unknown>
  if (typeof value.id !== 'string' || value.id.length === 0) return null
  if (typeof value.name !== 'string' || value.name.trim().length === 0) return null
  if (!PANEL_LAYOUT_PRESETS.includes(value.preset as PanelLayoutPreset)) return null
  return {
    id: value.id,
    name: value.name,
    preset: value.preset as PanelLayoutPreset,
    grids: parsePanelGrids(value.grids),
  }
}

/** Track records keyed by `CxR`; malformed keys or tracks are dropped. */
function parsePanelGrids(value: unknown): Record<string, PanelGridTracks> {
  const grids: Record<string, PanelGridTracks> = {}
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [key, tracks] of Object.entries(value)) {
      const match = /^([1-9]\d?)x([1-9]\d?)$/.exec(key)
      if (!match || tracks === null || typeof tracks !== 'object' || Array.isArray(tracks)) continue
      const grid = tracks as Record<string, unknown>
      grids[key] = {
        columns: normalizePanelTracks(grid.columns, Number(match[1])),
        rows: normalizePanelTracks(grid.rows, Number(match[2])),
      }
    }
  }
  return grids
}

/** Read the saved profiles, dropping malformed entries and duplicate ids. */
function parsePanelProfiles(value: unknown): PanelLayoutProfile[] {
  if (!Array.isArray(value)) return []
  const profiles: PanelLayoutProfile[] = []
  const seen = new Set<string>()
  for (const entry of value) {
    const profile = parsePanelLayoutProfile(entry)
    if (!profile || seen.has(profile.id)) continue
    seen.add(profile.id)
    profiles.push(profile)
  }
  return profiles
}

/** Capture the current arrangement as a new named profile (name collision replaces). */
export function savePanelLayoutProfile(
  preferences: PanelWorkspaceLayoutPreferences,
  name: string,
): PanelWorkspaceLayoutPreferences {
  const trimmed = name.trim()
  if (!trimmed) return preferences
  const profiles = preferences.profiles ?? []
  const existing = profiles.findIndex((profile) => profile.name === trimmed)
  const profile: PanelLayoutProfile = {
    id: existing >= 0 ? profiles[existing].id : newPanelLayoutProfileId(),
    name: trimmed,
    preset: preferences.preset,
    grids: clonePanelGrids(preferences.grids),
  }
  const next = existing >= 0
    ? profiles.map((entry, index) => (index === existing ? profile : entry))
    : [...profiles, profile]
  return { ...preferences, profiles: next }
}

/** Restore a saved arrangement: its preset and the captured track sizes. */
export function applyPanelLayoutProfile(
  preferences: PanelWorkspaceLayoutPreferences,
  id: string,
): PanelWorkspaceLayoutPreferences {
  const profile = (preferences.profiles ?? []).find((entry) => entry.id === id)
  if (!profile) return preferences
  return { ...preferences, preset: profile.preset, grids: clonePanelGrids(profile.grids) }
}

export function deletePanelLayoutProfile(
  preferences: PanelWorkspaceLayoutPreferences,
  id: string,
): PanelWorkspaceLayoutPreferences {
  const profiles = preferences.profiles ?? []
  if (!profiles.some((entry) => entry.id === id)) return preferences
  return { ...preferences, profiles: profiles.filter((entry) => entry.id !== id) }
}

/**
 * Accept v2 records and migrate v1 records additively: the legacy schema had no
 * `preset`, so it parses to `auto` and every geometry decision stays with
 * `mode`. A foreign workspace, an unknown schema and any malformed value still
 * fall back to the caller's default — a stored record can never throw.
 */
export function parsePanelWorkspaceLayout(raw: unknown, workspaceId: string): PanelWorkspaceLayoutPreferences | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  const value = raw as Record<string, unknown>
  if ((value.schemaVersion !== 1 && value.schemaVersion !== 2) || value.workspaceId !== workspaceId) return null
  const mode = PANEL_WORKSPACE_LAYOUT_MODES.includes(value.mode as PanelWorkspaceLayoutMode)
    ? value.mode as PanelWorkspaceLayoutMode : 'auto'
  const preset = PANEL_LAYOUT_PRESETS.includes(value.preset as PanelLayoutPreset)
    ? value.preset as PanelLayoutPreset : 'auto'
  const grids = parsePanelGrids(value.grids)
  return { schemaVersion: 2, workspaceId, mode, preset, grids, profiles: parsePanelProfiles(value.profiles) }
}

export function loadPanelWorkspaceLayout(
  workspaceId: string,
  store: PanelWorkspaceLayoutStore = storage,
): PanelWorkspaceLayoutPreferences {
  // Remember-per-workspace OFF: every workspace opens with the default layout.
  // The stored record is left untouched, so turning the toggle back on restores
  // it; this single load path is the only place the preference is honoured.
  // Read defensively: a throwing module keeps the shipped remember-on behaviour
  // instead of blocking every load.
  let remembered = true
  try {
    remembered = layoutDefaults.isLayoutRememberedPerWorkspace()
  } catch {
    // layout-defaults unavailable — keep remembering.
  }
  if (!remembered) return defaultPanelWorkspaceLayout(workspaceId)
  return parsePanelWorkspaceLayout(store.get(storage.KEYS.panelWorkspaceLayout, null, workspaceId), workspaceId)
    ?? defaultPanelWorkspaceLayout(workspaceId)
}

export function commitPanelWorkspaceLayout(
  preferences: PanelWorkspaceLayoutPreferences,
  store: PanelWorkspaceLayoutStore = storage,
): void {
  const parsed = parsePanelWorkspaceLayout(preferences, preferences.workspaceId)
  if (parsed) store.set(storage.KEYS.panelWorkspaceLayout, parsed, parsed.workspaceId)
}

/** Older URLs carry only one weight per panel. Honor those until a grid is resized. */
export function resolvePanelGridTracks(
  preferences: PanelWorkspaceLayoutPreferences,
  shape: PanelGridShape,
  panelProportions: readonly number[],
): PanelGridTracks {
  const saved = preferences.grids[panelGridKey(shape)]
  if (saved) return {
    columns: normalizePanelTracks(saved.columns, shape.columns),
    rows: normalizePanelTracks(saved.rows, shape.rows),
  }
  // Average per column, so the unfilled cell in a five-panel grid does not
  // make its column narrower than its neighbors.
  const weights = Array.from({ length: shape.columns }, (_, column) => {
    const members = panelProportions.filter((_, index) => index % shape.columns === column)
    return members.length ? members.reduce((sum, weight) => sum + weight, 0) / members.length : 0
  })
  return {
    columns: normalizePanelTracks(weights, shape.columns),
    rows: normalizePanelTracks(undefined, shape.rows),
  }
}

/** Resize one neighboring pair without changing the remaining tracks. */
export function resizePanelTracks(
  tracks: readonly number[],
  index: number,
  sizeA: number,
  sizeB: number,
): number[] {
  if (index < 0 || index + 1 >= tracks.length || !Number.isFinite(sizeA) || !Number.isFinite(sizeB) || sizeA <= 0 || sizeB <= 0) {
    return [...tracks]
  }
  const total = sizeA + sizeB
  const combined = tracks[index] + tracks[index + 1]
  return tracks.map((weight, position) => position === index ? combined * sizeA / total
    : position === index + 1 ? combined * sizeB / total : weight)
}

/**
 * CSS minmax can clamp a saved fraction to a pixel minimum. Begin a gesture
 * from all rendered track sizes, otherwise even a zero-delta preview changes
 * neighboring tracks and shifts an unrelated column or row.
 */
export function capturePanelResizeTracks(
  tracks: PanelGridTracks,
  axis: PanelResizeAxis,
  measuredSizes: readonly number[],
): PanelGridTracks {
  const key = axis === 'x' ? 'columns' : 'rows'
  if (measuredSizes.length !== tracks[key].length || measuredSizes.some(size => !Number.isFinite(size) || size <= 0)) {
    return tracks
  }
  return { ...tracks, [key]: normalizePanelTracks(measuredSizes, tracks[key].length) }
}
