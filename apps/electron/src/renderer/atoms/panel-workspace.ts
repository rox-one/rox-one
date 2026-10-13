import { atom } from 'jotai'
import {
  commitPanelWorkspaceLayout,
  loadPanelWorkspaceLayout,
  type PanelLayoutPreset,
  type PanelWorkspaceLayoutPreferences,
  type PanelWorkspaceLayoutStore,
} from '../lib/panel-workspace-layout'

export interface PanelWorkspaceLayoutUpdate {
  update: (current: PanelWorkspaceLayoutPreferences) => PanelWorkspaceLayoutPreferences
  commit: boolean
}

/**
 * G4 «Студия»: the geometry `PanelStackContainer` resolved for the current
 * workspace — the requested preset, the placement it actually honours at this
 * width, and the two column widths the status-bar readout prints (the navigator
 * list and the content surface). `null` means there is nothing to report.
 */
export interface PanelLayoutGeometry {
  preset: PanelLayoutPreset
  effective: string
  listPx: number | null
  surfacePx: number | null
}

/**
 * The live geometry published by `PanelStackContainer` (the single writer) and
 * read by the status-bar readout. Stays `null` whenever the layout-engine flag
 * is off, the preset is `auto`, or the shell has no engine geometry to show, so
 * a flag-OFF status bar renders nothing extra.
 */
export const panelLayoutGeometryAtom = atom<PanelLayoutGeometry | null>(null)

/**
 * One validated preset write shared by the preview and the durable commit: a
 * named arrangement is a preference like `mode`, never a route, so it goes
 * through the same atom update/commit path.
 */
export function withPanelWorkspacePreset(
  current: PanelWorkspaceLayoutPreferences,
  preset: PanelLayoutPreset,
): PanelWorkspaceLayoutPreferences {
  return current.preset === preset ? current : { ...current, preset }
}

/** In-memory previews and durable commits use the same validated preference. */
export function createPanelWorkspaceLayoutAtom(workspaceId: string, storage?: PanelWorkspaceLayoutStore) {
  const state = atom(loadPanelWorkspaceLayout(workspaceId, storage))
  return atom(
    (get) => get(state),
    (get, set, { update, commit }: PanelWorkspaceLayoutUpdate) => {
      const next = update(get(state))
      set(state, next)
      if (commit) commitPanelWorkspaceLayout(next, storage)
    },
  )
}
