/**
 * Panel-stack → WorkbenchLayout v2 (read path). URL/panel-stack remains the
 * write path for focus; this projection is what SurfaceTabs reads and what
 * we persist under KEYS.workbenchLayout.
 */

import {
  migrateSurfaceLayoutSnapshotToWorkbench,
  type SurfaceLayoutSnapshot,
  type SurfaceTab,
  type WorkbenchLayout,
} from '@craft-agent/core/platform'
import { surfaceTabFromRoute } from './layout-snapshot'

export function workbenchLayoutFromPanelEntries(
  workspaceId: string,
  entries: Array<{ id: string; route: string; proportion: number }>,
  focusedPanelId: string | null,
  savedAt: number = Date.now(),
): WorkbenchLayout {
  const tabs: SurfaceLayoutSnapshot['tabs'] = []
  let focusedIndex = 0
  entries.forEach((entry) => {
    const tab = surfaceTabFromRoute(entry.route) as SurfaceTab | null
    if (!tab) return
    if (entry.id === focusedPanelId) focusedIndex = tabs.length
    tabs.push({
      panelId: entry.id,
      laneId: 'main',
      tab,
      proportion: entry.proportion,
    })
  })

  const snapshot: SurfaceLayoutSnapshot = {
    version: 1,
    workspaceId,
    lanes: [{ laneId: 'main', locked: false }],
    tabs,
    focusedIndex,
    savedAt,
  }
  return migrateSurfaceLayoutSnapshotToWorkbench(snapshot, { now: savedAt })
}
