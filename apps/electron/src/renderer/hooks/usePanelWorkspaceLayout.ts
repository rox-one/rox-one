import { useCallback, useMemo } from 'react'
import { useAtom, useAtomValue } from 'jotai'
import { atomFamily } from 'jotai-family'
import { useAppShellContext } from '@/context/AppShellContext'
import { createPanelWorkspaceLayoutAtom } from '@/atoms/panel-workspace'
import { panelCountAtom } from '@/atoms/panel-stack'
import {
  panelGridKey,
  panelGridShape,
  normalizePanelTracks,
  type PanelGridShape,
  type PanelGridTracks,
  type PanelWorkspaceLayoutMode,
} from '@/lib/panel-workspace-layout'

export { PANEL_WORKSPACE_LAYOUT_MODES } from '@/lib/panel-workspace-layout'
export type { PanelWorkspaceLayoutMode } from '@/lib/panel-workspace-layout'

const workspaceLayoutAtoms = atomFamily((workspaceId: string) => createPanelWorkspaceLayoutAtom(workspaceId))

/** Shared by the panel container and its toolbar, scoped to the current workspace. */
export function usePanelWorkspaceLayout() {
  const { activeWorkspaceId } = useAppShellContext()
  const panelCount = useAtomValue(panelCountAtom)
  const workspaceId = activeWorkspaceId || '_default'
  const layoutAtom = useMemo(() => workspaceLayoutAtoms(workspaceId), [workspaceId])
  const [preferences, updateLayout] = useAtom(layoutAtom)

  const setMode = useCallback((mode: PanelWorkspaceLayoutMode) => {
    updateLayout({ update: (current) => ({ ...current, mode }), commit: true })
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

  return { mode: preferences.mode, setMode, resetLayout, preferences, setTracks }
}
