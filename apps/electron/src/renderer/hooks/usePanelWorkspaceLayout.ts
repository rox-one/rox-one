import { useCallback, useMemo } from 'react'
import { useAtom, useAtomValue } from 'jotai'
import { atomFamily } from 'jotai-family'
import { useAppShellContext, useOptionalAppShellContext } from '@/context/AppShellContext'
import { createPanelWorkspaceLayoutAtom, withPanelWorkspacePreset } from '@/atoms/panel-workspace'
import { panelCountAtom } from '@/atoms/panel-stack'
import {
  applyPanelLayoutProfile,
  deletePanelLayoutProfile,
  panelGridKey,
  panelGridShape,
  normalizePanelTracks,
  savePanelLayoutProfile,
  type PanelGridShape,
  type PanelGridTracks,
  type PanelLayoutPreset,
  type PanelWorkspaceLayoutMode,
} from '@/lib/panel-workspace-layout'

export { PANEL_WORKSPACE_LAYOUT_MODES, PANEL_LAYOUT_PRESETS } from '@/lib/panel-workspace-layout'
export type { PanelWorkspaceLayoutMode, PanelLayoutPreset } from '@/lib/panel-workspace-layout'

const workspaceLayoutAtoms = atomFamily((workspaceId: string) => createPanelWorkspaceLayoutAtom(workspaceId))

/** Shared by the panel container and its toolbar, scoped to the current workspace. */
export function usePanelWorkspaceLayout() {
  const { activeWorkspaceId } = useAppShellContext()
  return usePanelWorkspaceLayoutState(activeWorkspaceId)
}

/**
 * Non-throwing variant for pages that can render outside the shell (standalone mounts,
 * SSR fixtures); the layout falls back to the default workspace scope.
 */
export function useOptionalPanelWorkspaceLayout() {
  const shell = useOptionalAppShellContext()
  return usePanelWorkspaceLayoutState(shell?.activeWorkspaceId)
}

function usePanelWorkspaceLayoutState(activeWorkspaceId: string | null | undefined) {
  const panelCount = useAtomValue(panelCountAtom)
  const workspaceId = activeWorkspaceId || '_default'
  const layoutAtom = useMemo(() => workspaceLayoutAtoms(workspaceId), [workspaceId])
  const [preferences, updateLayout] = useAtom(layoutAtom)

  const setMode = useCallback((mode: PanelWorkspaceLayoutMode) => {
    updateLayout({ update: (current) => ({ ...current, mode }), commit: true })
  }, [updateLayout])

  /** A named arrangement is a preference; switching it commits like `setMode`. */
  const setPreset = useCallback((preset: PanelLayoutPreset) => {
    updateLayout({ update: (current) => withPanelWorkspacePreset(current, preset), commit: true })
  }, [updateLayout])

  const setTracks = useCallback((shape: PanelGridShape, tracks: PanelGridTracks, commit = false) => {
    updateLayout({
      update: (current) => ({
        ...current,
        grids: {
          ...current.grids,
          [panelGridKey(shape)]: {
            columns: normalizePanelTracks(tracks.columns, shape.columns),
            rows: normalizePanelTracks(tracks.rows, shape.rows),
          },
        },
      }),
      commit,
    })
  }, [updateLayout])

  const resetLayout = useCallback(() => {
    updateLayout({
      update: (current) => {
        const shape = panelGridShape(panelCount, current.mode)
        return {
          ...current,
          grids: {
            ...current.grids,
            [panelGridKey(shape)]: {
              columns: normalizePanelTracks(undefined, shape.columns),
              rows: normalizePanelTracks(undefined, shape.rows),
            },
          },
        }
      },
      commit: true,
    })
  }, [panelCount, updateLayout])

  /** Capture the current preset + grids as a named profile (name collision replaces). */
  const saveProfile = useCallback((name: string) => {
    updateLayout({ update: (current) => savePanelLayoutProfile(current, name), commit: true })
  }, [updateLayout])

  /** Restore a saved arrangement: its preset and captured track sizes. */
  const applyProfile = useCallback((id: string) => {
    updateLayout({ update: (current) => applyPanelLayoutProfile(current, id), commit: true })
  }, [updateLayout])

  const deleteProfile = useCallback((id: string) => {
    updateLayout({ update: (current) => deletePanelLayoutProfile(current, id), commit: true })
  }, [updateLayout])

  return {
    mode: preferences.mode,
    setMode,
    preset: preferences.preset,
    setPreset,
    resetLayout,
    preferences,
    setTracks,
    profiles: preferences.profiles ?? [],
    saveProfile,
    applyProfile,
    deleteProfile,
  }
}
