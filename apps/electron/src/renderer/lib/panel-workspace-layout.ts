/**
 * Workspace panel geometry. Routes, identities and focus still belong to the
 * panel stack / NavigationContext; this preference stores only arrangement and
 * track sizes. A resize preview never writes to storage.
 */
import * as storage from './local-storage'

export const PANEL_WORKSPACE_LAYOUT_MODES = ['auto', 'columns', 'grid-2', 'grid-3', 'focus'] as const
export type PanelWorkspaceLayoutMode = typeof PANEL_WORKSPACE_LAYOUT_MODES[number]
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

export interface PanelWorkspaceLayoutPreferences {
  schemaVersion: 1
  workspaceId: string
  mode: PanelWorkspaceLayoutMode
  /** Track sizes are retained independently for each arrangement. */
  grids: Record<string, PanelGridTracks>
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

export function normalizePanelTracks(value: unknown, count: number): number[] {
  if (!Array.isArray(value) || value.length !== count || value.some((n) => typeof n !== 'number' || !Number.isFinite(n) || n <= 0)) {
    return Array.from({ length: count }, () => 1 / count)
  }
  const total = value.reduce((sum: number, n: number) => sum + n, 0)
  if (!Number.isFinite(total) || total <= 0) return Array.from({ length: count }, () => 1 / count)
  return value.map((n: number) => n / total)
}

export function defaultPanelWorkspaceLayout(workspaceId: string): PanelWorkspaceLayoutPreferences {
  return { schemaVersion: 1, workspaceId, mode: 'auto', grids: {} }
}

export function parsePanelWorkspaceLayout(raw: unknown, workspaceId: string): PanelWorkspaceLayoutPreferences | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  const value = raw as Record<string, unknown>
  if (value.schemaVersion !== 1 || value.workspaceId !== workspaceId) return null
  const mode = PANEL_WORKSPACE_LAYOUT_MODES.includes(value.mode as PanelWorkspaceLayoutMode)
    ? value.mode as PanelWorkspaceLayoutMode : 'auto'
  const grids: Record<string, PanelGridTracks> = {}
  if (value.grids && typeof value.grids === 'object' && !Array.isArray(value.grids)) {
    for (const [key, tracks] of Object.entries(value.grids)) {
      const match = /^([1-9]\d?)x([1-9]\d?)$/.exec(key)
      if (!match || tracks === null || typeof tracks !== 'object' || Array.isArray(tracks)) continue
      const grid = tracks as Record<string, unknown>
      grids[key] = {
        columns: normalizePanelTracks(grid.columns, Number(match[1])),
        rows: normalizePanelTracks(grid.rows, Number(match[2])),
      }
    }
  }
  return { schemaVersion: 1, workspaceId, mode, grids }
}

export function loadPanelWorkspaceLayout(
  workspaceId: string,
  store: PanelWorkspaceLayoutStore = storage,
): PanelWorkspaceLayoutPreferences {
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
