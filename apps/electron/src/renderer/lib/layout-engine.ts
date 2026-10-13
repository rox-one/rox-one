/**
 * «Студия» layout engine — `featureLayoutEngine` (localStorage
 * `craft-feature-layout-engine`, default OFF).
 *
 * Pure geometry over the EXISTING flat panel stack: given the width of the
 * columns area, a named preset and the number of panels, it picks a placement
 * (columns / grid tiles) and reflows to a narrower preset before any column is
 * squeezed below its token minimum. It never reparents a panel — the caller
 * keeps the DOM order, identities, terminal cell and sash math.
 *
 * Integer arithmetic only; no DOM access, so it is also usable from tests and
 * the layout deck preview.
 */
import {
  CENTER_MIN_WIDTH,
  PANEL_GAP,
  PANEL_GRID_MIN_HEIGHT,
  PANEL_GRID_MIN_WIDTH,
  PANEL_MIN_WIDTH,
} from '@/components/app-shell/panel-constants'
import { panelGridShape, type PanelLayoutPreset } from './panel-workspace-layout'

/** A preset the engine can resolve to a concrete placement (`auto` is not). */
export type PanelLayoutNamedPreset = Exclude<PanelLayoutPreset, 'auto'>

export interface PanelLayout {
  /** Preset requested by the preference. */
  preset: PanelLayoutPreset
  /** Preset actually honoured at this width; `auto` when none was requested. */
  effective: PanelLayoutPreset
  /** Grid columns the placement renders. */
  columns: number
  /** Grid rows the placement renders. */
  rows: number
  /** One work surface: siblings stay mounted but hidden. */
  singlePanel: boolean
  /** Wall tiles (grid) rather than full-height peer columns. */
  tiles: boolean
  /** Px the requested preset needs at this panel count (`0` for `auto`). */
  requestedWidth: number
  /** Px the effective placement needs at this panel count. */
  requiredWidth: number
  /** Px the effective placement needs in the scroll viewport. */
  requiredHeight: number
  /** `availableWidth` honours the effective placement. */
  fits: boolean
}

/** Full-height content columns ask for `--panel-min-width`. */
const COLUMN_MIN_WIDTH = PANEL_MIN_WIDTH
/** The focused work surface asks for `--center-min-width`. */
const SURFACE_MIN_WIDTH = CENTER_MIN_WIDTH
/** Wall tiles ask for `--panel-grid-min-width` / `-height`. */
const TILE_MIN_WIDTH = PANEL_GRID_MIN_WIDTH
const TILE_MIN_HEIGHT = PANEL_GRID_MIN_HEIGHT

interface Placement {
  columns: number
  rows: number
  singlePanel: boolean
  tiles: boolean
}

/**
 * Resolve a named preset to grid dimensions, capped by the panel count so a
 * preset never renders empty cells (three panels in «Триптих» stay three
 * columns; two stay two; one stays one).
 */
function placementFor(preset: PanelLayoutNamedPreset, panelCount: number): Placement {
  const panels = Math.max(1, panelCount)
  if (preset === 'focus') return { columns: 1, rows: 1, singlePanel: true, tiles: false }
  if (preset === 'wall') {
    const columns = panels <= 1 ? 1 : panels <= 4 ? 2 : 3
    return { columns, rows: Math.ceil(panels / columns), singlePanel: false, tiles: true }
  }
  const want = preset === 'dialog' ? 2 : 3
  const columns = Math.min(want, panels)
  return { columns, rows: Math.ceil(panels / columns), singlePanel: false, tiles: false }
}

/**
 * Least width that can honour a placement: full-height peer columns keep
 * `--panel-min-width`, exactly one of them is the focused surface and may run
 * down to `--center-min-width`, and wall tiles keep `--panel-grid-min-width`.
 */
function requiredSizeFor(preset: PanelLayoutNamedPreset, panelCount: number): { width: number; height: number } {
  const placement = placementFor(preset, panelCount)
  if (placement.singlePanel) return { width: SURFACE_MIN_WIDTH, height: TILE_MIN_HEIGHT }
  if (placement.tiles) {
    return {
      width: placement.columns * TILE_MIN_WIDTH + (placement.columns - 1) * PANEL_GAP,
      height: placement.rows * TILE_MIN_HEIGHT + (placement.rows - 1) * PANEL_GAP,
    }
  }
  return {
    width: (placement.columns - 1) * COLUMN_MIN_WIDTH + SURFACE_MIN_WIDTH + (placement.columns - 1) * PANEL_GAP,
    height: TILE_MIN_HEIGHT,
  }
}

/**
 * Choose a placement for `avail` px, `preset` and `panelCount`.
 *
 * `auto` is a no-op: it returns the shape the shell already derives today so a
 * caller that forgets to gate on the flag still renders byte-identical
 * geometry. A named preset that does not fit reflows one step down the chain
 * «Триптих» → «Диалог» → «Фокус» («Стена» degrades straight to a single focused
 * tile) rather than squeezing a column below its minimum.
 */
export function computeLayout(availableWidth: number, preset: PanelLayoutPreset, panelCount: number): PanelLayout {
  const count = Number.isFinite(panelCount) ? Math.max(0, Math.floor(panelCount)) : 0
  const avail = Number.isFinite(availableWidth) ? Math.max(0, Math.floor(availableWidth)) : 0

  if (preset === 'auto') {
    const shape = panelGridShape(count, 'auto')
    return {
      preset: 'auto',
      effective: 'auto',
      columns: shape.columns,
      rows: shape.rows,
      singlePanel: count <= 1,
      tiles: count > 1,
      requestedWidth: 0,
      requiredWidth: 0,
      requiredHeight: 0,
      fits: true,
    }
  }

  const requestedWidth = requiredSizeFor(preset, count).width
  let effective: PanelLayoutNamedPreset = preset
  if (avail < requestedWidth) {
    if (preset === 'triptych') {
      effective = avail >= requiredSizeFor('dialog', count).width ? 'dialog' : 'focus'
    } else {
      effective = 'focus'
    }
  }

  const placement = placementFor(effective, count)
  const size = requiredSizeFor(effective, count)
  return {
    preset,
    effective,
    columns: placement.columns,
    rows: placement.rows,
    singlePanel: placement.singlePanel,
    tiles: placement.tiles,
    requestedWidth,
    requiredWidth: size.width,
    requiredHeight: size.height,
    fits: avail >= size.width,
  }
}