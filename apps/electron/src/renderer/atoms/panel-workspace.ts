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
