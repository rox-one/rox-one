/**
 * Panel-stack → WorkbenchLayout v2 (read path). URL/panel-stack remains the
 * write path for focus; this projection is a mirror of the 1D stack (not
 * grouping SoT) persisted under KEYS.workbenchLayout.
 */

import {
  migrateSurfaceLayoutSnapshotToWorkbench,
  parseWorkbenchLayout,
  type SurfaceLayoutSnapshot,
  type SurfaceTab,
  type WorkbenchLayout,
} from '@craft-agent/core/platform'
import { surfaceTabFromRoute } from './layout-snapshot'

const MIGRATED_TAB_ID = /\/tab-\d+$/

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

/** Drop invalid layouts instead of persisting them. */
export function persistableWorkbenchLayout(layout: WorkbenchLayout): WorkbenchLayout | null {
  return parseWorkbenchLayout(layout)
}

/**
 * Preview styling keys: group id (1:1 migrate) plus the migrated
 * `<panelId>/tab-N` instance prefix so a later multi-tab group still paints
 * the preview tab, not every tab in the group.
 */
export function previewPanelIdsFromLayout(layout: WorkbenchLayout): Set<string> {
  const ids = new Set<string>()
  for (const group of layout.groups) {
    for (const instance of group.tabs) {
      if (!instance.preview) continue
      ids.add(group.id)
      const panelId = instance.id.replace(MIGRATED_TAB_ID, '')
      if (panelId.length > 0) ids.add(panelId)
    }
  }
  return ids
}
