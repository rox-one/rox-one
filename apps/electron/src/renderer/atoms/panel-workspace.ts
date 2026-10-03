import { atom } from 'jotai'
import {
  commitPanelWorkspaceLayout,
  loadPanelWorkspaceLayout,
  type PanelWorkspaceLayoutPreferences,
  type PanelWorkspaceLayoutStore,
} from '../lib/panel-workspace-layout'

export interface PanelWorkspaceLayoutUpdate {
  update: (current: PanelWorkspaceLayoutPreferences) => PanelWorkspaceLayoutPreferences
  commit: boolean
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
